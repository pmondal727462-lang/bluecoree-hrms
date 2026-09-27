import { NextRequest } from "next/server";
import { platformBilling } from "@/modules/saas/billing";
import { rulesRoute } from "@/modules/payroll/rules";
import { z } from "zod";
import { db, withSystem } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomBytes } from "node:crypto";
import { digest } from "@/lib/crypto";
import { audit, ip, json, type Context } from "@/modules/auth/service";
import { securityEvent } from "@/modules/auth/security";
import { effectiveStatus, platformSaas } from "@/modules/saas/service";
import { supportDesk } from "@/modules/support/service";
import { backupConfig, nextBackups } from "./backup";
import { healthHistory, runHealthChecks } from "./health";

const serializeBackup = <T extends { sizeBytes: bigint | null }>(b: T) => ({
  ...b,
  sizeBytes: b.sizeBytes === null ? null : Number(b.sizeBytes),
});
export async function backupStatus() {
  const [items, lastSuccess] = await Promise.all([
    db.backupLog.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    db.backupLog.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const c = backupConfig();
  const next = nextBackups();
  return {
    latest: items[0] ? serializeBackup(items[0]) : null,
    lastSuccess: lastSuccess ? serializeBackup(lastSuccess) : null,
    next: { daily: next.daily, weekly: next.weekly },
    location: c.dir,
    encryptionConfigured: !!c.key,
    retention: {
      dailyDays: c.dailyRetentionDays,
      weeklyDays: c.weeklyRetentionDays,
    },
    items: items.map(serializeBackup),
  };
}
async function overview() {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const period = now.toISOString().slice(0, 7);
  const [
    companies,
    subs,
    users,
    employees,
    active,
    usage,
    ai,
    storage,
    tickets,
    failing,
  ] = await Promise.all([
    db.company.count(),
    db.subscription.findMany({
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        graceDays: true,
      },
    }),
    db.user.count({ where: { active: true } }),
    db.employee.count({ where: { status: { not: "Inactive" } } }),
    db.session.groupBy({
      by: ["userId"],
      where: { lastUsedAt: { gte: new Date(now.getTime() - 30 * 86400000) } },
    }),
    db.subscriptionUsage.groupBy({
      by: ["metric"],
      where: { period },
      _sum: { value: true },
    }),
    db.aiAccessLog.count({ where: { timestamp: { gte: month } } }),
    db.$queryRaw<{ bytes: bigint | null }[]>`
        SELECT (COALESCE((SELECT SUM(octet_length("logoData")) FROM "company_branding"), 0)
          + COALESCE((SELECT SUM("attachmentSize") FROM "support_messages"), 0))::bigint AS bytes`,
    db.supportTicket.count({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
    }),
    db.integration.count({ where: { active: true, lastStatus: "FAILED" } }),
  ]);
  const byStatus: Record<string, number> = {
    TRIAL: 0,
    ACTIVE: 0,
    GRACE: 0,
    EXPIRED: 0,
  };
  for (const s of subs) byStatus[effectiveStatus(s, now).status]++;
  return {
    companies,
    subscriptions: byStatus,
    activeUsers: users,
    usersActiveLast30Days: active.length,
    employees,
    apiCallsThisMonth:
      usage.find((u) => u.metric === "api_calls")?._sum.value ?? 0,
    aiRequestsThisMonth:
      usage.find((u) => u.metric === "ai_requests")?._sum.value ?? ai,
    storageMb:
      Math.round((Number(storage[0]?.bytes ?? 0) / 1048576) * 100) / 100,
    openTickets: tickets,
    failingIntegrations: failing,
    payments: {
      configured: false,
      note: "No payment gateway is connected. Record renewals by updating each company's subscription.",
    },
  };
}
async function auditTrail(req: NextRequest) {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      companyId: z.string().optional(),
      search: z.string().max(100).default(""),
    })
    .parse(Object.fromEntries(req.nextUrl.searchParams));
  const where = {
    ...(q.companyId ? { companyId: q.companyId } : {}),
    ...(q.search
      ? {
          OR: [
            { action: { contains: q.search, mode: "insensitive" as const } },
            { module: { contains: q.search, mode: "insensitive" as const } },
            { actorName: { contains: q.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await db.$transaction([
    db.auditLog.findMany({
      where,
      include: { company: { select: { name: true, code: true } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.auditLog.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

// The provider's own company: where the first Super Admin was created.
let providerCompany: string | null = null;
async function providerCompanyId() {
  providerCompany ??=
    (
      await withSystem(() =>
        db.user.findFirst({
          where: { isSuperAdmin: true },
          orderBy: { createdAt: "asc" },
          select: { companyId: true },
        }),
      )
    )?.companyId ?? null;
  return providerCompany;
}
// "super" can do everything; "staff" (SaaS Admin in the provider company)
// can view the platform and work the support desk but not change billing.
export async function platformAccess(ctx: Context) {
  if (ctx.isSuperAdmin) return "super" as const;
  if (
    ctx.roleName === "SaaS Admin" &&
    ctx.companyId === (await providerCompanyId())
  )
    return "staff" as const;
  return null;
}
async function companyAction(
  req: NextRequest,
  ctx: Context,
  id: string,
  action: string,
) {
  const company = await db.company.findUnique({ where: { id } });
  if (!company) throw new AppError(404, "Company not found.");
  if (action === "status") {
    const b = z
      .object({
        status: z.enum(["ACTIVE", "SUSPENDED"]),
        reason: z.string().trim().max(300).optional(),
      })
      .strict()
      .parse(await json(req));
    if (b.status === "SUSPENDED" && id === (await providerCompanyId()))
      throw new AppError(409, "The provider company cannot be suspended.");
    return db.$transaction(async (tx) => {
      const saved = await tx.company.update({
        where: { id },
        data: {
          status: b.status,
          suspendedAt: b.status === "SUSPENDED" ? new Date() : null,
          suspendReason: b.status === "SUSPENDED" ? (b.reason ?? null) : null,
        },
        select: {
          id: true,
          status: true,
          suspendedAt: true,
          suspendReason: true,
        },
      });
      // Suspension signs everyone out; data is kept.
      if (b.status === "SUSPENDED")
        await tx.session.deleteMany({ where: { user: { companyId: id } } });
      await audit(
        tx,
        ctx,
        b.status === "SUSPENDED" ? "SUSPEND" : "ACTIVATE",
        "companies",
        id,
        { status: company.status },
        { status: b.status, reason: b.reason, company: company.code },
        ip(req),
      );
      await securityEvent(tx, {
        companyId: id,
        type: `COMPANY_${b.status}`,
        severity: "WARNING",
        details: { by: ctx.userId, reason: b.reason ?? null },
      });
      return saved;
    });
  }
  if (action === "extend-trial") {
    const b = z
      .object({ days: z.number().int().min(1).max(365) })
      .strict()
      .parse(await json(req));
    return db.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { companyId: id },
      });
      if (!sub || sub.status !== "TRIAL")
        throw new AppError(409, "This company is not on a trial.");
      const from =
        sub.trialEndsAt && sub.trialEndsAt > new Date()
          ? sub.trialEndsAt
          : new Date();
      const saved = await tx.subscription.update({
        where: { companyId: id },
        data: { trialEndsAt: new Date(from.getTime() + b.days * 86400000) },
      });
      await audit(
        tx,
        ctx,
        "EXTEND_TRIAL",
        "subscriptions",
        id,
        { trialEndsAt: sub.trialEndsAt },
        { trialEndsAt: saved.trialEndsAt, days: b.days, company: company.code },
        ip(req),
      );
      return { trialEndsAt: saved.trialEndsAt };
    });
  }
  if (action === "reset-access") {
    const b = z
      .object({ userId: z.string().optional() })
      .strict()
      .parse(await json(req));
    // Issues a one-time password reset link for the company's owner or admin,
    // signs that account out everywhere and clears any lockout.
    const user = await db.user.findFirst({
      where: {
        companyId: id,
        active: true,
        ...(b.userId
          ? { id: b.userId }
          : { role: { name: { in: ["Company Owner", "Company Admin"] } } }),
      },
      include: { role: true },
      orderBy: { createdAt: "asc" },
    });
    if (!user)
      throw new AppError(404, "No active owner or administrator found.");
    const challengeId = randomBytes(16).toString("hex");
    const token = randomBytes(32).toString("hex");
    await db.$transaction(async (tx) => {
      await tx.authChallenge.create({
        data: {
          id: challengeId,
          companyId: id,
          userId: user.id,
          kind: "reset",
          tokenHash: digest(`${challengeId}:${token}`),
          expiresAt: new Date(Date.now() + 24 * 3600000),
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
      await audit(
        tx,
        ctx,
        "RESET_ACCESS",
        "companies",
        id,
        undefined,
        { userId: user.id, company: company.code },
        ip(req),
      );
      await securityEvent(tx, {
        companyId: id,
        userId: user.id,
        type: "ACCESS_RESET_BY_PROVIDER",
        severity: "WARNING",
        details: { by: ctx.userId },
      });
    });
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role.name,
      },
      // Share this link with the account owner through a verified channel.
      resetUrl: `${process.env.APP_URL}/reset-password?id=${challengeId}&token=${token}`,
      expiresInHours: 24,
    };
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

export async function platformRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const access = await platformAccess(ctx);
  if (!access)
    throw new AppError(403, "Super Admin access is required.", "FORBIDDEN");
  // Platform administration spans companies once access is confirmed.
  return withSystem(() => platform(req, ctx, path, access));
}
async function platform(
  req: NextRequest,
  ctx: Context,
  path: string[],
  access: "super" | "staff",
) {
  const superOnly = () => {
    if (access !== "super")
      throw new AppError(
        403,
        "Only a Super Admin can make this change.",
        "FORBIDDEN",
      );
  };
  const [, resource, id, action] = path;
  const method = req.method;
  if (resource === "overview" && method === "GET") return overview();
  if (resource === "backups" && method === "GET") return backupStatus();
  if (resource === "health" && method === "GET")
    return { checks: await runHealthChecks(), history: await healthHistory() };
  if (resource === "audit" && method === "GET") return auditTrail(req);
  if (resource === "tickets") return supportDesk(req, ctx, id, action);
  if (["add-ons", "coupons", "invoices", "jobs"].includes(resource)) {
    if (req.method !== "GET") superOnly();
    const result = await platformBilling(req, ctx, resource, id, action);
    return result;
  }
  if (resource === "statutory-rules") {
    if (method !== "GET") superOnly();
    return rulesRoute(req, ctx, id, true);
  }
  if (resource === "companies" && id && action && method !== "GET") {
    superOnly();
    return companyAction(req, ctx, id, action);
  }
  if (resource === "companies" && !id && method === "GET")
    return platformSaas(req, ctx, resource, id);
  if (resource === "plans" && !id && method === "GET")
    return platformSaas(req, ctx, resource, id);
  if (
    (resource === "plans" &&
      ((!id && method === "POST") || (id && method === "PUT"))) ||
    (resource === "subscriptions" && id && method === "PUT")
  ) {
    superOnly();
    return platformSaas(req, ctx, resource, id);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
