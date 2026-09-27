import type { LeaveType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dayDate, localDay } from "./rules";

type Tx = Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const half = (v: number) => Math.round(v * 2) / 2;

// Holidays that apply to one employee: company holidays plus the optional
// holidays they selected.
export async function employeeHolidays(
  tx: Tx,
  companyId: string,
  employeeId: string,
  start: Date,
  end: Date,
) {
  const rows = await tx.holiday.findMany({
    where: {
      companyId,
      date: { gte: start, lte: end },
      OR: [
        { optional: false },
        { selections: { some: { employeeId, companyId } } },
      ],
    },
  });
  return rows.map((h) => iso(h.date));
}

// Months credited in a year for monthly accrual: from the joining month (or
// January) up to and including the current month.
function accruedMonths(year: number, today: string, joinedAt: Date) {
  const thisYear = Number(today.slice(0, 4));
  if (year > thisYear) return 0;
  const last = year < thisYear ? 12 : Number(today.slice(5, 7));
  const first =
    joinedAt.getUTCFullYear() === year
      ? joinedAt.getUTCMonth() + 1
      : joinedAt.getUTCFullYear() > year
        ? 13
        : 1;
  return Math.max(0, last - first + 1);
}

// Comp-off credits are used oldest first; any unused part of an expired
// credit lapses.
function compOffBalance(
  credits: { days: number; expiresAt: Date | null }[],
  used: number,
  today: string,
) {
  let left = used,
    available = 0,
    lapsed = 0;
  for (const c of credits) {
    const consumed = Math.min(c.days, left);
    left -= consumed;
    const rest = c.days - consumed;
    if (c.expiresAt && iso(c.expiresAt) < today) lapsed += rest;
    else available += rest;
  }
  return { available: available - left, lapsed };
}

export type Balance = LeaveType & {
  year: number;
  entitled: number;
  accrued: number;
  carriedForward: number;
  adjusted: number;
  encashed: number;
  compOffEarned: number;
  lapsed: number;
  approved: number;
  pending: number;
  remaining: number;
};

export async function balances(
  ctx: { companyId: string },
  employeeId: string,
  year: number,
  tx: Tx = db,
): Promise<Balance[]> {
  const companyId = ctx.companyId;
  const [company, employee, types, requests, ledger] = await Promise.all([
    tx.company.findUniqueOrThrow({ where: { id: companyId } }),
    tx.employee.findFirstOrThrow({
      where: { id: employeeId, companyId },
      select: { joinedAt: true },
    }),
    tx.leaveType.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    tx.leaveRequest.findMany({
      where: {
        companyId,
        employeeId,
        status: { in: ["Pending", "Approved"] },
        OR: [
          {
            startDate: {
              gte: dayDate(`${year}-01-01`),
              lte: dayDate(`${year}-12-31`),
            },
          },
          { leaveType: { compOff: true } },
        ],
      },
    }),
    tx.leaveLedger.findMany({
      where: {
        companyId,
        employeeId,
        OR: [{ year }, { kind: "COMP_OFF" }],
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const today = localDay(new Date(), company.timezone);
  return types.map((type) => {
    const mine = requests.filter((r) => r.leaveTypeId === type.id);
    const sum = (status: string) =>
      mine.filter((r) => r.status === status).reduce((s, r) => s + r.days, 0);
    const approved = sum("Approved"),
      pending = sum("Pending");
    const entries = ledger.filter((l) => l.leaveTypeId === type.id);
    const total = (kind: string) =>
      entries
        .filter((l) => l.kind === kind && l.year === year)
        .reduce((s, l) => s + l.days, 0);
    const carriedForward = total("CARRY_FORWARD"),
      adjusted = total("ADJUSTMENT"),
      encashed = -total("ENCASHMENT");
    if (type.compOff) {
      const credits = entries.filter((l) => l.kind === "COMP_OFF");
      const c = compOffBalance(credits, approved + pending, today);
      return {
        ...type,
        year,
        entitled: 0,
        accrued: 0,
        carriedForward: 0,
        adjusted,
        encashed,
        compOffEarned: credits.reduce((s, l) => s + l.days, 0),
        lapsed: c.lapsed,
        approved,
        pending,
        remaining: c.available + adjusted - encashed,
      };
    }
    const accrued =
      type.accrual === "MONTHLY"
        ? half(
            (type.annualDays * accruedMonths(year, today, employee.joinedAt)) /
              12,
          )
        : type.annualDays;
    return {
      ...type,
      year,
      entitled: type.annualDays,
      accrued,
      carriedForward,
      adjusted,
      encashed,
      compOffEarned: 0,
      lapsed: 0,
      approved,
      pending,
      remaining: accrued + carriedForward + adjusted - encashed - approved - pending,
    };
  });
}
