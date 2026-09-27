import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { digest } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "./service";

type Client = Prisma.TransactionClient | typeof db;
export const defaultPolicy = {
  requireForAdmins: false,
  requireForManagers: false,
  requireForEmployees: false,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  passwordExpiryDays: null as number | null,
  sessionIdleMinutes: null as number | null,
};
export async function securityPolicy(companyId: string, client: Client = db) {
  const found = await client.mfaSetting.findUnique({ where: { companyId } });
  return found ?? { ...defaultPolicy, companyId };
}
export async function securityEvent(
  client: Client,
  event: {
    companyId: string;
    userId?: string | null;
    type: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
    details?: Prisma.InputJsonValue;
    ip?: string;
  },
) {
  await client.securityEvent.create({
    data: { severity: "INFO", ...event, userId: event.userId ?? null },
  });
}
export async function recordLogin(entry: {
  companyId: string;
  userId?: string | null;
  channel: "WEB" | "MOBILE";
  success: boolean;
  reason?: string;
  req: NextRequest;
}) {
  await db.loginHistory.create({
    data: {
      companyId: entry.companyId,
      userId: entry.userId ?? null,
      channel: entry.channel,
      success: entry.success,
      reason: entry.reason,
      ip: ip(entry.req),
      userAgent: entry.req.headers.get("user-agent")?.slice(0, 500),
    },
  });
}
// Counts a failed password or second-factor attempt and locks the account
// once the company's threshold is reached.
export async function registerFailure(
  user: { id: string; companyId: string },
  req: NextRequest,
) {
  const policy = await securityPolicy(user.companyId);
  const updated = await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (updated.failedLoginCount < policy.maxFailedAttempts) return;
  const lockedUntil = new Date(Date.now() + policy.lockoutMinutes * 60000);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil },
    });
    await securityEvent(tx, {
      companyId: user.companyId,
      userId: user.id,
      type: "ACCOUNT_LOCKED",
      severity: "WARNING",
      details: {
        attempts: updated.failedLoginCount,
        lockedUntil: lockedUntil.toISOString(),
      },
      ip: ip(req),
    });
  });
}
export type Tier = "admin" | "manager" | "employee";
export function roleTier(permissions: string[], isSuperAdmin = false): Tier {
  if (
    isSuperAdmin ||
    ["users.write", "roles.write", "company.write"].some((p) =>
      permissions.includes(p),
    )
  )
    return "admin";
  if (
    [
      "timeoff.manage",
      "attendance.manage",
      "attendance.team.read",
      "timeoff.team.read",
    ].some((p) => permissions.includes(p))
  )
    return "manager";
  return "employee";
}
export function securityGate(
  policy: Awaited<ReturnType<typeof securityPolicy>>,
  user: { twoFactorEnabled: boolean; passwordChangedAt: Date },
  tier: Tier,
) {
  const required =
    (tier === "admin" && policy.requireForAdmins) ||
    (tier === "manager" && policy.requireForManagers) ||
    (tier === "employee" && policy.requireForEmployees);
  return {
    mfaSetupRequired: required && !user.twoFactorEnabled,
    passwordChangeRequired:
      !!policy.passwordExpiryDays &&
      user.passwordChangedAt.getTime() + policy.passwordExpiryDays * 86400000 <
        Date.now(),
  };
}

const normalize = (code: string) => code.replace(/[\s-]/g, "").toLowerCase();
export async function consumeRecoveryCode(
  user: { id: string; companyId: string },
  code: string,
  req: NextRequest,
) {
  const hash = digest(normalize(code));
  // Removes the code atomically so each recovery code works exactly once.
  const used = await db.$executeRaw`
    UPDATE "users" SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${hash})
    WHERE "id" = ${user.id} AND ${hash} = ANY("recoveryCodeHashes")`;
  if (!used)
    throw new AppError(
      401,
      "Invalid or already used recovery code.",
      "INVALID_TWO_FACTOR",
    );
  await securityEvent(db, {
    companyId: user.companyId,
    userId: user.id,
    type: "RECOVERY_CODE_USED",
    severity: "WARNING",
    ip: ip(req),
  });
}

const policySchema = z
  .object({
    requireForAdmins: z.boolean(),
    requireForManagers: z.boolean(),
    requireForEmployees: z.boolean(),
    maxFailedAttempts: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
    passwordExpiryDays: z.number().int().min(30).max(730).nullable(),
    sessionIdleMinutes: z.number().int().min(15).max(1440).nullable(),
  })
  .strict();
const page = (req: NextRequest) =>
  z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      userId: z.string().optional(),
      type: z.string().max(60).optional(),
    })
    .parse(Object.fromEntries(req.nextUrl.searchParams));

// Account-level routes available to every signed-in user.
export async function accountSecurity(
  req: NextRequest,
  ctx: Context,
  action: string,
) {
  if (action === "login-history" && req.method === "GET") {
    const q = page(req);
    const where = { companyId: ctx.companyId, userId: ctx.userId };
    const [items, total] = await db.$transaction([
      db.loginHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.loginHistory.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (action === "recovery-codes" && req.method === "GET") {
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    return {
      enabled: user.twoFactorEnabled,
      remaining: user.recoveryCodeHashes.length,
    };
  }
  if (action === "recovery-codes" && req.method === "POST") {
    await rateLimit(`recovery-codes:${ctx.userId}`, 5);
    const b = z
      .object({ password: z.string().max(72) })
      .strict()
      .parse(await json(req));
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!(await bcrypt.compare(b.password, user.passwordHash)))
      throw new AppError(403, "Password is incorrect.");
    if (!user.twoFactorEnabled)
      throw new AppError(409, "Enable two-factor authentication first.");
    const codes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(5).toString("hex");
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: ctx.userId },
        data: { recoveryCodeHashes: codes.map((c) => digest(normalize(c))) },
      });
      await securityEvent(tx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        type: "RECOVERY_CODES_GENERATED",
        ip: ip(req),
      });
    });
    // Codes are hashed at rest and shown only once.
    return { codes };
  }
  if (action === "revoke-all" && req.method === "POST") {
    const b = z
      .object({ includeCurrent: z.boolean().default(false) })
      .strict()
      .parse(await json(req));
    return db.$transaction(async (tx) => {
      const revoked = await tx.session.deleteMany({
        where: {
          userId: ctx.userId,
          ...(b.includeCurrent ? {} : { id: { not: ctx.sessionId } }),
        },
      });
      await securityEvent(tx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        type: "SESSIONS_REVOKED",
        details: { count: revoked.count, includeCurrent: b.includeCurrent },
        ip: ip(req),
      });
      await audit(
        tx,
        ctx,
        "REVOKE_ALL_SESSIONS",
        "auth",
        ctx.userId,
        undefined,
        { count: revoked.count },
        ip(req),
      );
      return { revoked: revoked.count };
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Company security administration.
export async function securityRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  if (resource === "settings") {
    if (req.method === "GET") {
      if (
        !ctx.permissions.includes("security.manage") &&
        !ctx.permissions.includes("audit.read")
      )
        throw new AppError(
          403,
          "You do not have permission for this action.",
          "FORBIDDEN",
        );
      return securityPolicy(ctx.companyId);
    }
    requirePermission(ctx, "security.manage");
    const b = policySchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = await securityPolicy(ctx.companyId, tx);
      const saved = await tx.mfaSetting.upsert({
        where: { companyId: ctx.companyId },
        create: { ...b, companyId: ctx.companyId, updatedBy: ctx.userId },
        update: { ...b, updatedBy: ctx.userId },
      });
      await securityEvent(tx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        type: "SECURITY_POLICY_CHANGED",
        severity: "WARNING",
        details: b,
        ip: ip(req),
      });
      const { companyId: _c, ...before } = old as typeof old & {
        updatedAt?: Date;
        updatedBy?: string | null;
      };
      await audit(
        tx,
        ctx,
        "UPDATE",
        "security_policy",
        ctx.companyId,
        JSON.parse(JSON.stringify(before)),
        b,
        ip(req),
      );
      return saved;
    });
  }
  if (
    resource === "users" &&
    id &&
    action === "unlock" &&
    req.method === "POST"
  ) {
    requirePermission(ctx, "security.manage");
    return db.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id, companyId: ctx.companyId },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
      if (!changed.count) throw new AppError(404, "User not found.");
      await securityEvent(tx, {
        companyId: ctx.companyId,
        userId: id,
        type: "ACCOUNT_UNLOCKED",
        details: { by: ctx.userId },
        ip: ip(req),
      });
      return { unlocked: true };
    });
  }
  requirePermission(ctx, "audit.read");
  const q = page(req);
  if (resource === "login-history" && req.method === "GET") {
    const where = {
      companyId: ctx.companyId,
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [items, total] = await db.$transaction([
      db.loginHistory.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.loginHistory.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "events" && req.method === "GET") {
    const where = {
      companyId: ctx.companyId,
      ...(q.type ? { type: q.type } : {}),
    };
    const [items, total] = await db.$transaction([
      db.securityEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.securityEvent.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "locked-users" && req.method === "GET")
    return db.user.findMany({
      where: { companyId: ctx.companyId, lockedUntil: { gt: new Date() } },
      select: { id: true, name: true, email: true, lockedUntil: true },
      orderBy: { lockedUntil: "desc" },
    });
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
