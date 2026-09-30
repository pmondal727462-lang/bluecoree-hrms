import { expect, it } from "vitest";
import {
  companyDateTimeInput,
  companyDateTimeToIso,
  formatCompanyDate,
  formatCompanyDateTime,
} from "@/lib/company-date";

it("renders stored UTC punches as full company-local dates and 24-hour times", () => {
  expect(formatCompanyDateTime("2026-08-03T03:30:00Z", "Asia/Kolkata")).toBe(
    "03/08/2026 09:00",
  );
  expect(formatCompanyDateTime("2026-08-03T12:30:00Z", "Asia/Kolkata")).toBe(
    "03/08/2026 18:00",
  );
  expect(formatCompanyDateTime("2026-08-03T20:00:00Z", "Asia/Kolkata")).toBe(
    "04/08/2026 01:30",
  );
});

it("preserves calendar-only payroll dates and supports company date preferences", () => {
  expect(formatCompanyDate("2026-08-01T00:00:00Z")).toBe("01/08/2026");
  expect(formatCompanyDate("2026-08-31", "MM/DD/YYYY")).toBe("08/31/2026");
  expect(formatCompanyDate("2026-08-31", "YYYY-MM-DD")).toBe("2026-08-31");
  expect(formatCompanyDate("2026-08-31", "DD-MMM-YYYY")).toBe("31-Aug-2026");
});

it("round-trips local correction inputs without changing their saved time or seconds", () => {
  const iso = "2026-08-03T03:30:25.000Z";
  expect(companyDateTimeInput(iso, "Asia/Kolkata")).toBe("2026-08-03T09:00:25");
  expect(companyDateTimeToIso("2026-08-03T09:00:25", "Asia/Kolkata")).toBe(iso);
  expect(companyDateTimeToIso("2026-08-04T01:30", "Asia/Kolkata")).toBe(
    "2026-08-03T20:00:00.000Z",
  );
});

it("rejects invalid dates and skipped daylight-saving times", () => {
  expect(() =>
    companyDateTimeToIso("2026-02-30T09:00", "Asia/Kolkata"),
  ).toThrow();
  expect(() =>
    companyDateTimeToIso("2026-03-08T02:30", "America/New_York"),
  ).toThrow("does not exist");
});
