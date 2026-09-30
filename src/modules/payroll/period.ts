export type SalaryPeriodPolicy = {
  salaryPeriodMode: "CALENDAR_MONTH" | "START_DAY" | "END_DAY";
  salaryBoundaryDay: number;
};
export const defaultSalaryPeriod: SalaryPeriodPolicy = { salaryPeriodMode: "CALENDAR_MONTH", salaryBoundaryDay: 1 };
const dayMs = 86400000;
const at = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
export function dateRange(start: Date, end: Date) {
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / dayMs) + 1 };
}
// A payroll month names the month the cycle ends. Missing boundary dates
// (29th-31st in short months) use that month's last day.
export function salaryPeriod(period: string, policy: SalaryPeriodPolicy = defaultSalaryPeriod) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Choose a valid payroll month.");
  const [year, month] = period.split("-").map(Number);
  const day = policy.salaryBoundaryDay;
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Choose a boundary day from 1 to 31.");
  if (policy.salaryPeriodMode === "CALENDAR_MONTH" || (policy.salaryPeriodMode === "START_DAY" && day === 1))
    return dateRange(at(year, month - 1, 1), at(year, month - 1, 31));
  if (policy.salaryPeriodMode === "START_DAY")
    return dateRange(at(year, month - 2, day), new Date(at(year, month - 1, day).getTime() - dayMs));
  if (policy.salaryPeriodMode === "END_DAY")
    return dateRange(new Date(at(year, month - 2, day).getTime() + dayMs), at(year, month - 1, day));
  throw new Error("Unknown salary period policy.");
}
export type PayrollDates = { period: string; periodStart?: Date | null; periodEnd?: Date | null };
export function runPeriod(run: PayrollDates) {
  return run.periodStart && run.periodEnd ? dateRange(run.periodStart, run.periodEnd) : salaryPeriod(run.period);
}
