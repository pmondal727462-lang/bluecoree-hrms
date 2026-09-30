import { describe, expect, it } from "vitest";
import { salaryPeriod, runPeriod } from "@/modules/payroll/period";

const dates = (mode: "CALENDAR_MONTH" | "START_DAY" | "END_DAY", day: number, period = "2026-09") => {
  const r = salaryPeriod(period, { salaryPeriodMode: mode, salaryBoundaryDay: day });
  return [r.start.toISOString().slice(0, 10), r.end.toISOString().slice(0, 10), r.days];
};
describe("Company salary periods", () => {
  it("uses actual calendar month lengths including leap years", () => {
    expect(dates("CALENDAR_MONTH", 1)).toEqual(["2026-09-01", "2026-09-30", 30]);
    expect(dates("CALENDAR_MONTH", 1, "2026-08")).toEqual(["2026-08-01", "2026-08-31", 31]);
    expect(dates("CALENDAR_MONTH", 1, "2028-02")).toEqual(["2028-02-01", "2028-02-29", 29]);
  });
  it("distinguishes a cycle starting on 25 from one ending on 25", () => {
    expect(dates("START_DAY", 25)).toEqual(["2026-08-25", "2026-09-24", 31]);
    expect(dates("END_DAY", 25)).toEqual(["2026-08-26", "2026-09-25", 31]);
    expect(dates("START_DAY", 1)).toEqual(["2026-09-01", "2026-09-30", 30]);
    expect(dates("END_DAY", 25, "2027-01")).toEqual(["2026-12-26", "2027-01-25", 31]);
  });
  it("has no gaps or overlaps even for the 31st and short months", () => {
    for (const mode of ["START_DAY", "END_DAY"] as const) {
      for (const day of [1, 25, 28, 29, 30, 31]) {
        let previous: Date | undefined;
        for (let m = 1; m <= 12; m++) {
          const r = salaryPeriod(`2028-${String(m).padStart(2, "0")}`, { salaryPeriodMode: mode, salaryBoundaryDay: day });
          if (previous) expect(r.start.getTime() - previous.getTime()).toBe(86400000);
          expect(r.days).toBeGreaterThanOrEqual(28);
          expect(r.days).toBeLessThanOrEqual(31);
          previous = r.end;
        }
      }
    }
  });
  it("retains saved run dates and falls back to calendar months for legacy runs", () => {
    expect(runPeriod({ period: "2026-08", periodStart: new Date("2026-07-26"), periodEnd: new Date("2026-08-25") }).start.toISOString()).toBe("2026-07-26T00:00:00.000Z");
    expect(runPeriod({ period: "2026-08" }).start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(() => salaryPeriod("2026-13")).toThrow();
    expect(() => salaryPeriod("2026-08", { salaryPeriodMode: "START_DAY", salaryBoundaryDay: 32 })).toThrow();
  });
});
