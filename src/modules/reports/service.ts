import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { exportFormats, exportTable } from "@/lib/export";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import type { PermissionKey } from "@/config/permissions";

type Value = string | number | boolean | null;
type Field = {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  get: (row: never) => Value;
};
type Range = { gte?: Date; lte?: Date } | undefined;
type Dataset = {
  label: string;
  permission: PermissionKey;
  dateLabel: string;
  fields: Field[];
  load: (
    companyId: string,
    range: Range,
    from?: string,
    to?: string,
  ) => Promise<unknown[]>;
};
const scanLimit = 20000;
const outputLimit = 5000;
const d = (v: Date | null | undefined) =>
  v ? v.toISOString().slice(0, 10) : null;
const name = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;
const f = <T>(
  key: string,
  label: string,
  type: Field["type"],
  get: (row: T) => Value,
): Field => ({ key, label, type, get: get as Field["get"] });
const employeeRef = {
  select: {
    employeeCode: true,
    firstName: true,
    lastName: true,
    department: { select: { name: true } },
  },
};
type EmpRef = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  department: { name: string } | null;
};
const empFields = <T extends { employee: EmpRef }>() => [
  f<T>(
    "employeeCode",
    "Employee code",
    "string",
    (r) => r.employee.employeeCode,
  ),
  f<T>("employeeName", "Employee", "string", (r) => name(r.employee)),
  f<T>(
    "department",
    "Department",
    "string",
    (r) => r.employee.department?.name ?? null,
  ),
];

// Allow-listed datasets. Each requires its module's read permission; identity
// and bank details are never exposed here.
export const datasets: Record<string, Dataset> = {
  employees: {
    label: "Employees",
    permission: "employees.read",
    dateLabel: "Joining date",
    fields: (() => {
      type R = Prisma.EmployeeGetPayload<{
        include: { department: true; designation: true; branch: true };
      }>;
      return [
        f<R>("employeeCode", "Employee code", "string", (r) => r.employeeCode),
        f<R>("employeeName", "Name", "string", (r) => name(r)),
        f<R>(
          "officialEmail",
          "Official email",
          "string",
          (r) => r.officialEmail,
        ),
        f<R>("status", "Status", "string", (r) => r.status),
        f<R>(
          "employmentType",
          "Employment type",
          "string",
          (r) => r.employmentType,
        ),
        f<R>(
          "department",
          "Department",
          "string",
          (r) => r.department?.name ?? null,
        ),
        f<R>(
          "designation",
          "Designation",
          "string",
          (r) => r.designation?.name ?? null,
        ),
        f<R>(
          "branch",
          "Work location",
          "string",
          (r) => r.branch?.name ?? null,
        ),
        f<R>("joinedAt", "Joining date", "date", (r) => d(r.joinedAt)),
        f<R>("gender", "Gender", "string", (r) => r.gender),
      ];
    })(),
    load: (companyId, range) =>
      db.employee.findMany({
        where: { companyId, ...(range ? { joinedAt: range } : {}) },
        include: { department: true, designation: true, branch: true },
        take: scanLimit,
      }),
  },
  attendance: {
    label: "Attendance",
    permission: "attendance.read",
    dateLabel: "Work date",
    fields: (() => {
      type R = {
        employee: EmpRef;
        workDate: Date;
        checkIn: Date;
        checkOut: Date | null;
        workedMinutes: number;
        lateMinutes: number;
        overtimeMinutes: number;
        source: string;
        shiftName: string | null;
      };
      return [
        ...empFields<R>(),
        f<R>("workDate", "Work date", "date", (r) => d(r.workDate)),
        f<R>("checkIn", "Check in", "string", (r) => r.checkIn.toISOString()),
        f<R>(
          "checkOut",
          "Check out",
          "string",
          (r) => r.checkOut?.toISOString() ?? null,
        ),
        f<R>(
          "workedHours",
          "Worked hours",
          "number",
          (r) => Math.round((r.workedMinutes / 60) * 100) / 100,
        ),
        f<R>("lateMinutes", "Late minutes", "number", (r) => r.lateMinutes),
        f<R>("late", "Late", "boolean", (r) => r.lateMinutes > 0),
        f<R>(
          "overtimeMinutes",
          "Overtime minutes",
          "number",
          (r) => r.overtimeMinutes,
        ),
        f<R>("shift", "Shift", "string", (r) => r.shiftName),
        f<R>("source", "Source", "string", (r) => r.source),
      ];
    })(),
    load: (companyId, range) =>
      db.attendance.findMany({
        where: { companyId, ...(range ? { workDate: range } : {}) },
        include: { employee: employeeRef },
        take: scanLimit,
      }),
  },
  leave: {
    label: "Leave requests",
    permission: "timeoff.manage",
    dateLabel: "Start date",
    fields: (() => {
      type R = {
        employee: EmpRef;
        leaveType: { name: string; paid: boolean };
        startDate: Date;
        endDate: Date;
        days: number;
        status: string;
      };
      return [
        ...empFields<R>(),
        f<R>("leaveType", "Leave type", "string", (r) => r.leaveType.name),
        f<R>("paid", "Paid", "boolean", (r) => r.leaveType.paid),
        f<R>("startDate", "Start date", "date", (r) => d(r.startDate)),
        f<R>("endDate", "End date", "date", (r) => d(r.endDate)),
        f<R>("days", "Days", "number", (r) => r.days),
        f<R>("status", "Status", "string", (r) => r.status),
      ];
    })(),
    load: (companyId, range) =>
      db.leaveRequest.findMany({
        where: { companyId, ...(range ? { startDate: range } : {}) },
        include: { employee: employeeRef, leaveType: true },
        take: scanLimit,
      }),
  },
  payroll: {
    label: "Payroll (processed runs)",
    permission: "payroll.read",
    dateLabel: "Payroll month",
    fields: (() => {
      type R = {
        employee: EmpRef;
        run: { period: string };
        gross: number;
        pfEmployee: number;
        esiEmployee: number;
        pt: number;
        tds: number;
        reimbursements: number;
        deductions: number;
        netPay: number;
        employerCost: number;
        lopDays: number;
      };
      return [
        ...empFields<R>(),
        f<R>("period", "Month", "string", (r) => r.run.period),
        f<R>("gross", "Gross", "number", (r) => r.gross),
        f<R>("pfEmployee", "PF (employee)", "number", (r) => r.pfEmployee),
        f<R>("esiEmployee", "ESI (employee)", "number", (r) => r.esiEmployee),
        f<R>("pt", "Professional tax", "number", (r) => r.pt),
        f<R>("tds", "TDS", "number", (r) => r.tds),
        f<R>(
          "reimbursements",
          "Reimbursements",
          "number",
          (r) => r.reimbursements,
        ),
        f<R>("deductions", "Total deductions", "number", (r) => r.deductions),
        f<R>("netPay", "Net pay", "number", (r) => r.netPay),
        f<R>("employerCost", "Employer cost", "number", (r) => r.employerCost),
        f<R>("lopDays", "LOP days", "number", (r) => r.lopDays),
      ];
    })(),
    load: (companyId, _range, from, to) =>
      db.payrollRunItem.findMany({
        where: {
          companyId,
          run: {
            status: "PROCESSED",
            ...(from || to
              ? {
                  period: {
                    ...(from ? { gte: from.slice(0, 7) } : {}),
                    ...(to ? { lte: to.slice(0, 7) } : {}),
                  },
                }
              : {}),
          },
        },
        include: { employee: employeeRef, run: { select: { period: true } } },
        take: scanLimit,
      }),
  },
  expenses: {
    label: "Expense claims",
    permission: "expenses.manage",
    dateLabel: "Expense date",
    fields: (() => {
      type R = {
        employee: EmpRef;
        category: { name: string };
        expenseDate: Date;
        amount: number;
        currency: string;
        status: string;
        merchant: string | null;
      };
      return [
        ...empFields<R>(),
        f<R>("category", "Category", "string", (r) => r.category.name),
        f<R>("expenseDate", "Expense date", "date", (r) => d(r.expenseDate)),
        f<R>("amount", "Amount", "number", (r) => r.amount),
        f<R>("currency", "Currency", "string", (r) => r.currency),
        f<R>("status", "Status", "string", (r) => r.status),
        f<R>("merchant", "Merchant", "string", (r) => r.merchant),
      ];
    })(),
    load: (companyId, range) =>
      db.expenseClaim.findMany({
        where: { companyId, ...(range ? { expenseDate: range } : {}) },
        select: {
          expenseDate: true,
          amount: true,
          currency: true,
          status: true,
          merchant: true,
          employee: employeeRef,
          category: { select: { name: true } },
        },
        take: scanLimit,
      }),
  },
  candidates: {
    label: "Recruitment candidates",
    permission: "recruitment.manage",
    dateLabel: "Applied on",
    fields: (() => {
      type R = {
        name: string;
        job: { title: string };
        stage: string;
        source: string | null;
        experienceYears: number | null;
        rating: number | null;
        createdAt: Date;
      };
      return [
        f<R>("candidate", "Candidate", "string", (r) => r.name),
        f<R>("job", "Job", "string", (r) => r.job.title),
        f<R>("stage", "Stage", "string", (r) => r.stage),
        f<R>("source", "Source", "string", (r) => r.source),
        f<R>(
          "experienceYears",
          "Experience (years)",
          "number",
          (r) => r.experienceYears,
        ),
        f<R>("rating", "Rating", "number", (r) => r.rating),
        f<R>("appliedOn", "Applied on", "date", (r) => d(r.createdAt)),
      ];
    })(),
    load: (companyId, range) =>
      db.candidate.findMany({
        where: { companyId, ...(range ? { createdAt: range } : {}) },
        select: {
          name: true,
          stage: true,
          source: true,
          experienceYears: true,
          rating: true,
          createdAt: true,
          job: { select: { title: true } },
        },
        take: scanLimit,
      }),
  },
  goals: {
    label: "Performance goals",
    permission: "performance.manage",
    dateLabel: "Due date",
    fields: (() => {
      type R = {
        employee: EmpRef;
        type: string;
        title: string;
        status: string;
        progress: number;
        weight: number;
        dueDate: Date | null;
      };
      return [
        ...empFields<R>(),
        f<R>("type", "Type", "string", (r) => r.type),
        f<R>("title", "Goal", "string", (r) => r.title),
        f<R>("status", "Status", "string", (r) => r.status),
        f<R>("progress", "Progress %", "number", (r) => r.progress),
        f<R>("weight", "Weight", "number", (r) => r.weight),
        f<R>("dueDate", "Due date", "date", (r) => d(r.dueDate)),
      ];
    })(),
    load: (companyId, range) =>
      db.goal.findMany({
        where: { companyId, ...(range ? { dueDate: range } : {}) },
        include: { employee: employeeRef },
        take: scanLimit,
      }),
  },
};

const filterSchema = z
  .object({
    field: z.string().max(60),
    op: z.enum([
      "eq",
      "neq",
      "contains",
      "gt",
      "gte",
      "lt",
      "lte",
      "empty",
      "notEmpty",
    ]),
    value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  })
  .strict();
export const configSchema = z
  .object({
    columns: z.array(z.string().max(60)).min(1).max(30),
    filters: z.array(filterSchema).max(20).default([]),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    groupBy: z.string().max(60).optional(),
    aggregates: z
      .array(
        z
          .object({
            field: z.string().max(60),
            fn: z.enum(["count", "sum", "avg", "min", "max"]),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    sort: z
      .object({ field: z.string().max(60), dir: z.enum(["asc", "desc"]) })
      .strict()
      .optional(),
    chart: z
      .object({ type: z.enum(["bar", "line", "pie"]) })
      .strict()
      .optional(),
  })
  .strict();
type Config = z.infer<typeof configSchema>;

function dataset(ctx: Context, key: string) {
  const ds = datasets[key];
  if (!ds) throw new AppError(404, "Unknown dataset.");
  requirePermission(ctx, "reports.custom");
  requirePermission(ctx, ds.permission);
  return ds;
}
function field(ds: Dataset, key: string) {
  const found = ds.fields.find((x) => x.key === key);
  if (!found) throw new AppError(422, `Unknown field: ${key}`);
  return found;
}
function matches(v: Value, op: string, target: unknown, type: Field["type"]) {
  if (op === "empty") return v === null || v === "";
  if (op === "notEmpty") return !(v === null || v === "");
  if (v === null) return false;
  const a = type === "number" ? Number(v) : String(v).toLowerCase();
  const b =
    type === "number" ? Number(target) : String(target ?? "").toLowerCase();
  switch (op) {
    case "eq":
      return type === "boolean" ? String(v) === String(target) : a === b;
    case "neq":
      return a !== b;
    case "contains":
      return String(a).includes(String(b));
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    default:
      return a <= b;
  }
}
// Screens show up to outputLimit rows; exports include every scanned row.
export async function runReport(
  ctx: Context,
  key: string,
  config: Config,
  limit = outputLimit,
) {
  const ds = dataset(ctx, key);
  const range =
    config.dateFrom || config.dateTo
      ? {
          ...(config.dateFrom ? { gte: new Date(config.dateFrom) } : {}),
          ...(config.dateTo ? { lte: new Date(config.dateTo) } : {}),
        }
      : undefined;
  const raw = await ds.load(
    ctx.companyId,
    range,
    config.dateFrom,
    config.dateTo,
  );
  const all = ds.fields;
  let rows = raw.map((r) =>
    Object.fromEntries(all.map((x) => [x.key, x.get(r as never)])),
  ) as Record<string, Value>[];
  for (const flt of config.filters) {
    const fl = field(ds, flt.field);
    rows = rows.filter((r) => matches(r[fl.key], flt.op, flt.value, fl.type));
  }
  let columns: { key: string; label: string; type: Field["type"] }[];
  if (config.groupBy) {
    const g = field(ds, config.groupBy);
    const aggs = config.aggregates.length
      ? config.aggregates
      : [{ field: g.key, fn: "count" as const }];
    const groups = new Map<string, Record<string, Value>[]>();
    for (const r of rows) {
      const k = String(r[g.key] ?? "(blank)");
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    columns = [
      { key: g.key, label: g.label, type: g.type },
      ...aggs.map((a) => {
        const af = field(ds, a.field);
        return {
          key: `${a.fn}_${a.field}`,
          label:
            a.fn === "count" ? "Count" : `${a.fn.toUpperCase()} of ${af.label}`,
          type: "number" as const,
        };
      }),
    ];
    rows = [...groups.entries()].map(([k, members]) => {
      const out: Record<string, Value> = { [g.key]: k };
      for (const a of aggs) {
        const nums = members
          .map((m) => Number(m[a.field]))
          .filter((n) => Number.isFinite(n));
        const v =
          a.fn === "count"
            ? members.length
            : !nums.length
              ? null
              : a.fn === "sum"
                ? nums.reduce((s, n) => s + n, 0)
                : a.fn === "avg"
                  ? nums.reduce((s, n) => s + n, 0) / nums.length
                  : a.fn === "min"
                    ? Math.min(...nums)
                    : Math.max(...nums);
        out[`${a.fn}_${a.field}`] =
          v === null ? null : Math.round(v * 100) / 100;
      }
      return out;
    });
  } else {
    columns = config.columns.map((c) => {
      const x = field(ds, c);
      return { key: x.key, label: x.label, type: x.type };
    });
    rows = rows.map((r) =>
      Object.fromEntries(columns.map((c) => [c.key, r[c.key]])),
    );
  }
  if (config.sort) {
    const k = config.sort.field,
      dir = config.sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[k],
        y = b[k];
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : -1) * dir;
    });
  }
  return {
    dataset: key,
    columns,
    rows: rows.slice(0, limit),
    total: rows.length,
    truncated: rows.length > limit || raw.length >= scanLimit,
    chart: config.chart ?? null,
  };
}
const definitionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable().default(null),
    dataset: z.string().max(40),
    config: configSchema,
    shared: z.boolean().default(false),
  })
  .strict();

export async function reportsRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  requirePermission(ctx, "reports.custom");
  const [, resource, id, action] = path;
  const method = req.method;
  if (resource === "datasets" && method === "GET")
    return Object.entries(datasets)
      .filter(([, ds]) => ctx.permissions.includes(ds.permission))
      .map(([key, ds]) => ({
        key,
        label: ds.label,
        dateLabel: ds.dateLabel,
        fields: ds.fields.map(({ key: k, label, type }) => ({
          key: k,
          label,
          type,
        })),
      }));
  if (resource === "run" && method === "POST") {
    const b = z
      .object({ dataset: z.string().max(40), config: configSchema })
      .strict()
      .parse(await json(req));
    return runReport(ctx, b.dataset, b.config);
  }
  if (resource !== "definitions")
    throw new AppError(404, "Endpoint not found.");
  if (!id && method === "GET")
    return (
      await db.reportDefinition.findMany({
        where: {
          companyId: ctx.companyId,
          OR: [{ createdBy: ctx.userId }, { shared: true }],
        },
        orderBy: { updatedAt: "desc" },
      })
    ).filter((r) => {
      const ds = datasets[r.dataset];
      return ds && ctx.permissions.includes(ds.permission);
    });
  if (!id && method === "POST") {
    const b = definitionSchema.parse(await json(req));
    await runReport(ctx, b.dataset, b.config);
    return db.$transaction(async (tx) => {
      const saved = await tx.reportDefinition.create({
        data: {
          ...b,
          config: b.config as Prisma.InputJsonValue,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
        },
      });
      await audit(
        tx,
        ctx,
        "CREATE",
        "report_definitions",
        saved.id,
        undefined,
        { name: b.name, dataset: b.dataset },
        ip(req),
      );
      return saved;
    });
  }
  const def = id
    ? await db.reportDefinition.findFirst({
        where: {
          id,
          companyId: ctx.companyId,
          OR: [{ createdBy: ctx.userId }, { shared: true }],
        },
      })
    : null;
  if (!def) throw new AppError(404, "Report not found.");
  if (action === "run" && method === "GET") {
    const format = z
      .enum(exportFormats)
      .optional()
      .parse(req.nextUrl.searchParams.get("format") ?? undefined);
    const result = await runReport(
      ctx,
      def.dataset,
      configSchema.parse(def.config),
      format ? scanLimit : outputLimit,
    );
    if (!format) return { ...result, name: def.name };
    await db.auditLog.create({
      data: {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorName: ctx.name,
        action: "EXPORT",
        module: "reports",
        recordId: def.id,
        newValue: { format, rows: result.rows.length },
      },
    });
    return exportTable(
      {
        title: def.name,
        columns: result.columns,
        rows: result.rows,
        truncated: result.truncated,
      },
      format,
    );
  }
  // Only the author changes or removes a saved report.
  if (def.createdBy !== ctx.userId)
    throw new AppError(403, "Only the author can change this report.");
  if (!action && method === "PUT") {
    const b = definitionSchema.parse(await json(req));
    await runReport(ctx, b.dataset, b.config);
    return db.reportDefinition.update({
      where: { id: def.id },
      data: { ...b, config: b.config as Prisma.InputJsonValue },
    });
  }
  if (!action && method === "DELETE") {
    await db.reportDefinition.delete({ where: { id: def.id } });
    return { deleted: true };
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
