import { afterAll, beforeAll, expect, it } from "vitest";
import { systemDb as db, withTenant } from "../../src/lib/db";
import { Fixture, call } from "./helpers";
import { assertPayrollOpenRange } from "../../src/modules/payroll/compute";

const f = new Fixture();
let companyId: string;
let runId: string;
beforeAll(async () => {
  companyId = (await f.company("PERIOD")).id;
  await f.user("admin", companyId, "Company Admin");
  await f.user("hr", companyId, "HR Manager");
  await f.user("finance", companyId, "Finance Manager");
  await f.user("worker", companyId, "Employee", { joinedAt: "2026-08-05" });
  const other = await f.company("OTHER");
  await f.user("other", other.id, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

it("lets HR save only their company's policy and validates boundaries", async () => {
  expect(
    (
      await call(f, "payroll/period-policy", "PUT", "worker", {
        salaryPeriodMode: "END_DAY",
        salaryBoundaryDay: 25,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(f, "payroll/period-policy", "PUT", "hr", {
        salaryPeriodMode: "END_DAY",
        salaryBoundaryDay: 32,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call(f, "payroll/period-policy", "PUT", "hr", {
        salaryPeriodMode: "END_DAY",
        salaryBoundaryDay: 25,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(f, "payroll/period-policy", "GET", "other")).body.data
      .salaryPeriodMode,
  ).toBe("CALENDAR_MONTH");
});

it("calculates joining, half-day leave, absences and overtime within the chosen cycle", async () => {
  await db.company.update({
    where: { id: companyId },
    data: { workingDays: [0, 1, 2, 3, 4, 5, 6] },
  });
  const s = (await call(f, "payroll/statutory", "GET", "admin")).body.data;
  expect(
    (
      await call(f, "payroll/statutory", "PUT", "admin", {
        ...s.config,
        ptState: null,
        pfEnabled: false,
        esiEnabled: false,
        ptEnabled: false,
        tdsEnabled: false,
        lopFromAttendance: true,
        overtimeMultiplier: 2,
        overtimeBasis: "BASIC",
        hoursPerDay: 8,
      })
    ).status,
  ).toBe(200);
  await db.salaryStructure.create({
    data: {
      companyId,
      employeeId: f.employees.worker,
      basic: 31000,
      effectiveFrom: new Date("2026-07-01"),
      pfApplicable: false,
      esiApplicable: false,
      ptApplicable: false,
    },
  });
  const leaveType = await db.leaveType.create({
    data: { companyId, name: "Unpaid", paid: false, annualDays: 30 },
  });
  await db.leaveRequest.create({
    data: {
      companyId,
      employeeId: f.employees.worker,
      leaveTypeId: leaveType.id,
      startDate: new Date("2026-08-12"),
      endDate: new Date("2026-08-12"),
      days: 0.5,
      halfDay: true,
      status: "Approved",
      reason: "Half-day test",
    },
  });
  const days = Array.from(
    { length: 22 },
    (_, i) => `2026-08-${String(i + 5).padStart(2, "0")}`,
  );
  await db.attendance.createMany({
    data: days.map((d) => ({
      companyId,
      employeeId: f.employees.worker,
      workDate: new Date(d),
      checkIn: new Date(`${d}T09:00:00Z`),
      checkOut: new Date(`${d}T18:00:00Z`),
      status: d.endsWith("10")
        ? "ABSENT"
        : d.endsWith("11") || d.endsWith("12")
          ? "HALF_DAY"
          : "PRESENT",
      overtimeStatus: "APPROVED",
      approvedOvertimeMinutes: d.endsWith("25")
        ? 60
        : d.endsWith("26")
          ? 600
          : 0,
    })),
  });
  const result = await call(f, "payroll/runs", "POST", "admin", {
    period: "2026-08",
  });
  expect(result.status).toBe(200);
  runId = result.body.data.id;
  expect(result.body.data.periodStart.slice(0, 10)).toBe("2026-07-26");
  expect(result.body.data.periodEnd.slice(0, 10)).toBe("2026-08-25");
  const detail = (await call(f, `payroll/runs/${runId}`, "GET", "admin")).body
    .data;
  expect(detail.items[0]).toMatchObject({
    totalDays: 31,
    lopDays: 12,
    absentDays: 1.5,
    paidDays: 19,
    overtimeMinutes: 60,
    overtimePay: 250,
    gross: 19250,
    netPay: 19250,
  });
});

it("keeps run dates after a policy change, locks the complete cross-month range, and issues correct payslips", async () => {
  await call(f, "payroll/period-policy", "PUT", "hr", {
    salaryPeriodMode: "END_DAY",
    salaryBoundaryDay: 20,
  });
  expect(
    (await call(f, `payroll/runs/${runId}/recalculate`, "POST", "admin"))
      .status,
  ).toBe(200);
  expect(
    (await call(f, `payroll/runs/${runId}/submit`, "POST", "admin")).status,
  ).toBe(200);
  await expect(
    withTenant(companyId, () =>
      db.$transaction((tx) =>
        assertPayrollOpenRange(
          tx,
          companyId,
          new Date("2026-07-26"),
          new Date("2026-07-27"),
        ),
      ),
    ),
  ).rejects.toThrow("locked");
  expect(
    (
      await call(f, "time/attendance", "POST", "admin", {
        employeeId: f.employees.admin,
        workDate: "2026-07-26",
        checkIn: "09:00",
        checkOut: "18:00",
        reason: "Locked date test",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(f, "time/attendance", "POST", "admin", {
        employeeId: f.employees.admin,
        workDate: "2026-08-26",
        checkIn: "09:00",
        checkOut: "18:00",
        reason: "Outside period test",
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(f, `payroll/runs/${runId}/approve`, "POST", "finance", {}))
      .status,
  ).toBe(200);
  expect(
    (await call(f, `payroll/runs/${runId}/process`, "POST", "admin")).status,
  ).toBe(200);
  const slip = (await call(f, "payroll/payslips", "GET", "worker")).body
    .data[0];
  expect(slip.periodStart.slice(0, 10)).toBe("2026-07-26");
  expect(slip.periodEnd.slice(0, 10)).toBe("2026-08-25");
  expect(
    (
      await call(
        f,
        "payroll/payslips?page=1&period=2026-08&search=worker",
        "GET",
        "hr",
      )
    ).body.data.total,
  ).toBe(1);
  expect(
    (await call(f, "payroll/payslips?page=1&period=2026-07", "GET", "worker"))
      .body.data.total,
  ).toBe(0);
  expect(
    (await call(f, "payroll/runs", "POST", "admin", { period: "2026-09" })).body
      .errorCode,
  ).toBe("PAYROLL_PERIOD_OVERLAP");
  await call(f, "payroll/period-policy", "PUT", "hr", {
    salaryPeriodMode: "END_DAY",
    salaryBoundaryDay: 28,
  });
  expect(
    (await call(f, "payroll/runs", "POST", "admin", { period: "2026-09" })).body
      .errorCode,
  ).toBe("PAYROLL_PERIOD_GAP");
});
