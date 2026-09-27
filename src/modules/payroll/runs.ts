import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { dayDate, workingDays } from "@/modules/time/rules";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { recordHistory } from "@/modules/employees/lifecycle";
import { notify } from "@/modules/notifications/service";
import {
  calculateMonth,
  financialYear,
  ptTemplates,
  type Structure,
} from "./statutory";
import { rulesRoute, saveRatesAsRules, statutoryConfig } from "./rules";
import {
  allocate,
  attendanceLop,
  encashment,
  instalments,
  monthBounds as monthRange,
  overtimePay,
} from "./compute";
import { loansRoute } from "./loans";

type Tx = Prisma.TransactionClient;
const eligible = ["Active", "Probation", "On notice"];
const money = z.number().finite().min(0).max(100000000);
const ptSlab = z
  .object({
    min: z.number().min(0),
    max: z.number().min(0).nullable(),
    amount: z.number().min(0).max(2500),
    februaryAmount: z.number().min(0).max(2500).optional(),
  })
  .strict();
const statutorySchema = z
  .object({
    pfEnabled: z.boolean(),
    pfWageCeiling: money,
    pfCapAtCeiling: z.boolean(),
    pfEmployeeRate: z.number().min(0).max(20),
    pfEmployerRate: z.number().min(0).max(20),
    epsRate: z.number().min(0).max(20),
    edliRate: z.number().min(0).max(5),
    pfAdminRate: z.number().min(0).max(5),
    esiEnabled: z.boolean(),
    esiWageThreshold: money,
    esiEmployeeRate: z.number().min(0).max(10),
    esiEmployerRate: z.number().min(0).max(10),
    ptEnabled: z.boolean(),
    ptState: z.string().trim().max(60).nullable(),
    ptSlabs: z.array(ptSlab).max(20),
    tdsEnabled: z.boolean(),
    lopFromAttendance: z.boolean().optional(),
    overtimeMultiplier: z.number().min(1).max(4).optional(),
    overtimeBasis: z.enum(["BASIC", "GROSS"]).optional(),
    hoursPerDay: z.number().min(1).max(24).optional(),
    encashmentDivisor: z.number().int().min(1).max(31).optional(),
  })
  .strict();
const structureSchema = z
  .object({
    basic: money,
    hra: money.default(0),
    conveyance: money.default(0),
    specialAllowance: money.default(0),
    otherAllowance: money.default(0),
    pfApplicable: z.boolean(),
    esiApplicable: z.boolean(),
    ptApplicable: z.boolean(),
    taxRegime: z.enum(["NEW", "OLD"]),
    section80C: money.default(0),
    section80D: money.default(0),
    hraExemption: money.default(0),
    otherDeductions: money.default(0),
    effectiveFrom: z.iso.date(),
  })
  .strict();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

type Stat = Awaited<ReturnType<typeof statutoryConfig>>;
type Overrides = {
  lopDays?: number;
  otherDeductions?: number;
  bonus?: number;
  incentive?: number;
  otherEarnings?: number;
};
type ItemDetails = {
  regime?: string;
  lopOverridden?: boolean;
  encashment?: { id: string; days: number }[];
  loans?: { id: string; amount: number }[];
} | null;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Unpaid days: approved unpaid leave on working days, plus days before joining.
async function lopDays(
  tx: Tx,
  companyId: string,
  employee: { id: string; joinedAt: Date },
  p: string,
) {
  const { start, end } = monthRange(p);
  const [company, holidays, leave] = await Promise.all([
    tx.company.findUniqueOrThrow({ where: { id: companyId } }),
    tx.holiday.findMany({
      where: { companyId, date: { gte: start, lte: end } },
    }),
    tx.leaveRequest.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        status: "Approved",
        leaveType: { paid: false },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    }),
  ]);
  const hol = holidays.map((h) => iso(h.date));
  let days = 0;
  for (const l of leave)
    days += workingDays(
      iso(l.startDate > start ? l.startDate : start),
      iso(l.endDate < end ? l.endDate : end),
      company.workingDays,
      hol,
    );
  if (employee.joinedAt > start)
    days += Math.round(
      (Math.min(employee.joinedAt.getTime(), end.getTime() + 86400000) -
        start.getTime()) /
        86400000,
    );
  return days;
}
async function yearToDate(
  tx: Tx,
  companyId: string,
  employeeId: string,
  p: string,
) {
  const fy = financialYear(p);
  const periods: string[] = [];
  for (
    let d = new Date(Date.UTC(fy.start, 3, 1));
    iso(d).slice(0, 7) < p;
    d.setUTCMonth(d.getUTCMonth() + 1)
  )
    periods.push(iso(d).slice(0, 7));
  const sums = await tx.payrollRunItem.aggregate({
    where: {
      companyId,
      employeeId,
      run: { status: "PROCESSED", period: { in: periods } },
    },
    _sum: { gross: true, tds: true, pfEmployee: true, pt: true },
  });
  return {
    ytdTaxableGross: sums._sum.gross ?? 0,
    ytdTds: sums._sum.tds ?? 0,
    ytdEmployeePf: sums._sum.pfEmployee ?? 0,
    ytdPt: sums._sum.pt ?? 0,
  };
}
async function computeItem(
  tx: Tx,
  run: { id: string; companyId: string; period: string },
  employee: {
    id: string;
    joinedAt: Date;
    salaryStructure: Omit<Structure, "taxRegime"> & { taxRegime: string };
  },
  stat: Stat,
  overrides: Overrides = {},
) {
  const { days } = monthRange(run.period);
  const s = employee.salaryStructure;
  // Absences from attendance are added to unpaid leave when the company
  // enables it; a manual LOP override replaces both.
  const absent =
    overrides.lopDays === undefined && stat.options.lopFromAttendance
      ? await attendanceLop(tx, run.companyId, employee, run.period)
      : 0;
  const lop = Math.min(
    days,
    overrides.lopDays ??
      (await lopDays(tx, run.companyId, employee, run.period)) + absent,
  );
  // Approved, unpaid expense claims are reimbursed through this run.
  await tx.expenseClaim.updateMany({
    where: {
      companyId: run.companyId,
      employeeId: employee.id,
      status: "APPROVED",
      payrollRunId: null,
    },
    data: { payrollRunId: run.id },
  });
  const claims = await tx.expenseClaim.aggregate({
    where: {
      payrollRunId: run.id,
      employeeId: employee.id,
      status: "APPROVED",
    },
    _sum: { amount: true },
  });
  const monthly = {
    basic: s.basic,
    gross:
      s.basic +
      s.hra +
      (s.conveyance ?? 0) +
      s.specialAllowance +
      s.otherAllowance,
  };
  const ot = await overtimePay(
    tx,
    run.companyId,
    employee.id,
    run.period,
    monthly,
    stat.options,
  );
  const enc = await encashment(
    tx,
    run.companyId,
    employee.id,
    s.basic,
    stat.options,
  );
  const due = await instalments(tx, run.companyId, employee.id, run.period);
  const variable = {
    bonus: overrides.bonus ?? 0,
    incentive: overrides.incentive ?? 0,
    otherEarnings: overrides.otherEarnings ?? 0,
  };
  const r = calculateMonth({
    period: run.period,
    structure: { ...s, taxRegime: s.taxRegime as "NEW" | "OLD" },
    config: stat.config,
    tax: stat.tax,
    paidDays: days - lop,
    totalDays: days,
    ...(await yearToDate(tx, run.companyId, employee.id, run.period)),
    reimbursements: claims._sum.amount ?? 0,
    otherDeductions: overrides.otherDeductions ?? 0,
    ...variable,
    overtimePay: ot.pay,
    encashmentPay: enc.pay,
    loanDeduction: due.loan,
    advanceDeduction: due.advance,
  });
  const data = {
    totalDays: days,
    lopDays: lop,
    paidDays: days - lop,
    absentDays: absent,
    ...variable,
    overtimeMinutes: ot.minutes,
    overtimePay: ot.pay,
    encashmentDays: enc.days,
    encashmentPay: enc.pay,
    loanDeduction: r.loanDeduction,
    advanceDeduction: r.advanceDeduction,
    earnings: r.earnings,
    gross: r.gross,
    pfWage: r.pf.wage,
    epsWage: r.pf.epsWage,
    pfEmployee: r.pf.employee,
    pfEmployerEpf: r.pf.employerEpf,
    pfEmployerEps: r.pf.employerEps,
    edli: r.pf.edli,
    pfAdmin: r.pf.admin,
    esiWage: r.esi.wage,
    esiEmployee: r.esi.employee,
    esiEmployer: r.esi.employer,
    pt: r.pt,
    tds: r.tds,
    reimbursements: r.reimbursements,
    otherDeductions: r.otherDeductions,
    deductions: r.deductions,
    netPay: r.netPay,
    employerCost: r.employerCost,
    details: {
      regime: s.taxRegime,
      projectedAnnualTaxable: r.projectedAnnualTaxable,
      projectedAnnualTax: r.projectedAnnualTax,
      lopOverridden: overrides.lopDays !== undefined,
      rules: stat.applied,
      encashment: enc.entries,
      loans: allocate(due.due, r.loanDeduction, r.advanceDeduction),
    },
  };
  return tx.payrollRunItem.upsert({
    where: { runId_employeeId: { runId: run.id, employeeId: employee.id } },
    create: {
      ...data,
      companyId: run.companyId,
      runId: run.id,
      employeeId: employee.id,
    },
    update: data,
  });
}
async function totals(tx: Tx, runId: string) {
  const s = await tx.payrollRunItem.aggregate({
    where: { runId },
    _count: { _all: true },
    _sum: {
      gross: true,
      deductions: true,
      netPay: true,
      pfEmployee: true,
      pfEmployerEpf: true,
      pfEmployerEps: true,
      edli: true,
      pfAdmin: true,
      esiEmployee: true,
      esiEmployer: true,
      pt: true,
      tds: true,
      reimbursements: true,
      overtimePay: true,
      encashmentPay: true,
      loanDeduction: true,
      advanceDeduction: true,
      employerCost: true,
    },
  });
  return { employees: s._count._all, ...s._sum };
}
async function calculateRun(
  tx: Tx,
  run: { id: string; companyId: string; period: string },
) {
  const { end } = monthRange(run.period);
  const stat = await statutoryConfig(run.companyId, tx, run.period);
  const employees = await tx.employee.findMany({
    where: {
      companyId: run.companyId,
      status: { in: eligible },
      joinedAt: { lte: end },
      salaryStructure: { isNot: null },
    },
    include: { salaryStructure: true },
  });
  const existing = await tx.payrollRunItem.findMany({
    where: { runId: run.id },
  });
  for (const e of employees) {
    const old = existing.find((i) => i.employeeId === e.id);
    const overridden = (old?.details as ItemDetails)?.lopOverridden;
    await computeItem(
      tx,
      run,
      { ...e, salaryStructure: e.salaryStructure! },
      stat,
      {
        lopDays: overridden ? old!.lopDays : undefined,
        otherDeductions: old?.otherDeductions,
        bonus: old?.bonus,
        incentive: old?.incentive,
        otherEarnings: old?.otherEarnings,
      },
    );
  }
  const missing = await tx.employee.count({
    where: {
      companyId: run.companyId,
      status: { in: eligible },
      joinedAt: { lte: end },
      salaryStructure: null,
    },
  });
  const summary = { ...(await totals(tx, run.id)), missingStructures: missing };
  await tx.payrollRun.update({
    where: { id: run.id },
    data: { totals: summary as Prisma.InputJsonValue },
  });
  return summary;
}
async function findRun(ctx: Context, id: string, tx: Tx | typeof db = db) {
  const run = await tx.payrollRun.findFirst({
    where: { id, companyId: ctx.companyId },
  });
  if (!run) throw new AppError(404, "Payroll run not found.");
  return run;
}
const mutate = <T>(ctx: Context, run: (tx: Tx) => Promise<T>) =>
  db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${ctx.companyId}`}))::text`;
      return run(tx);
    },
    { timeout: 60000 },
  );

function csv(rows: (string | number)[][], name: string) {
  const cell = (v: string | number) => {
    const s = String(v);
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
  };
  return new NextResponse(
    "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
        "cache-control": "no-store",
      },
    },
  );
}
async function statutoryReport(ctx: Context, runId: string, kind: string) {
  requirePermission(ctx, "payroll.read");
  const run = await findRun(ctx, runId);
  const items = await db.payrollRunItem.findMany({
    where: { runId: run.id },
    include: {
      employee: {
        select: {
          employeeCode: true,
          firstName: true,
          middleName: true,
          lastName: true,
          sensitiveEncrypted: true,
        },
      },
    },
    orderBy: { employee: { employeeCode: "asc" } },
  });
  // Statutory identifiers are shown only to users allowed to read them.
  const ids = (e: (typeof items)[number]["employee"]) => {
    if (
      !ctx.permissions.includes("employees.sensitive") ||
      !e.sensitiveEncrypted
    )
      return { uan: "", esiNumber: "", pan: "" };
    const s = decrypt(e.sensitiveEncrypted);
    return { uan: s.uan ?? "", esiNumber: s.esiNumber ?? "", pan: s.pan ?? "" };
  };
  const name = (e: (typeof items)[number]["employee"]) =>
    [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
  const r = Math.round;
  const file = `${kind}-${run.period}`;
  if (kind === "pf-ecr") {
    // EPFO ECR text format: fields separated by #~#.
    const lines = items
      .filter((i) => i.pfWage > 0)
      .map((i) =>
        [
          ids(i.employee).uan,
          name(i.employee).toUpperCase(),
          r(i.gross),
          r(i.pfWage),
          r(i.epsWage),
          r(i.epsWage),
          r(i.pfEmployee),
          r(i.pfEmployerEps),
          r(i.pfEmployerEpf),
          r(i.lopDays),
          0,
        ].join("#~#"),
      );
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${file}.txt"`,
        "cache-control": "no-store",
      },
    });
  }
  if (kind === "esi")
    return csv(
      [
        [
          "IP Number",
          "IP Name",
          "No of Days for which wages paid",
          "Total Monthly Wages",
          "Employee contribution",
          "Employer contribution",
          "Reason Code for Zero workings days",
          "Last Working Day",
        ],
        ...items
          .filter((i) => i.esiWage > 0)
          .map((i) => [
            ids(i.employee).esiNumber,
            name(i.employee),
            i.paidDays,
            r(i.esiWage),
            i.esiEmployee,
            i.esiEmployer,
            "",
            "",
          ]),
      ],
      file,
    );
  if (kind === "pt")
    return csv(
      [
        ["Employee code", "Name", "Gross wages", "Professional tax"],
        ...items
          .filter((i) => i.pt > 0)
          .map((i) => [
            i.employee.employeeCode,
            name(i.employee),
            i.gross,
            i.pt,
          ]),
        [
          "",
          "Total",
          items.reduce((s, i) => s + i.gross, 0),
          items.reduce((s, i) => s + i.pt, 0),
        ],
      ],
      file,
    );
  if (kind === "tds")
    return csv(
      [
        [
          "Employee code",
          "Name",
          "PAN",
          "Regime",
          "Gross this month",
          "TDS this month",
          "Projected annual taxable income",
          "Projected annual tax",
        ],
        ...items.map((i) => {
          const d = i.details as {
            regime?: string;
            projectedAnnualTaxable?: number;
            projectedAnnualTax?: number;
          } | null;
          return [
            i.employee.employeeCode,
            name(i.employee),
            ids(i.employee).pan,
            d?.regime ?? "",
            i.gross,
            i.tds,
            d?.projectedAnnualTaxable ?? "",
            d?.projectedAnnualTax ?? "",
          ];
        }),
      ],
      file,
    );
  if (kind === "register")
    return csv(
      [
        [
          "Employee code",
          "Name",
          "Days",
          "LOP days",
          "Paid days",
          "Basic",
          "HRA",
          "Conveyance",
          "Special allowance",
          "Other allowance",
          "Bonus",
          "Incentive",
          "Overtime",
          "Leave encashment",
          "Other earnings",
          "Gross",
          "PF (employee)",
          "ESI (employee)",
          "PT",
          "TDS",
          "Loan",
          "Advance",
          "Other deductions",
          "Reimbursements",
          "Net pay",
          "PF EPF (employer)",
          "PF EPS (employer)",
          "EDLI",
          "PF admin",
          "ESI (employer)",
          "Employer cost",
        ],
        ...items.map((i) => {
          const e = i.earnings as Record<string, number>;
          return [
            i.employee.employeeCode,
            name(i.employee),
            i.totalDays,
            i.lopDays,
            i.paidDays,
            e.basic,
            e.hra,
            e.conveyance ?? 0,
            e.specialAllowance,
            e.otherAllowance,
            i.bonus,
            i.incentive,
            i.overtimePay,
            i.encashmentPay,
            i.otherEarnings,
            i.gross,
            i.pfEmployee,
            i.esiEmployee,
            i.pt,
            i.tds,
            i.loanDeduction,
            i.advanceDeduction,
            i.otherDeductions,
            i.reimbursements,
            i.netPay,
            i.pfEmployerEpf,
            i.pfEmployerEps,
            i.edli,
            i.pfAdmin,
            i.esiEmployer,
            i.employerCost,
          ];
        }),
      ],
      file,
    );
  throw new AppError(404, "Unknown report.");
}

export async function payrollAdmin(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action, sub] = path;
  const method = req.method;
  const read = () => requirePermission(ctx, "payroll.read");
  const manage = () => requirePermission(ctx, "payroll.manage");

  if (resource === "statutory") {
    if (method === "GET") {
      read();
      return { ...(await statutoryConfig(ctx.companyId)), ptTemplates };
    }
    manage();
    const { ptState, ...config } = statutorySchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      // Rates that differ from the effective rules become company rules
      // effective from the start of the financial year.
      await saveRatesAsRules(tx, ctx, config, ptState);
      const saved = await tx.statutorySetting.upsert({
        where: { companyId: ctx.companyId },
        create: {
          companyId: ctx.companyId,
          config,
          ptState,
          updatedBy: ctx.userId,
        },
        update: { config, ptState, updatedBy: ctx.userId },
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "statutory_settings",
        ctx.companyId,
        undefined,
        { ...config, ptState },
        ip(req),
      );
      return saved;
    });
  }

  if (resource === "statutory-rules") return rulesRoute(req, ctx, id, false);
  if (resource === "loans") return loansRoute(req, ctx, id);

  if (resource === "structures") {
    if (!id && method === "GET") {
      read();
      const search = req.nextUrl.searchParams.get("search") ?? "";
      return db.employee.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: eligible },
          ...(search
            ? {
                OR: [
                  { firstName: { contains: search, mode: "insensitive" } },
                  { lastName: { contains: search, mode: "insensitive" } },
                  { employeeCode: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          salaryStructure: true,
        },
        orderBy: { employeeCode: "asc" },
        take: 200,
      });
    }
    if (id && method === "PUT") {
      manage();
      const b = structureSchema.parse(await json(req));
      return db.$transaction(async (tx) => {
        const e = await tx.employee.findFirst({
          where: { id, companyId: ctx.companyId },
        });
        if (!e) throw new AppError(404, "Employee not found.");
        const data = { ...b, effectiveFrom: dayDate(b.effectiveFrom) };
        const saved = await tx.salaryStructure.upsert({
          where: { employeeId: e.id },
          create: { ...data, companyId: ctx.companyId, employeeId: e.id },
          update: data,
        });
        // Salary amounts are not copied into history or the audit log.
        await recordHistory(
          tx,
          ctx,
          e.id,
          "SALARY_REVISION",
          dayDate(b.effectiveFrom),
          undefined,
          { taxRegime: b.taxRegime },
        );
        await audit(
          tx,
          ctx,
          "UPDATE",
          "salary_structures",
          e.id,
          undefined,
          { taxRegime: b.taxRegime, effectiveFrom: b.effectiveFrom },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "runs") {
    if (!id && method === "GET") {
      read();
      return db.payrollRun.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { period: "desc" },
        take: 36,
      });
    }
    if (!id && method === "POST") {
      manage();
      const b = z
        .object({ period })
        .strict()
        .parse(await json(req));
      return mutate(ctx, async (tx) => {
        if (
          await tx.payrollRun.findUnique({
            where: {
              companyId_period: { companyId: ctx.companyId, period: b.period },
            },
          })
        )
          throw new AppError(
            409,
            "A payroll run already exists for this month.",
          );
        const run = await tx.payrollRun.create({
          data: {
            companyId: ctx.companyId,
            period: b.period,
            createdBy: ctx.userId,
          },
        });
        const summary = await calculateRun(tx, run);
        await audit(
          tx,
          ctx,
          "CREATE",
          "payroll_runs",
          run.id,
          undefined,
          { period: b.period },
          ip(req),
        );
        return { ...run, totals: summary };
      });
    }
    if (id && !action && method === "GET") {
      read();
      const run = await findRun(ctx, id);
      const items = await db.payrollRunItem.findMany({
        where: { runId: run.id },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { employee: { employeeCode: "asc" } },
      });
      return { ...run, items };
    }
    if (id && !action && method === "DELETE") {
      manage();
      return mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        if (run.status !== "DRAFT")
          throw new AppError(
            409,
            "Only a draft payroll can be deleted.",
            "PAYROLL_LOCKED",
          );
        await tx.expenseClaim.updateMany({
          where: { payrollRunId: run.id },
          data: { payrollRunId: null },
        });
        await tx.payrollRun.delete({ where: { id: run.id } });
        await audit(
          tx,
          ctx,
          "DELETE",
          "payroll_runs",
          run.id,
          { period: run.period },
          undefined,
          ip(req),
        );
        return { deleted: true };
      });
    }
    if (id && action === "recalculate" && method === "POST") {
      manage();
      return mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        if (run.status !== "DRAFT")
          throw new AppError(
            409,
            "Only a draft payroll can be changed. Reject it back to draft first.",
            "PAYROLL_LOCKED",
          );
        return calculateRun(tx, run);
      });
    }
    if (id && action === "items" && sub && method === "PUT") {
      manage();
      const b = z
        .object({
          lopDays: z.number().min(0).max(31).optional(),
          otherDeductions: money.optional(),
          bonus: money.optional(),
          incentive: money.optional(),
          otherEarnings: money.optional(),
          reason: z.string().trim().min(3).max(300),
        })
        .strict()
        .parse(await json(req));
      return mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        if (run.status !== "DRAFT")
          throw new AppError(
            409,
            "Only a draft payroll can be changed. Reject it back to draft first.",
            "PAYROLL_LOCKED",
          );
        const item = await tx.payrollRunItem.findFirst({
          where: { id: sub, runId: run.id },
        });
        if (!item) throw new AppError(404, "Payroll line not found.");
        const e = await tx.employee.findUniqueOrThrow({
          where: { id: item.employeeId },
          include: { salaryStructure: true },
        });
        if (!e.salaryStructure)
          throw new AppError(
            409,
            "The employee no longer has a salary structure.",
          );
        const stat = await statutoryConfig(ctx.companyId, tx, run.period);
        const kept = (item.details as ItemDetails)?.lopOverridden;
        const saved = await computeItem(
          tx,
          run,
          { ...e, salaryStructure: e.salaryStructure },
          stat,
          {
            lopDays: b.lopDays ?? (kept ? item.lopDays : undefined),
            otherDeductions: b.otherDeductions ?? item.otherDeductions,
            bonus: b.bonus ?? item.bonus,
            incentive: b.incentive ?? item.incentive,
            otherEarnings: b.otherEarnings ?? item.otherEarnings,
          },
        );
        await tx.payrollRun.update({
          where: { id: run.id },
          data: { totals: (await totals(tx, run.id)) as Prisma.InputJsonValue },
        });
        await audit(
          tx,
          ctx,
          "ADJUST",
          "payroll_runs",
          run.id,
          {
            lopDays: item.lopDays,
            otherDeductions: item.otherDeductions,
            bonus: item.bonus,
            incentive: item.incentive,
            otherEarnings: item.otherEarnings,
          },
          {
            employeeId: e.id,
            lopDays: saved.lopDays,
            otherDeductions: saved.otherDeductions,
            bonus: saved.bonus,
            incentive: saved.incentive,
            otherEarnings: saved.otherEarnings,
            reason: b.reason,
          },
          ip(req),
        );
        return saved;
      });
    }
    if (id && action === "submit" && method === "POST") {
      manage();
      return mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        if (run.status !== "DRAFT")
          throw new AppError(409, "Only a draft payroll can be submitted.");
        const summary = await calculateRun(tx, run);
        if (!summary.employees)
          throw new AppError(
            422,
            "There are no employees with salary structures to pay.",
          );
        const saved = await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: "SUBMITTED",
            submittedBy: ctx.userId,
            submittedAt: new Date(),
            approvedBy: null,
            approvedAt: null,
            reviewNote: null,
            totals: summary as Prisma.InputJsonValue,
          },
        });
        await audit(
          tx,
          ctx,
          "SUBMIT",
          "payroll_runs",
          run.id,
          undefined,
          { period: run.period, employees: summary.employees },
          ip(req),
        );
        return saved;
      });
    }
    if (
      id &&
      (action === "approve" || action === "reject") &&
      method === "POST"
    ) {
      requirePermission(ctx, "payroll.approve");
      const b = z
        .object({ note: z.string().trim().max(500).optional() })
        .strict()
        .parse(await json(req));
      return mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        const allowed =
          action === "approve" ? ["SUBMITTED"] : ["SUBMITTED", "APPROVED"];
        if (!allowed.includes(run.status))
          throw new AppError(
            409,
            action === "approve"
              ? "Only a submitted payroll can be approved."
              : "Only a submitted or approved payroll can be sent back.",
          );
        if (action === "approve" && run.submittedBy === ctx.userId)
          throw new AppError(
            403,
            "Payroll must be approved by someone other than the person who submitted it.",
            "SELF_APPROVAL",
          );
        if (action === "reject" && !b.note)
          throw new AppError(422, "Give a reason for sending it back.");
        const saved = await tx.payrollRun.update({
          where: { id: run.id },
          data:
            action === "approve"
              ? {
                  status: "APPROVED",
                  approvedBy: ctx.userId,
                  approvedAt: new Date(),
                  reviewNote: b.note ?? null,
                }
              : {
                  status: "DRAFT",
                  approvedBy: null,
                  approvedAt: null,
                  reviewNote: b.note,
                },
        });
        await audit(
          tx,
          ctx,
          action === "approve" ? "APPROVE" : "REJECT",
          "payroll_runs",
          run.id,
          { status: run.status },
          { status: saved.status, note: b.note },
          ip(req),
        );
        return saved;
      });
    }
    if (id && action === "process" && method === "POST") {
      manage();
      const processed = await mutate(ctx, async (tx) => {
        const run = await findRun(ctx, id, tx);
        if (run.status !== "APPROVED")
          throw new AppError(
            409,
            run.status === "PROCESSED"
              ? "This payroll run is already processed."
              : "Payroll must be submitted and approved before it is processed.",
          );
        const summary = run.totals;
        const { start, end } = monthRange(run.period);
        const items = await tx.payrollRunItem.findMany({
          where: { runId: run.id },
        });
        if (!items.length)
          throw new AppError(
            422,
            "There are no employees with salary structures to pay.",
          );
        for (const i of items) {
          const d = i.details as ItemDetails;
          // Recover loan instalments and settle encashed leave. Anything
          // changed since approval sends the run back for recalculation.
          for (const l of d?.loans ?? []) {
            const loan = await tx.employeeLoan.findFirst({
              where: { id: l.id, companyId: ctx.companyId, status: "ACTIVE" },
            });
            if (!loan || loan.balance + 0.5 < l.amount)
              throw new AppError(
                409,
                "A loan changed after approval. Send the payroll back to draft and recalculate.",
                "PAYROLL_STALE",
              );
            const balance = Math.max(0, Math.round(loan.balance - l.amount));
            await tx.employeeLoan.update({
              where: { id: loan.id },
              data: { balance, ...(balance === 0 ? { status: "CLOSED" } : {}) },
            });
            await tx.loanRepayment.create({
              data: {
                companyId: ctx.companyId,
                loanId: loan.id,
                runId: run.id,
                amount: l.amount,
              },
            });
          }
          const encashed = d?.encashment ?? [];
          const encDays = encashed.reduce((a, e) => a + e.days, 0);
          for (const e of encashed) {
            const done = await tx.leaveLedger.updateMany({
              where: { id: e.id, companyId: ctx.companyId, amount: null },
              data: {
                amount: Math.round((i.encashmentPay * e.days) / encDays),
                refId: run.id,
              },
            });
            if (!done.count)
              throw new AppError(
                409,
                "Encashed leave was already paid. Send the payroll back to draft and recalculate.",
                "PAYROLL_STALE",
              );
          }
          const clash = await tx.payslip.findUnique({
            where: {
              companyId_employeeId_periodStart_periodEnd: {
                companyId: ctx.companyId,
                employeeId: i.employeeId,
                periodStart: start,
                periodEnd: end,
              },
            },
          });
          if (clash)
            throw new AppError(
              409,
              "A payslip for this month already exists for one of the employees. Remove it before processing.",
            );
          const slip = await tx.payslip.create({
            data: {
              companyId: ctx.companyId,
              employeeId: i.employeeId,
              periodStart: start,
              periodEnd: end,
              grossPay: i.gross,
              deductions: i.deductions,
              netPay: i.netPay,
              breakdown: {
                earnings: i.earnings,
                deductions: {
                  pf: i.pfEmployee,
                  esi: i.esiEmployee,
                  professionalTax: i.pt,
                  tds: i.tds,
                  loan: i.loanDeduction,
                  advance: i.advanceDeduction,
                  other: i.otherDeductions,
                },
                reimbursements: i.reimbursements,
                days: {
                  total: i.totalDays,
                  lop: i.lopDays,
                  paid: i.paidDays,
                  absent: i.absentDays,
                },
                overtime: { minutes: i.overtimeMinutes, pay: i.overtimePay },
                encashment: { days: i.encashmentDays, pay: i.encashmentPay },
                employer: {
                  pfEpf: i.pfEmployerEpf,
                  pfEps: i.pfEmployerEps,
                  edli: i.edli,
                  pfAdmin: i.pfAdmin,
                  esi: i.esiEmployer,
                },
              } as Prisma.InputJsonValue,
            },
          });
          await tx.payrollRunItem.update({
            where: { id: i.id },
            data: { payslipId: slip.id },
          });
          await enqueueWebhook(tx, ctx.companyId, "payslip.generated", {
            id: slip.id,
            employeeId: i.employeeId,
            periodStart: iso(start),
            periodEnd: iso(end),
          });
        }
        await tx.expenseClaim.updateMany({
          where: { payrollRunId: run.id, status: "APPROVED" },
          data: { status: "REIMBURSED", reimbursedAt: new Date() },
        });
        const saved = await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: "PROCESSED",
            processedBy: ctx.userId,
            processedAt: new Date(),
            totals: summary ?? undefined,
          },
        });
        await enqueueWebhook(tx, ctx.companyId, "payroll.processed", {
          runId: run.id,
          period: run.period,
          employees: items.length,
        });
        await audit(
          tx,
          ctx,
          "PROCESS",
          "payroll_runs",
          run.id,
          undefined,
          { period: run.period, employees: items.length },
          ip(req),
        );
        return saved;
      });
      const paid = await db.payrollRunItem.findMany({
        where: { runId: processed.id },
        select: { employee: { select: { userId: true } } },
      });
      await notify(
        ctx.companyId,
        paid.map((p) => p.employee.userId),
        "payslip.generated",
        { period: processed.period },
        "/payslips",
      );
      return processed;
    }
    if (id && action === "reports" && sub && method === "GET")
      return statutoryReport(ctx, id, sub);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
