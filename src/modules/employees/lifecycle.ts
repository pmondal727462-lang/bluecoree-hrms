import { NextRequest } from "next/server";
import { outstandingAssets } from "@/modules/assets/service";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { protectedRoles } from "@/config/permissions";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { dayDate, localDay } from "@/modules/time/rules";
import { enqueueWebhook } from "@/modules/integrations/outbound";

type Tx = Prisma.TransactionClient;
const tracked = {
  departmentId: "DEPARTMENT_CHANGE",
  designationId: "DESIGNATION_CHANGE",
  managerId: "MANAGER_CHANGE",
  branchId: "TRANSFER",
  status: "STATUS_CHANGE",
} as const;
type Tracked = Record<keyof typeof tracked, string | null>;

export async function recordHistory(
  tx: Tx,
  ctx: Pick<Context, "companyId" | "userId" | "name">,
  employeeId: string,
  eventType: string,
  effectiveDate: Date,
  fromValue?: Prisma.InputJsonValue,
  toValue?: Prisma.InputJsonValue,
  notes?: string,
) {
  await tx.employeeHistory.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      eventType,
      effectiveDate,
      fromValue,
      toValue,
      notes,
      createdBy: ctx.userId,
      createdByName: ctx.name,
    },
  });
}
// Called when an employee record is saved: one history entry per changed field.
export async function recordChanges(
  tx: Tx,
  ctx: Context,
  old: Tracked | null,
  saved: Tracked & { id: string; joinedAt: Date },
) {
  if (!old)
    return recordHistory(
      tx,
      ctx,
      saved.id,
      "JOINED",
      saved.joinedAt,
      undefined,
      {
        departmentId: saved.departmentId,
        designationId: saved.designationId,
        branchId: saved.branchId,
        status: saved.status,
      },
    );
  const today = dayDate(new Date().toISOString().slice(0, 10));
  for (const [field, eventType] of Object.entries(tracked) as [
    keyof Tracked,
    string,
  ][])
    if (old[field] !== saved[field])
      await recordHistory(
        tx,
        ctx,
        saved.id,
        eventType,
        today,
        { [field]: old[field] },
        { [field]: saved[field] },
      );
}

const eventSchema = z
  .object({
    eventType: z.enum([
      "CONFIRMATION",
      "PROMOTION",
      "TRANSFER",
      "RESIGNATION",
      "TERMINATION",
      "RETIREMENT",
      "EXIT",
      "REHIRE",
    ]),
    effectiveDate: z.iso.date(),
    designationId: z.string().optional(),
    departmentId: z.string().optional(),
    branchId: z.string().optional(),
    managerId: z.string().optional(),
    lastWorkingDay: z.iso.date().optional(),
    reason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
const settlementSchema = z
  .object({
    leaveEncashment: z.number().min(0).max(100000000),
    otherEarnings: z.number().min(0).max(100000000),
    otherDeductions: z.number().min(0).max(100000000),
    noticeServedDays: z.number().int().min(0).max(365),
    waiveNoticeRecovery: z.boolean(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000);
// Gratuity: 15/26 × last basic × completed years (a part-year over six months
// counts as a year) once service reaches five years, capped at ₹20 lakh.
export function gratuity(basic: number, joinedAt: Date, lastWorkingDay: Date) {
  const years = (daysBetween(joinedAt, lastWorkingDay) + 1) / 365.25;
  if (years < 5) return { years, amount: 0 };
  const completed = Math.floor(years) + (years % 1 > 0.5 ? 1 : 0);
  return {
    years,
    amount: Math.min(2000000, Math.round((15 * basic * completed) / 26)),
  };
}
async function calculateSettlement(
  tx: Tx,
  companyId: string,
  employeeId: string,
  input?: z.infer<typeof settlementSchema>,
) {
  const [e, s] = await Promise.all([
    tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { salaryStructure: true },
    }),
    tx.exitSettlement.findUniqueOrThrow({ where: { employeeId } }),
  ]);
  const structure = e.salaryStructure;
  const monthlyGross = structure
    ? structure.basic +
      structure.hra +
      structure.specialAllowance +
      structure.otherAllowance
    : 0;
  // Salary is due from the day after the last payroll month processed here;
  // without one, earlier months are assumed paid outside the system.
  const lastPaid = await tx.payrollRunItem.findFirst({
    where: { companyId, employeeId, run: { status: "PROCESSED" } },
    include: { run: { select: { period: true } } },
    orderBy: { run: { period: "desc" } },
  });
  const lwdMonth = new Date(
    Date.UTC(
      s.lastWorkingDay.getUTCFullYear(),
      s.lastWorkingDay.getUTCMonth(),
      1,
    ),
  );
  let from = lwdMonth;
  if (lastPaid) {
    const [y, m] = lastPaid.run.period.split("-").map(Number);
    from = new Date(Date.UTC(y, m, 1));
  }
  if (e.joinedAt > from) from = e.joinedAt;
  let pendingSalary = 0;
  for (
    let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    d <= s.lastWorkingDay;
    d.setUTCMonth(d.getUTCMonth() + 1)
  ) {
    const monthEnd = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    );
    const start = from > d ? from : d;
    const end = s.lastWorkingDay < monthEnd ? s.lastWorkingDay : monthEnd;
    if (end >= start)
      pendingSalary +=
        (monthlyGross * (daysBetween(start, end) + 1)) / monthEnd.getUTCDate();
  }
  const served = input?.noticeServedDays ?? s.noticeServedDays;
  const shortfall = Math.max(0, s.noticeDays - served);
  const waive =
    input?.waiveNoticeRecovery ??
    (s.details as { waiveNoticeRecovery?: boolean } | null)
      ?.waiveNoticeRecovery ??
    false;
  const noticeRecovery = waive
    ? 0
    : Math.round((monthlyGross / 30) * shortfall);
  const g = gratuity(structure?.basic ?? 0, e.joinedAt, s.lastWorkingDay);
  const leaveEncashment = input?.leaveEncashment ?? s.leaveEncashment;
  const otherEarnings = input?.otherEarnings ?? s.otherEarnings;
  const otherDeductions = input?.otherDeductions ?? s.otherDeductions;
  const data = {
    noticeServedDays: served,
    pendingSalary: Math.round(pendingSalary),
    leaveEncashment,
    gratuity: g.amount,
    otherEarnings,
    noticeRecovery,
    otherDeductions,
    netPayable:
      Math.round(pendingSalary) +
      leaveEncashment +
      g.amount +
      otherEarnings -
      noticeRecovery -
      otherDeductions,
    details: {
      monthlyGross,
      serviceYears: Math.round(g.years * 100) / 100,
      noticeShortfallDays: shortfall,
      waiveNoticeRecovery: waive,
      salaryStructureMissing: !structure,
      notes:
        input?.notes ?? (s.details as { notes?: string } | null)?.notes ?? null,
    },
  };
  return tx.exitSettlement.update({ where: { employeeId }, data });
}

export async function lifecycleRoute(
  req: NextRequest,
  ctx: Context,
  id: string,
  resource: string,
  action?: string,
) {
  const employee = await db.employee.findFirst({
    where: { id, companyId: ctx.companyId },
    include: { user: { include: { role: true } } },
  });
  if (!employee) throw new AppError(404, "Employee not found.");
  const own = employee.userId === ctx.userId;

  if (resource === "history" && req.method === "GET") {
    if (
      !ctx.permissions.includes("employees.read") &&
      !(own && ctx.permissions.includes("profile.read"))
    )
      throw new AppError(
        403,
        "You do not have permission for this action.",
        "FORBIDDEN",
      );
    return db.employeeHistory.findMany({
      where: { companyId: ctx.companyId, employeeId: id },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    });
  }

  if (resource === "lifecycle" && req.method === "POST") {
    requirePermission(ctx, "employees.write");
    const b = eventSchema.parse(await json(req));
    const company = await db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
    });
    const today = localDay(new Date(), company.timezone);
    return db.$transaction(async (tx) => {
      const ref = async (
        model: "department" | "designation" | "branch",
        value?: string,
      ) => {
        if (
          value &&
          !(await (tx[model] as typeof tx.department).findFirst({
            where: { id: value, companyId: ctx.companyId },
          }))
        )
          throw new AppError(404, `The selected ${model} was not found.`);
      };
      await ref("department", b.departmentId);
      await ref("designation", b.designationId);
      await ref("branch", b.branchId);
      if (
        b.managerId &&
        (b.managerId === id ||
          !(await tx.employee.findFirst({
            where: { id: b.managerId, companyId: ctx.companyId },
          })))
      )
        throw new AppError(422, "Choose a different, existing manager.");
      const exiting = [
        "RESIGNATION",
        "TERMINATION",
        "RETIREMENT",
        "EXIT",
      ].includes(b.eventType);
      if (
        exiting &&
        employee.user &&
        (employee.user.isSuperAdmin ||
          protectedRoles.includes(employee.user.role.name))
      )
        throw new AppError(
          409,
          "Reassign the administrator account before this employee exits.",
        );
      let data: Prisma.EmployeeUpdateInput = {};
      const from = {
        status: employee.status,
        departmentId: employee.departmentId,
        designationId: employee.designationId,
        branchId: employee.branchId,
        managerId: employee.managerId,
      };
      switch (b.eventType) {
        case "CONFIRMATION":
          if (employee.status !== "Probation")
            throw new AppError(
              409,
              "Only employees on probation can be confirmed.",
            );
          data = {
            status: "Active",
            confirmationDate: dayDate(b.effectiveDate),
          };
          break;
        case "PROMOTION":
          if (!b.designationId)
            throw new AppError(422, "Choose the new designation.");
          data = {
            designation: { connect: { id: b.designationId } },
            ...(b.departmentId
              ? { department: { connect: { id: b.departmentId } } }
              : {}),
          };
          break;
        case "TRANSFER":
          if (!b.branchId && !b.departmentId && !b.managerId)
            throw new AppError(
              422,
              "Choose the new location, department or manager.",
            );
          data = {
            ...(b.branchId ? { branch: { connect: { id: b.branchId } } } : {}),
            ...(b.departmentId
              ? { department: { connect: { id: b.departmentId } } }
              : {}),
            ...(b.managerId
              ? { manager: { connect: { id: b.managerId } } }
              : {}),
          };
          break;
        case "RESIGNATION":
        case "TERMINATION":
        case "RETIREMENT": {
          if (employee.status === "Inactive")
            throw new AppError(409, "This employee has already exited.");
          if (!b.lastWorkingDay || b.lastWorkingDay < b.effectiveDate)
            throw new AppError(
              422,
              "Give a last working day on or after the effective date.",
            );
          data = { status: "On notice" };
          const settlement = {
            exitType: b.eventType,
            resignationDate: dayDate(b.effectiveDate),
            lastWorkingDay: dayDate(b.lastWorkingDay),
            reason: b.reason,
            noticeDays: b.eventType === "RESIGNATION" ? employee.noticeDays : 0,
            noticeServedDays: Math.min(
              employee.noticeDays,
              Math.round(
                (dayDate(b.lastWorkingDay).getTime() -
                  dayDate(b.effectiveDate).getTime()) /
                  86400000,
              ),
            ),
          };
          const existing = await tx.exitSettlement.findUnique({
            where: { employeeId: id },
          });
          if (existing && existing.status !== "DRAFT")
            throw new AppError(
              409,
              "A settlement for this employee is already approved.",
            );
          await tx.exitSettlement.upsert({
            where: { employeeId: id },
            create: { ...settlement, companyId: ctx.companyId, employeeId: id },
            update: settlement,
          });
          break;
        }
        case "EXIT": {
          if (employee.status === "Inactive")
            throw new AppError(409, "This employee has already exited.");
          if (b.effectiveDate > today)
            throw new AppError(
              422,
              "Record the exit on or after the last working day.",
            );
          data = { status: "Inactive" };
          if (employee.userId) {
            await tx.user.update({
              where: { id: employee.userId },
              data: { active: false },
            });
            await tx.session.deleteMany({ where: { userId: employee.userId } });
          }
          await enqueueWebhook(tx, ctx.companyId, "employee.deleted", {
            id,
            employeeCode: employee.employeeCode,
            status: "Inactive",
          });
          break;
        }
        case "REHIRE":
          if (employee.status !== "Inactive")
            throw new AppError(
              409,
              "Only employees who have exited can be rehired.",
            );
          data = { status: "Probation", joinedAt: dayDate(b.effectiveDate) };
          break;
      }
      const saved = await tx.employee.update({ where: { id }, data });
      const to = {
        status: saved.status,
        departmentId: saved.departmentId,
        designationId: saved.designationId,
        branchId: saved.branchId,
        managerId: saved.managerId,
      };
      await recordHistory(
        tx,
        ctx,
        id,
        b.eventType,
        dayDate(b.effectiveDate),
        from,
        {
          ...to,
          ...(b.lastWorkingDay ? { lastWorkingDay: b.lastWorkingDay } : {}),
        },
        [b.reason, b.notes].filter(Boolean).join(" — ") || undefined,
      );
      if (exiting && b.eventType !== "EXIT")
        await calculateSettlement(tx, ctx.companyId, id);
      await audit(tx, ctx, b.eventType, "employees", id, from, to, ip(req));
      return saved;
    });
  }

  if (resource === "settlement") {
    if (req.method === "GET") {
      if (
        !ctx.permissions.includes("payroll.read") &&
        !ctx.permissions.includes("employees.write")
      )
        throw new AppError(
          403,
          "You do not have permission for this action.",
          "FORBIDDEN",
        );
      return db.exitSettlement.findUnique({ where: { employeeId: id } });
    }
    requirePermission(ctx, "payroll.manage");
    return db.$transaction(async (tx) => {
      const s = await tx.exitSettlement.findUnique({
        where: { employeeId: id },
      });
      if (!s)
        throw new AppError(404, "No exit has been recorded for this employee.");
      if (!action && req.method === "PUT") {
        if (s.status !== "DRAFT")
          throw new AppError(409, "Approved settlements cannot be changed.");
        const b = settlementSchema.parse(await json(req));
        return calculateSettlement(tx, ctx.companyId, id, b);
      }
      if (action === "approve" && req.method === "POST") {
        if (own)
          throw new AppError(
            403,
            "Another approver must approve your own settlement.",
          );
        if (s.status !== "DRAFT")
          throw new AppError(409, "This settlement is already approved.");
        // Exit clearance: company assets come back (or are written off) first.
        const held = await outstandingAssets(tx, ctx.companyId, id);
        if (held)
          throw new AppError(
            409,
            `${held} company asset(s) are still with the employee. Record their return or report them lost first.`,
            "ASSETS_OUTSTANDING",
          );
        const fresh = await calculateSettlement(tx, ctx.companyId, id);
        const saved = await tx.exitSettlement.update({
          where: { employeeId: id },
          data: {
            status: "APPROVED",
            approvedBy: ctx.userId,
            approvedAt: new Date(),
          },
        });
        await audit(
          tx,
          ctx,
          "APPROVE_SETTLEMENT",
          "employees",
          id,
          undefined,
          { netPayable: fresh.netPayable },
          ip(req),
        );
        return saved;
      }
      if (action === "paid" && req.method === "POST") {
        if (s.status !== "APPROVED")
          throw new AppError(
            409,
            "Approve the settlement before marking it paid.",
          );
        const saved = await tx.exitSettlement.update({
          where: { employeeId: id },
          data: { status: "PAID", paidAt: new Date() },
        });
        await audit(
          tx,
          ctx,
          "PAY_SETTLEMENT",
          "employees",
          id,
          undefined,
          { netPayable: s.netPayable },
          ip(req),
        );
        return saved;
      }
      throw new AppError(404, "Endpoint not found.");
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
