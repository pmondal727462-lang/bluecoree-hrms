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
import { dayDate } from "@/modules/time/rules";
import {
  defaultStatutory,
  taxRules,
  type PtSlab,
  type StatutoryConfig,
  type TaxRule,
  type TaxTables,
} from "./statutory";

type Tx = Prisma.TransactionClient | typeof db;
export const ruleTypes = ["PF", "ESI", "PT", "INCOME_TAX"] as const;

// Company payroll options kept with the statutory switches.
export type PayrollOptions = {
  lopFromAttendance: boolean;
  overtimeMultiplier: number;
  overtimeBasis: "BASIC" | "GROSS";
  hoursPerDay: number;
  encashmentDivisor: number;
};
export const defaultOptions: PayrollOptions = {
  lopFromAttendance: false,
  overtimeMultiplier: 2,
  overtimeBasis: "BASIC",
  hoursPerDay: 8,
  encashmentDivisor: 30,
};

function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 0)),
  };
}
type Rule = Prisma.StatutoryRuleGetPayload<object>;
// The rule in force for the period: a company rule beats a platform default,
// then the latest effective date wins.
function pick(
  rules: Rule[],
  type: string,
  match: (r: Rule) => boolean = () => true,
) {
  return (
    rules
      .filter((r) => r.ruleType === type && match(r))
      .sort(
        (a, b) =>
          Number(!!b.companyId) - Number(!!a.companyId) ||
          b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
      )[0] ?? null
  );
}
export async function effectiveRules(
  tx: Tx,
  companyId: string,
  period: string,
) {
  const { start, end } = periodRange(period);
  return tx.statutoryRule.findMany({
    where: {
      active: true,
      country: "IN",
      OR: [{ companyId: null }, { companyId }],
      effectiveFrom: { lte: end },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }],
    },
  });
}

// Statutory configuration for a pay period: switches and options from the
// company settings, rates from the effective rules.
export async function statutoryConfig(
  companyId: string,
  tx: Tx = db,
  period = new Date().toISOString().slice(0, 7),
) {
  const row = await tx.statutorySetting.findUnique({ where: { companyId } });
  const saved = (row?.config ?? {}) as Partial<
    StatutoryConfig & PayrollOptions
  >;
  const ptState = row?.ptState ?? null;
  const rules = await effectiveRules(tx, companyId, period);
  const pf = pick(rules, "PF");
  const esi = pick(rules, "ESI");
  const pt = ptState ? pick(rules, "PT", (r) => r.state === ptState) : null;
  const pfConfig = (pf?.config ?? {}) as Record<string, number | boolean>;
  const config: StatutoryConfig = {
    ...defaultStatutory,
    pfEnabled: saved.pfEnabled ?? defaultStatutory.pfEnabled,
    esiEnabled: saved.esiEnabled ?? defaultStatutory.esiEnabled,
    ptEnabled: saved.ptEnabled ?? defaultStatutory.ptEnabled,
    tdsEnabled: saved.tdsEnabled ?? defaultStatutory.tdsEnabled,
    ...(pf
      ? {
          pfEmployeeRate: pf.employeeRate ?? defaultStatutory.pfEmployeeRate,
          pfEmployerRate: pf.employerRate ?? defaultStatutory.pfEmployerRate,
          pfWageCeiling: pf.ceiling ?? defaultStatutory.pfWageCeiling,
          epsRate: Number(pfConfig.epsRate ?? defaultStatutory.epsRate),
          edliRate: Number(pfConfig.edliRate ?? defaultStatutory.edliRate),
          pfAdminRate: Number(
            pfConfig.adminRate ?? defaultStatutory.pfAdminRate,
          ),
          pfCapAtCeiling:
            pfConfig.capAtCeiling === undefined
              ? defaultStatutory.pfCapAtCeiling
              : Boolean(pfConfig.capAtCeiling),
        }
      : {}),
    ...(esi
      ? {
          esiEmployeeRate: esi.employeeRate ?? defaultStatutory.esiEmployeeRate,
          esiEmployerRate: esi.employerRate ?? defaultStatutory.esiEmployerRate,
          esiWageThreshold: esi.threshold ?? defaultStatutory.esiWageThreshold,
        }
      : {}),
    ptSlabs: pt
      ? (((pt.config as { slabs?: PtSlab[] }).slabs ?? []) as PtSlab[])
      : [],
  };
  const tax = (regime: "NEW" | "OLD"): TaxRule => {
    const r = pick(
      rules,
      "INCOME_TAX",
      (x) => (x.config as { regime?: string }).regime === regime,
    );
    return r
      ? { ...taxRules[regime], ...(r.config as Partial<TaxRule>) }
      : taxRules[regime];
  };
  const tables: TaxTables = { NEW: tax("NEW"), OLD: tax("OLD") };
  const options: PayrollOptions = {
    lopFromAttendance:
      saved.lopFromAttendance ?? defaultOptions.lopFromAttendance,
    overtimeMultiplier:
      saved.overtimeMultiplier ?? defaultOptions.overtimeMultiplier,
    overtimeBasis: saved.overtimeBasis ?? defaultOptions.overtimeBasis,
    hoursPerDay: saved.hoursPerDay ?? defaultOptions.hoursPerDay,
    encashmentDivisor:
      saved.encashmentDivisor ?? defaultOptions.encashmentDivisor,
  };
  return {
    config,
    tax: tables,
    options,
    ptState,
    configured: !!row,
    applied: {
      PF: pf?.id ?? null,
      ESI: esi?.id ?? null,
      PT: pt?.id ?? null,
      INCOME_TAX_NEW:
        pick(
          rules,
          "INCOME_TAX",
          (x) => (x.config as { regime?: string }).regime === "NEW",
        )?.id ?? null,
      INCOME_TAX_OLD:
        pick(
          rules,
          "INCOME_TAX",
          (x) => (x.config as { regime?: string }).regime === "OLD",
        )?.id ?? null,
    },
  };
}

// Rates entered on the statutory settings screen become a company rule from
// the start of the current financial year when they differ from the rules.
export async function saveRatesAsRules(
  tx: Prisma.TransactionClient,
  ctx: Context,
  rates: StatutoryConfig,
  ptState: string | null,
) {
  const period = new Date().toISOString().slice(0, 7);
  const { config } = await statutoryConfig(ctx.companyId, tx, period);
  const [y, m] = period.split("-").map(Number);
  const fyStart = dayDate(`${m >= 4 ? y : y - 1}-04-01`);
  const upsert = async (
    ruleType: string,
    state: string | null,
    data: Omit<
      Prisma.StatutoryRuleUncheckedCreateInput,
      "companyId" | "ruleType" | "effectiveFrom" | "state"
    >,
  ) => {
    const existing = await tx.statutoryRule.findFirst({
      where: {
        companyId: ctx.companyId,
        ruleType,
        state,
        effectiveFrom: fyStart,
      },
    });
    if (existing)
      await tx.statutoryRule.update({ where: { id: existing.id }, data });
    else
      await tx.statutoryRule.create({
        data: {
          ...data,
          companyId: ctx.companyId,
          ruleType,
          state,
          effectiveFrom: fyStart,
          createdBy: ctx.userId,
        },
      });
  };
  const changed = (keys: (keyof StatutoryConfig)[]) =>
    keys.some((k) => JSON.stringify(rates[k]) !== JSON.stringify(config[k]));
  if (
    changed([
      "pfEmployeeRate",
      "pfEmployerRate",
      "pfWageCeiling",
      "epsRate",
      "edliRate",
      "pfAdminRate",
      "pfCapAtCeiling",
    ])
  )
    await upsert("PF", null, {
      name: "Provident Fund (company)",
      employeeRate: rates.pfEmployeeRate,
      employerRate: rates.pfEmployerRate,
      ceiling: rates.pfWageCeiling,
      calculationMethod: "PERCENT_OF_BASIC",
      config: {
        epsRate: rates.epsRate,
        edliRate: rates.edliRate,
        adminRate: rates.pfAdminRate,
        capAtCeiling: rates.pfCapAtCeiling,
      },
    });
  if (changed(["esiEmployeeRate", "esiEmployerRate", "esiWageThreshold"]))
    await upsert("ESI", null, {
      name: "State Insurance (company)",
      employeeRate: rates.esiEmployeeRate,
      employerRate: rates.esiEmployerRate,
      threshold: rates.esiWageThreshold,
      calculationMethod: "PERCENT_OF_GROSS",
    });
  if (ptState && rates.ptSlabs.length && changed(["ptSlabs"]))
    await upsert("PT", ptState, {
      name: `Professional tax - ${ptState} (company)`,
      calculationMethod: "SLAB",
      config: { slabs: rates.ptSlabs },
    });
}

const slab = z
  .object({
    upTo: z.number().min(0).nullable(),
    rate: z.number().min(0).max(100),
  })
  .strict();
const ptSlab = z
  .object({
    min: z.number().min(0),
    max: z.number().min(0).nullable(),
    amount: z.number().min(0).max(10000),
    februaryAmount: z.number().min(0).max(10000).optional(),
  })
  .strict();
export const ruleSchema = z
  .object({
    ruleType: z.enum(ruleTypes),
    name: z.string().trim().min(2).max(120),
    state: z.string().trim().max(60).nullable().default(null),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable().default(null),
    employeeRate: z.number().min(0).max(100).nullable().default(null),
    employerRate: z.number().min(0).max(100).nullable().default(null),
    threshold: z.number().min(0).nullable().default(null),
    ceiling: z.number().min(0).nullable().default(null),
    calculationMethod: z.enum(["PERCENT_OF_BASIC", "PERCENT_OF_GROSS", "SLAB"]),
    config: z
      .object({
        epsRate: z.number().min(0).max(20).optional(),
        edliRate: z.number().min(0).max(5).optional(),
        adminRate: z.number().min(0).max(5).optional(),
        capAtCeiling: z.boolean().optional(),
        slabs: z.array(ptSlab).max(30).optional(),
        regime: z.enum(["NEW", "OLD"]).optional(),
        standardDeduction: z.number().min(0).optional(),
        rebateLimit: z.number().min(0).optional(),
        marginalRelief: z.boolean().optional(),
        cessRate: z.number().min(0).max(20).optional(),
        surchargeCap: z.number().min(0).max(50).optional(),
        taxSlabs: z.array(slab).max(20).optional(),
      })
      .strict()
      .default({}),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((r) => !r.effectiveTo || r.effectiveTo >= r.effectiveFrom, {
    message: "The end date must be on or after the start date.",
  })
  .refine(
    (r) => r.ruleType !== "PT" || (!!r.state && !!r.config.slabs?.length),
    {
      message: "Professional tax needs a state and its slabs.",
    },
  )
  .refine(
    (r) =>
      r.ruleType !== "INCOME_TAX" ||
      (!!r.config.regime && !!r.config.taxSlabs?.length),
    {
      message: "Income tax needs a regime and its slabs.",
    },
  );
// Stored config keeps income-tax slabs under "slabs" like the calculator.
function toData(b: z.infer<typeof ruleSchema>) {
  const { taxSlabs, ...config } = b.config;
  return {
    ruleType: b.ruleType,
    name: b.name,
    state: b.state,
    effectiveFrom: dayDate(b.effectiveFrom),
    effectiveTo: b.effectiveTo ? dayDate(b.effectiveTo) : null,
    employeeRate: b.employeeRate,
    employerRate: b.employerRate,
    threshold: b.threshold,
    ceiling: b.ceiling,
    calculationMethod: b.calculationMethod,
    config: (taxSlabs
      ? { ...config, slabs: taxSlabs }
      : config) as Prisma.InputJsonValue,
    active: b.active,
  };
}

// Company view: effective rules for a period, and company overrides.
// Platform view (companyId null): provider-maintained defaults.
export async function rulesRoute(
  req: NextRequest,
  ctx: Context,
  id: string | undefined,
  platform: boolean,
) {
  const owner = platform ? null : ctx.companyId;
  if (req.method === "GET") {
    if (!platform) requirePermission(ctx, "payroll.read");
    const period =
      req.nextUrl.searchParams.get("period") ??
      new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new AppError(422, "Use YYYY-MM.");
    const items = await db.statutoryRule.findMany({
      where: platform
        ? { companyId: null }
        : { OR: [{ companyId: null }, { companyId: ctx.companyId }] },
      orderBy: [
        { ruleType: "asc" },
        { state: "asc" },
        { effectiveFrom: "desc" },
      ],
      take: 500,
    });
    const effective = platform
      ? null
      : await statutoryConfig(ctx.companyId, db, period);
    return {
      period,
      items: items.map((r) => ({
        ...r,
        scope: r.companyId ? "COMPANY" : "PLATFORM",
      })),
      applied: effective?.applied ?? null,
    };
  }
  if (!platform) requirePermission(ctx, "payroll.manage");
  const b = ruleSchema.parse(await json(req));
  return db.$transaction(async (tx) => {
    if (id) {
      const old = await tx.statutoryRule.findFirst({
        where: { id, companyId: owner },
      });
      if (!old) throw new AppError(404, "Rule not found.", "NOT_FOUND");
    }
    const data = toData(b);
    const saved = id
      ? await tx.statutoryRule.update({ where: { id }, data })
      : await tx.statutoryRule.create({
          data: { ...data, companyId: owner, createdBy: ctx.userId },
        });
    await audit(
      tx,
      ctx,
      id ? "UPDATE" : "CREATE",
      "statutory_rules",
      saved.id,
      undefined,
      {
        ruleType: saved.ruleType,
        state: saved.state,
        effectiveFrom: b.effectiveFrom,
        platform,
      },
      ip(req),
    );
    return saved;
  });
}
