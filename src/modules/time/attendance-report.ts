import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { addDays, dayDate, localDay, localMinute } from "./rules";
import { effectiveAttendanceStatus } from "./single-punch";
import {
  attendanceWorkbook,
  type AttendanceReportEmployee,
} from "./attendance-workbook";
import {
  salaryPeriod,
  defaultSalaryPeriod,
  type SalaryPeriodPolicy,
  runPeriod,
} from "@/modules/payroll/period";

const querySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    branchId: z.string().optional(),
    search: z.string().max(100).default(""),
    scope: z.enum(["own", "company"]).default("company"),
  })
  .refine(
    (q) => (q.period ? !q.from && !q.to : !!q.from && !!q.to),
    "Choose a salary month or both report dates.",
  );

export async function attendanceReport(req: NextRequest, ctx: Context) {
  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const own = q.scope === "own";
  requirePermission(ctx, own ? "attendance.self" : "attendance.read");
  const company = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
    include: { attendancePolicy: true, settings: true },
  });
  let from = q.from!,
    to = q.to!;
  if (q.period) {
    const existing = await db.payrollRun.findUnique({
      where: {
        companyId_period: { companyId: ctx.companyId, period: q.period },
      },
    });
    const range = existing
      ? runPeriod(existing)
      : salaryPeriod(
          q.period,
          company.settings
            ? (company.settings as SalaryPeriodPolicy)
            : defaultSalaryPeriod,
        );
    from = range.start.toISOString().slice(0, 10);
    to = range.end.toISOString().slice(0, 10);
  }
  const start = dayDate(from),
    end = dayDate(to);
  if (to < from || (end.getTime() - start.getTime()) / 86400000 >= 62)
    throw new AppError(422, "Choose a report period of up to 62 days.");
  const today = localDay(new Date(), company.timezone);
  const canBank = !own && ctx.permissions.includes("employees.sensitive");
  const canSalary = ctx.permissions.includes(
    own ? "payroll.self" : "payroll.read",
  );
  const where = {
    companyId: ctx.companyId,
    joinedAt: { lte: end },
    ...(own ? { userId: ctx.userId } : {}),
    ...(q.branchId ? { branchId: q.branchId } : {}),
    ...(q.search
      ? {
          OR: [
            { firstName: { contains: q.search, mode: "insensitive" as const } },
            { lastName: { contains: q.search, mode: "insensitive" as const } },
            {
              employeeCode: {
                contains: q.search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  if ((await db.employee.count({ where })) > 2000)
    throw new AppError(
      422,
      "Select a branch or employee search to export at most 2,000 employees at a time.",
    );
  const employees = await db.employee.findMany({
    where,
    orderBy: [
      { branch: { name: "asc" } },
      { department: { name: "asc" } },
      { employeeCode: "asc" },
    ],
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      middleName: true,
      lastName: true,
      joinedAt: true,
      branchId: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
      sensitiveEncrypted: canBank,
      bankAccounts: canBank
        ? {
            where: { active: true, isPrimary: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          }
        : false,
      payslips: canSalary
        ? {
            where: { periodStart: start, periodEnd: end },
            select: { netPay: true },
          }
        : false,
      attendance: {
        where: { workDate: { gte: start, lte: end } },
        include: { _count: { select: { punches: true } } },
      },
      rosterEntries: {
        where: { workDate: { gte: start, lte: end } },
        select: { workDate: true, weeklyOff: true },
      },
      leaveRequests: {
        where: {
          status: "Approved",
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { startDate: true, endDate: true, halfDay: true },
      },
    },
  });
  const holidays = await db.holiday.findMany({
    where: { companyId: ctx.companyId, date: { gte: start, lte: end } },
    include: { selections: { select: { employeeId: true } } },
  });
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rows: AttendanceReportEmployee[] = employees.map((e) => {
    const bank = canBank ? e.bankAccounts[0] : undefined;
    const oldBank =
      canBank && e.sensitiveEncrypted ? decrypt(e.sensitiveEncrypted) : {};
    const attendance = new Map(e.attendance.map((a) => [iso(a.workDate), a]));
    const roster = new Map(e.rosterEntries.map((r) => [iso(r.workDate), r]));
    return {
      id: e.id,
      code: e.employeeCode,
      name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "),
      branchId: e.branchId,
      branch: e.branch?.name ?? "Unassigned branch",
      department: e.department?.name ?? "Unassigned department",
      bankName: bank?.bankName ?? null,
      ifsc: bank?.ifsc ?? oldBank.ifsc ?? null,
      accountNumber: bank
        ? (decrypt(bank.accountEncrypted).accountNumber ?? null)
        : (oldBank.bankAccount ?? null),
      salary: canSalary ? (e.payslips[0]?.netPay ?? null) : null,
      days: dates.map((date) => {
        const a = attendance.get(date),
          planned = roster.get(date);
        const leave = e.leaveRequests.find(
          (l) => iso(l.startDate) <= date && iso(l.endDate) >= date,
        );
        const holiday = holidays.find(
          (h) =>
            iso(h.date) === date &&
            (!h.optional || h.selections.some((s) => s.employeeId === e.id)),
        );
        let status: string;
        if (date < iso(e.joinedAt)) status = "NA";
        else if (a) {
          const effective = effectiveAttendanceStatus(
            a,
            company.attendancePolicy?.singlePunchStatus ?? "MISSED_PUNCH",
            today,
          );
          status =
            (
              {
                ABSENT: "A",
                HALF_DAY: "HD",
                SHORT: "HD",
                MISSED_PUNCH: "MP",
                PENDING_REVIEW: "PR",
                PRESENT: a.checkOut || date < today ? "P" : "IN",
              } as Record<string, string>
            )[effective] ?? effective;
          if (leave?.halfDay) status = `${status}/HL`;
        } else if (leave) status = leave.halfDay ? "HL" : "L";
        else if (holiday) status = "H";
        else if (
          planned?.weeklyOff ||
          (!planned && !company.workingDays.includes(dayDate(date).getUTCDay()))
        )
          status = "WO";
        else status = date < today ? "A" : "-";
        return {
          date,
          status,
          inMinutes: a ? localMinute(a.checkIn, company.timezone) : null,
          outMinutes: a?.checkOut
            ? localMinute(a.checkOut, company.timezone)
            : null,
          workedMinutes: a?.checkOut ? a.workedMinutes : null,
        };
      }),
    };
  });
  const workbook = attendanceWorkbook(
    company.name,
    from,
    to,
    company.timezone,
    dates,
    rows,
    canBank,
    canSalary,
  );
  const bytes = await workbook.xlsx.writeBuffer();
  await db.$transaction((tx) =>
    audit(
      tx,
      ctx,
      "EXPORT",
      "attendance_report",
      ctx.companyId,
      undefined,
      {
        from,
        to,
        employees: rows.length,
        bankDetails: canBank,
        salaryDetails: canSalary,
      },
      ip(req),
    ),
  );
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="attendance-${from}-to-${to}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
