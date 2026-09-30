import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { addDays, dayDate, localDay } from "@/modules/time/rules";
import type { PayrollOptions } from "./rules";
import { effectiveAttendanceStatus } from "@/modules/time/single-punch";
import { salaryPeriod, type PayrollDates, runPeriod } from "./period";

type Tx = Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function monthBounds(period: string) {
  return salaryPeriod(period);
}

// Once a month's payroll is under review, approved or processed, attendance
// and leave for that month are locked.
export async function assertPayrollOpen(tx: Tx, companyId: string, date: Date) {
  return assertPayrollOpenRange(tx, companyId, date, date);
}

export async function assertPayrollOpenRange(tx: Tx, companyId: string, start: Date, end: Date) {
  const run = await tx.payrollRun.findFirst({
    where: {
      companyId,
      status: { in: ["SUBMITTED", "APPROVED", "PROCESSED"] },
      OR: [
        { periodStart: { lte: end }, periodEnd: { gte: start } },
        { periodStart: null, period: { gte: iso(start).slice(0, 7), lte: iso(end).slice(0, 7) } },
      ],
    },
    select: { status: true, period: true },
  });
  if (run)
    throw new AppError(
      409,
      `Payroll for ${run.period} is ${run.status === "PROCESSED" ? "processed" : "under review"}; attendance and leave within its salary period are locked.`,
      "PAYROLL_LOCKED",
    );
}


// Unpaid days from attendance for the elapsed part of the month: an absent
// working day counts 1, a half day or short day 0.5. Holidays, approved leave
// (paid or unpaid; unpaid leave is counted separately), weekly offs, rostered
// offs and days before joining are skipped. Missed punches and days awaiting
// review are not charged; HR resolves them before payroll.
export async function attendanceLop(
  tx: Tx,
  companyId: string,
  employee: { id: string; joinedAt: Date },
  period: string | PayrollDates,
) {
  const { start, end } = typeof period === "string" ? monthBounds(period) : runPeriod(period);
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { workingDays: true, timezone: true, attendancePolicy: true },
  });
  const today = localDay(new Date(), company.timezone);
  const last = iso(end) < today ? iso(end) : addDays(today, -1);
  if (last < iso(start)) return 0;
  const [holidays, leave, roster, attendance] = await Promise.all([
    tx.holiday.findMany({
      where: {
        companyId,
        date: { gte: start, lte: end },
        OR: [
          { optional: false },
          { selections: { some: { employeeId: employee.id } } },
        ],
      },
      select: { date: true },
    }),
    tx.leaveRequest.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        status: "Approved",
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { startDate: true, endDate: true, halfDay: true },
    }),
    tx.rosterEntry.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        workDate: { gte: start, lte: end },
      },
      select: { workDate: true, weeklyOff: true },
    }),
    tx.attendance.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        workDate: { gte: start, lte: end },
      },
      select: {
        workDate: true,
        status: true,
        checkOut: true,
        scheduledEnd: true,
        _count: { select: { punches: true } },
      },
    }),
  ]);
  const holiday = new Set(holidays.map((h) => iso(h.date)));
  const planned = new Map(roster.map((r) => [iso(r.workDate), r.weeklyOff]));
  const records = new Map(attendance.map((a) => [iso(a.workDate), a]));
  let lop = 0;
  for (let d = iso(start); d <= last; d = addDays(d, 1)) {
    if (dayDate(d) < employee.joinedAt || holiday.has(d)) continue;
    const off = planned.has(d)
      ? planned.get(d)!
      : !company.workingDays.includes(dayDate(d).getUTCDay());
    if (off) continue;
    const onLeave = leave.find(
      (l) => iso(l.startDate) <= d && iso(l.endDate) >= d,
    );
    const a = records.get(d);
    if (onLeave && !onLeave.halfDay) continue;
    if (!a) {
      lop += onLeave?.halfDay ? 0.5 : 1;
      continue;
    }
    const status = effectiveAttendanceStatus(
      a,
      company.attendancePolicy?.singlePunchStatus ?? "MISSED_PUNCH",
      today,
    );
    if (status === "ABSENT") lop += onLeave?.halfDay ? 0.5 : 1;
    else if (["HALF_DAY", "SHORT"].includes(status) && !onLeave) lop += 0.5;
  }
  return lop;
}

// Approved overtime for the month, paid at the multiplier on the hourly
// rate of basic (or gross) pay.
export async function overtimePay(
  tx: Tx,
  companyId: string,
  employeeId: string,
  period: string | PayrollDates,
  monthly: { basic: number; gross: number },
  options: PayrollOptions,
) {
  const { start, end, days } = typeof period === "string" ? monthBounds(period) : runPeriod(period);
  const sum = await tx.attendance.aggregate({
    where: {
      companyId,
      employeeId,
      workDate: { gte: start, lte: end },
      overtimeStatus: "APPROVED",
    },
    _sum: { approvedOvertimeMinutes: true },
  });
  const minutes = sum._sum.approvedOvertimeMinutes ?? 0;
  const base =
    options.overtimeBasis === "GROSS" ? monthly.gross : monthly.basic;
  const hourly = base / days / options.hoursPerDay;
  return {
    minutes,
    pay: Math.round((minutes / 60) * hourly * options.overtimeMultiplier),
  };
}

// Encashed leave not yet paid, valued on basic pay.
export async function encashment(
  tx: Tx,
  companyId: string,
  employeeId: string,
  basic: number,
  options: PayrollOptions,
) {
  const entries = await tx.leaveLedger.findMany({
    where: {
      companyId,
      employeeId,
      kind: "ENCASHMENT",
      amount: null,
    },
    select: { id: true, days: true },
  });
  const days = entries.reduce((s, e) => s - e.days, 0);
  return {
    entries: entries.map((e) => ({ id: e.id, days: -e.days })),
    days,
    pay: Math.round((days * basic) / options.encashmentDivisor),
  };
}

// Active loans and advances due in the period, oldest first.
export async function instalments(
  tx: Tx,
  companyId: string,
  employeeId: string,
  period: string,
) {
  const loans = await tx.employeeLoan.findMany({
    where: {
      companyId,
      employeeId,
      status: "ACTIVE",
      startPeriod: { lte: period },
      balance: { gt: 0 },
    },
    orderBy: { createdAt: "asc" },
  });
  const due = loans.map((l) => ({
    id: l.id,
    kind: l.kind,
    amount: Math.round(Math.min(l.instalment, l.balance)),
  }));
  return {
    due,
    loan: due
      .filter((d) => d.kind === "LOAN")
      .reduce((s, d) => s + d.amount, 0),
    advance: due
      .filter((d) => d.kind === "ADVANCE")
      .reduce((s, d) => s + d.amount, 0),
  };
}
// Splits a (possibly capped) total across the loans in order.
export function allocate(
  due: { id: string; kind: string; amount: number }[],
  loanPaid: number,
  advancePaid: number,
) {
  const left: Record<string, number> = { LOAN: loanPaid, ADVANCE: advancePaid };
  return due
    .map((d) => {
      const amount = Math.min(d.amount, left[d.kind]);
      left[d.kind] -= amount;
      return { id: d.id, amount };
    })
    .filter((d) => d.amount > 0);
}
