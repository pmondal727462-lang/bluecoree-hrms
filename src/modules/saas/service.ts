import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";

type Client = Prisma.TransactionClient | typeof db;
export const planFeatures = [
  "attendance",
  "face",
  "livetracking",
  "jobtracking",
  "workplanning",
  "contractors",
  "payroll",
  "ai",
  "mobile",
  "biometric",
  "reports",
  "api",
  "whitelabel",
  "recruitment",
  "performance",
  "expenses",
  "onboarding",
  "training",
  "assets",
] as const;
export type Feature = (typeof planFeatures)[number];
export type EffectiveStatus = "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED";
const day = 86400000;
const period = (now = new Date()) => now.toISOString().slice(0, 7);

export function effectiveStatus(
  sub: {
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    graceDays: number;
  },
  now = new Date(),
): { status: EffectiveStatus; endsAt: Date | null; graceEndsAt: Date | null } {
  const trial = sub.status === "TRIAL";
  if (trial && !sub.trialEndsAt)
    return { status: "EXPIRED", endsAt: null, graceEndsAt: null };
  const end =
    sub.status === "CANCELLED"
      ? (sub.currentPeriodEnd ?? now)
      : trial
        ? sub.trialEndsAt
        : sub.currentPeriodEnd;
  if (!end) return { status: "ACTIVE", endsAt: null, graceEndsAt: null };
  const graceEndsAt = new Date(end.getTime() + sub.graceDays * day);
  const status: EffectiveStatus =
    now <= end && sub.status !== "CANCELLED"
      ? trial
        ? "TRIAL"
        : "ACTIVE"
      : now <= graceEndsAt
        ? "GRACE"
        : "EXPIRED";
  return { status, endsAt: end, graceEndsAt };
}
export async function companySubscription(
  companyId: string,
  client: Client = db,
) {
  const sub = await client.subscription.findUnique({
    where: { companyId },
    include: { plan: true },
  });
  return sub
    ? { ...sub, storedStatus: sub.status, ...effectiveStatus(sub) }
    : null;
}
export async function assignedSubscription(
  companyId: string,
  client: Client = db,
) {
  const sub = await companySubscription(companyId, client);
  if (!sub)
    throw new AppError(
      402,
      "No subscription is assigned to this company. Contact your administrator.",
      "SUBSCRIPTION_REQUIRED",
    );
  return sub;
}
// The feature service (spec §72): everything a company may use comes from
// its plan plus active add-ons. Modules call canUse/requireFeature instead of
// reading plan features directly.
export async function entitlements(companyId: string, client: Client = db) {
  const sub = await assignedSubscription(companyId, client);
  const addOns = await client.subscriptionAddOn.findMany({
    where: { companyId, cancelledAt: null, addOn: { active: true } },
    include: { addOn: true },
  });
  const extra = (k: "extraStorageMb" | "extraAiRequests" | "extraApiCalls") =>
    addOns.reduce((sum, a) => sum + (a.addOn[k] ?? 0) * a.quantity, 0);
  const plus = (
    base: number | null,
    k: "extraStorageMb" | "extraAiRequests" | "extraApiCalls",
  ) => (base === null ? null : base + extra(k));
  return {
    sub,
    features: new Set<string>(
      [
        ...sub.plan.features,
        ...addOns.flatMap((a) => (a.addOn.feature ? [a.addOn.feature] : [])),
        ...sub.enabledFeatures,
      ].filter((feature) => !sub.disabledFeatures.includes(feature)),
    ),
    addOns: addOns.map((a) => ({
      code: a.addOn.code,
      name: a.addOn.name,
      quantity: a.quantity,
    })),
    storageMb: plus(sub.plan.storageLimitMb, "extraStorageMb"),
    aiRequests: plus(sub.plan.aiRequestLimitMonthly, "extraAiRequests"),
    apiCalls: plus(sub.plan.apiCallLimitMonthly, "extraApiCalls"),
  };
}
// A company without any subscription (the provider's own) is unrestricted;
// an expired subscription pauses every paid module.
export async function canUse(companyId: string, feature: Feature) {
  const sub = await companySubscription(companyId);
  if (!sub || sub.status === "EXPIRED") return !sub;
  return (await entitlements(companyId)).features.has(feature);
}
// Company data is never deleted on expiry; paid modules are paused instead.
export async function requireFeature(companyId: string, feature: Feature) {
  const e = await entitlements(companyId);
  if (e.sub.status === "EXPIRED")
    throw new AppError(
      402,
      "Your subscription has expired. Renew it to use this module; your data is kept.",
      "SUBSCRIPTION_EXPIRED",
    );
  if (!e.features.has(feature))
    throw new AppError(
      402,
      `The ${e.sub.plan.name} plan does not include this module. Add it as an add-on or change the plan.`,
      "FEATURE_NOT_IN_PLAN",
    );
}
export async function provisionSubscription(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const plan = await tx.subscriptionPlan.findUnique({
    where: { code: "FREE_TRIAL" },
  });
  if (!plan || !plan.active || !plan.trialDays)
    throw new AppError(
      503,
      "Company registration is unavailable until an active trial plan is configured.",
      "TRIAL_PLAN_UNAVAILABLE",
    );
  const now = new Date();
  await tx.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      status: "TRIAL",
      trialStartsAt: now,
      trialEndsAt: new Date(now.getTime() + plan.trialDays * day),
    },
  });
}

const adminWhere = (companyId: string): Prisma.UserWhereInput => ({
  companyId,
  active: true,
  OR: [
    { isSuperAdmin: true },
    {
      role: {
        permissions: {
          some: {
            permissionKey: {
              in: ["users.write", "roles.write", "company.write"],
            },
          },
        },
      },
    },
  ],
});
async function counts(companyId: string, client: Client = db) {
  const [employees, admins, branding, usage] = await Promise.all([
    client.employee.count({
      where: { companyId, status: { not: "Inactive" } },
    }),
    client.user.count({ where: adminWhere(companyId) }),
    storageBytes(companyId, client),
    client.subscriptionUsage.findMany({
      where: { companyId, period: period() },
    }),
  ]);
  const monthly = (metric: string) =>
    usage.find((u) => u.metric === metric)?.value ?? 0;
  return {
    employees,
    admins,
    storageMb: Math.round((branding / 1048576) * 100) / 100,
    apiCalls: monthly("api_calls"),
    aiRequests: monthly("ai_requests"),
  };
}
// Bytes stored for a company across logos, ticket attachments, expense
// receipts and candidate resumes.
export async function storageBytes(companyId: string, client: Client = db) {
  const [row] = await client.$queryRaw<{ bytes: bigint | null }[]>`
    SELECT (
      COALESCE((SELECT octet_length("logoData") FROM "company_branding" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT octet_length("logoData") FROM "company_settings" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("attachmentSize") FROM "support_messages" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("receiptSize") FROM "expense_claims" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("resumeSize") FROM "candidates" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("size") FROM "document_versions" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("size") FROM "ticket_messages" WHERE "companyId" = ${companyId}), 0)
      + COALESCE((SELECT SUM("photoSize") FROM "employees" WHERE "companyId" = ${companyId}), 0)
    )::bigint AS bytes`;
  return Number(row?.bytes ?? 0);
}
export async function assertStorage(companyId: string, adding: number) {
  const limit = (await entitlements(companyId)).storageMb;
  if (limit === null || limit === undefined) return;
  if ((await storageBytes(companyId)) + adding > limit * 1048576)
    throw new AppError(
      402,
      "This file exceeds your plan's storage limit.",
      "PLAN_LIMIT_REACHED",
    );
}
// Checked inside the write transaction so concurrent creates cannot exceed it.
export async function enforceLimit(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: "employees" | "admins" | "locations",
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`limit:${companyId}`}))::text`;
  const sub = await assignedSubscription(companyId, tx);
  const limit =
    kind === "employees"
      ? sub
        ? employeeLicenceLimit(sub)
        : null
      : kind === "admins"
        ? sub?.plan.adminLimit
        : sub?.plan.locationLimit;
  if (limit === null || limit === undefined) return;
  const used =
    kind === "employees"
      ? await tx.employee.count({
          where: { companyId, status: { not: "Inactive" } },
        })
      : kind === "admins"
        ? await tx.user.count({ where: adminWhere(companyId) })
        : // Checked before the new location is created.
          (await tx.branch.count({ where: { companyId } })) + 1;
  if (used > limit)
    throw new AppError(
      402,
      `Your subscription allows ${limit} ${kind === "employees" ? "active employees" : kind === "admins" ? "administrators" : "work locations"}. Contact Management to increase your licence limit.`,
      "PLAN_LIMIT_REACHED",
    );
}
export function employeeLicenceLimit(sub: {
  employeeLimit: number | null;
  plan: { employeeLimit: number | null };
}) {
  const limits = [sub.employeeLimit, sub.plan.employeeLimit].filter(
    (v): v is number => v !== null,
  );
  return limits.length ? Math.min(...limits) : null;
}
// Counts monthly metered use and refuses calls beyond the plan's quota.
export async function consumeQuota(
  companyId: string,
  metric: "api_calls" | "ai_requests",
) {
  const e = await entitlements(companyId);
  const row = await db.subscriptionUsage.upsert({
    where: {
      companyId_metric_period: { companyId, metric, period: period() },
    },
    create: { companyId, metric, period: period(), value: 1 },
    update: { value: { increment: 1 } },
  });
  const limit = metric === "api_calls" ? e.apiCalls : e.aiRequests;
  if (limit !== null && limit !== undefined && row.value > limit)
    throw new AppError(
      429,
      `This month's ${metric === "api_calls" ? "API call" : "AI request"} quota for your plan is used up.`,
      "PLAN_QUOTA_EXCEEDED",
    );
}
function summary(
  sub: NonNullable<Awaited<ReturnType<typeof companySubscription>>>,
  usage: Awaited<ReturnType<typeof counts>>,
) {
  const p = sub.plan;
  return {
    plan: {
      code: p.code,
      name: p.name,
      description: p.description,
      priceMonthly: p.priceMonthly === null ? null : Number(p.priceMonthly),
      currency: p.currency,
      features: p.features,
    },
    status: sub.status,
    storedStatus: sub.storedStatus,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    endsAt: sub.endsAt,
    graceEndsAt: sub.graceEndsAt,
    limits: {
      employees: employeeLicenceLimit(sub),
      admins: p.adminLimit,
      storageMb: p.storageLimitMb,
      apiCalls: p.apiCallLimitMonthly,
      aiRequests: p.aiRequestLimitMonthly,
      devices: p.deviceLimit,
    },
    usage,
  };
}
export async function subscriptionSummary(companyId: string) {
  const sub = await companySubscription(companyId);
  if (!sub) return null;
  const e = await entitlements(companyId);
  const base = summary(sub, await counts(companyId));
  return {
    ...base,
    billingCycle: sub.billingCycle,
    addOns: e.addOns,
    // Effective features include add-ons, so navigation follows purchases.
    plan: { ...base.plan, features: [...e.features] },
    limits: {
      ...base.limits,
      storageMb: e.storageMb,
      aiRequests: e.aiRequests,
      apiCalls: e.apiCalls,
      locations: sub.plan.locationLimit,
    },
  };
}
// Decimal prices are returned as numbers.
const serializePlan = <T extends object>(p: T) =>
  Object.fromEntries(
    Object.entries(p).map(([k, v]) => [
      k,
      v instanceof Prisma.Decimal ? Number(v) : v,
    ]),
  ) as { [K in keyof T]: T[K] extends Prisma.Decimal ? number : T[K] };

export async function subscriptionRoute(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "company.read");
  if (req.method !== "GET") throw new AppError(405, "Method not allowed.");
  const [plans, addOns, billing] = await Promise.all([
    db.subscriptionPlan.findMany({
      where: { active: true, public: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.addOn.findMany({
      where: { active: true, public: true },
      orderBy: { name: "asc" },
    }),
    db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: {
        gstin: true,
        billingState: true,
        billingEmail: true,
        address: true,
      },
    }),
  ]);
  return {
    current: await subscriptionSummary(ctx.companyId),
    plans: plans.map(serializePlan),
    addOns: addOns.map(serializePlan),
    billing,
  };
}

const limit = z.number().int().min(0).nullable();
const planSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,30}$/),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable().default(null),
    priceMonthly: z.number().min(0).max(100000000).nullable(),
    priceAnnual: z.number().min(0).max(1000000000).nullable().default(null),
    pricePerEmployeeMonthly: z
      .number()
      .min(0)
      .max(100000)
      .nullable()
      .default(null),
    pricePerEmployeeAnnual: z
      .number()
      .min(0)
      .max(1000000)
      .nullable()
      .default(null),
    minimumMonthly: z.number().min(0).max(10000000).nullable().default(null),
    taxRate: z.number().min(0).max(40).default(18),
    locationLimit: limit.default(null),
    public: z.boolean().default(true),
    currency: z.string().trim().length(3).default("INR"),
    employeeLimit: limit,
    adminLimit: limit,
    storageLimitMb: limit,
    apiCallLimitMonthly: limit,
    aiRequestLimitMonthly: limit,
    deviceLimit: limit.default(null),
    features: z.array(z.enum(planFeatures)),
    trialDays: z.number().int().min(1).max(365).nullable(),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
const subscriptionSchema = z
  .object({
    planCode: z.string().min(1),
    employeeLimit: z.number().int().min(0).max(1000000).nullable().optional(),
    status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"]),
    trialEndsAt: z.iso.datetime({ offset: true }).nullable(),
    currentPeriodEnd: z.iso.datetime({ offset: true }).nullable(),
    graceDays: z.number().int().min(0).max(90),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

// Super Admin: plans and per-company subscriptions.
export async function platformSaas(
  req: NextRequest,
  ctx: Context,
  resource: string,
  id?: string,
) {
  if (resource === "plans") {
    if (req.method === "GET")
      return (
        await db.subscriptionPlan.findMany({
          orderBy: { sortOrder: "asc" },
          include: { _count: { select: { subscriptions: true } } },
        })
      ).map(serializePlan);
    const b = planSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = id
        ? await tx.subscriptionPlan.findUnique({ where: { id } })
        : null;
      if (id && !old) throw new AppError(404, "Plan not found.");
      const saved = old
        ? await tx.subscriptionPlan.update({ where: { id: old.id }, data: b })
        : await tx.subscriptionPlan.create({ data: b });
      await audit(
        tx,
        ctx,
        old ? "UPDATE" : "CREATE",
        "subscription_plans",
        saved.id,
        old ? JSON.parse(JSON.stringify(serializePlan(old))) : undefined,
        b,
        ip(req),
      );
      return serializePlan(saved);
    });
  }
  if (resource === "companies" && req.method === "GET") {
    const companies = await db.company.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        createdAt: true,
        subscription: { include: { plan: true } },
        status: true,
        suspendReason: true,
        legalHold: true,
        users: { where: { isSuperAdmin: true }, select: { id: true }, take: 1 },
        _count: {
          select: {
            employees: { where: { status: { not: "Inactive" } } },
            users: true,
          },
        },
      },
      orderBy: { name: "asc" },
      take: 500,
    });
    const now = new Date();
    const since = new Date(now.getTime() - 30 * day);
    const lastLogins = await db.user.groupBy({
      by: ["companyId"],
      _max: { lastLoginAt: true },
    });
    const [activeUsers, integrations, usage] = await Promise.all([
      db.session
        .groupBy({
          by: ["userId"],
          where: { lastUsedAt: { gte: since } },
        })
        .then(async (rows) =>
          db.user.groupBy({
            by: ["companyId"],
            where: { id: { in: rows.map((r) => r.userId) } },
            _count: { _all: true },
          }),
        ),
      db.integration.groupBy({
        by: ["companyId", "lastStatus"],
        where: { active: true },
        _count: { _all: true },
      }),
      db.subscriptionUsage.findMany({ where: { period: period(now) } }),
    ]);
    return companies.map((c) => {
      const sub = c.subscription;
      const eff = sub ? effectiveStatus(sub, now) : null;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        createdAt: c.createdAt,
        plan: sub?.plan.name ?? null,
        planCode: sub?.plan.code ?? null,
        storedStatus: sub?.status ?? null,
        status: eff?.status ?? null,
        trialEndsAt: sub?.trialEndsAt ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        graceDays: sub?.graceDays ?? null,
        notes: sub?.notes ?? null,
        enabledFeatures: sub?.enabledFeatures ?? [],
        disabledFeatures: sub?.disabledFeatures ?? [],
        employees: c._count.employees,
        employeeLimit: sub?.employeeLimit ?? null,
        effectiveEmployeeLimit: sub ? employeeLicenceLimit(sub) : null,
        users: c._count.users,
        companyStatus: c.status,
        deletionBlockedReason:
          c.id === ctx.companyId
            ? "You cannot delete the company you are signed in to."
            : c.users.length
              ? "Move platform owner accounts to another company before deleting this company."
              : c.legalHold
                ? "This company is under a legal hold."
                : null,
        suspendReason: c.suspendReason,
        lastLoginAt:
          lastLogins.find((l) => l.companyId === c.id)?._max.lastLoginAt ??
          null,
        activeUsers30d:
          activeUsers.find((u) => u.companyId === c.id)?._count._all ?? 0,
        apiCalls:
          usage.find((u) => u.companyId === c.id && u.metric === "api_calls")
            ?.value ?? 0,
        aiRequests:
          usage.find((u) => u.companyId === c.id && u.metric === "ai_requests")
            ?.value ?? 0,
        integrations: {
          active: integrations
            .filter((i) => i.companyId === c.id)
            .reduce((s, i) => s + i._count._all, 0),
          failing: integrations
            .filter((i) => i.companyId === c.id && i.lastStatus === "FAILED")
            .reduce((s, i) => s + i._count._all, 0),
        },
      };
    });
  }
  if (resource === "subscriptions" && id && req.method === "PUT") {
    const b = subscriptionSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`limit:${id}`}))::text`;
      const plan = await tx.subscriptionPlan.findUnique({
        where: { code: b.planCode },
      });
      if (!plan) throw new AppError(404, "Plan not found.");
      const company = await tx.company.findUnique({ where: { id } });
      if (!company) throw new AppError(404, "Company not found.");
      const old = await tx.subscription.findUnique({
        where: { companyId: id },
      });
      const employeeLimit =
        b.employeeLimit === undefined
          ? (old?.employeeLimit ?? null)
          : b.employeeLimit;
      const cap = employeeLicenceLimit({ employeeLimit, plan });
      const used = await tx.employee.count({
        where: { companyId: id, status: { not: "Inactive" } },
      });
      if (cap !== null && used > cap)
        throw new AppError(
          422,
          `This client has ${used} active employees. Deactivate ${used - cap} employee(s) before setting a ${cap}-licence limit.`,
        );
      const data = {
        planId: plan.id,
        employeeLimit,
        status: b.status,
        trialEndsAt: b.trialEndsAt ? new Date(b.trialEndsAt) : null,
        currentPeriodEnd: b.currentPeriodEnd
          ? new Date(b.currentPeriodEnd)
          : null,
        graceDays: b.graceDays,
        notes: b.notes,
        cancelledAt:
          b.status === "CANCELLED" ? (old?.cancelledAt ?? new Date()) : null,
        ...(b.status === "ACTIVE" && old?.status !== "ACTIVE"
          ? { currentPeriodStart: new Date() }
          : {}),
      };
      const saved = await tx.subscription.upsert({
        where: { companyId: id },
        create: { ...data, companyId: id },
        update: data,
      });
      // Recorded against the Super Admin's own company audit trail.
      await audit(
        tx,
        ctx,
        "UPDATE",
        "subscriptions",
        id,
        old
          ? {
              planId: old.planId,
              status: old.status,
              employeeLimit: old.employeeLimit,
            }
          : undefined,
        { ...b, company: company.code },
        ip(req),
      );
      return { ...saved, ...effectiveStatus(saved) };
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Public pricing page: active public plans and add-ons, without internals.
export async function publicPlans() {
  const [plans, addOns] = await Promise.all([
    db.subscriptionPlan.findMany({
      where: { active: true, public: true },
      orderBy: { sortOrder: "asc" },
      select: {
        code: true,
        name: true,
        description: true,
        priceMonthly: true,
        priceAnnual: true,
        pricePerEmployeeMonthly: true,
        pricePerEmployeeAnnual: true,
        minimumMonthly: true,
        currency: true,
        employeeLimit: true,
        storageLimitMb: true,
        features: true,
        trialDays: true,
        taxRate: true,
      },
    }),
    db.addOn.findMany({
      where: { active: true, public: true },
      orderBy: { name: "asc" },
      select: {
        code: true,
        name: true,
        description: true,
        priceMonthly: true,
        priceAnnual: true,
        perEmployee: true,
      },
    }),
  ]);
  return { plans: plans.map(serializePlan), addOns: addOns.map(serializePlan) };
}
