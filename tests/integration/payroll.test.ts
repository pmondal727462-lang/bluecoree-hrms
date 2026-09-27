import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 7: effective-dated statutory rules, pay from attendance, overtime,
// encashment, loans, variable pay, the approval workflow, month locks and
// server-generated payslips. August 2026 is a fully elapsed month.
const f = new Fixture();
let a = "";
let runId = "";
let july = "";
const aug = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("finance", a, "Finance Manager");
  await f.user("worker", a, "Employee");
  await f.user("staff", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  await db.leaveLedger.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await db.payrollRun.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 7 payroll", () => {
  it("sets up pay rules, salary, attendance, overtime, encashment and loans", async () => {
    const stat = (await call(f, "payroll/statutory", "GET", "admin")).body.data;
    const { ptSlabs, ...config } = stat.config;
    const saved = await call(f, "payroll/statutory", "PUT", "admin", {
      ...config,
      ptSlabs,
      ptState: null,
      pfEnabled: false,
      esiEnabled: false,
      ptEnabled: false,
      tdsEnabled: false,
      lopFromAttendance: true,
      overtimeMultiplier: 2,
      overtimeBasis: "BASIC",
      hoursPerDay: 8,
      encashmentDivisor: 30,
    });
    expect(saved.status).toBe(200);
    expect(
      (await call(f, "payroll/statutory", "GET", "admin")).body.data.options,
    ).toMatchObject({ lopFromAttendance: true, overtimeMultiplier: 2 });

    const w = f.employees.worker;
    expect(
      (
        await call(f, `payroll/structures/${w}`, "PUT", "admin", {
          basic: 30000,
          hra: 10000,
          conveyance: 1600,
          specialAllowance: 8400,
          otherAllowance: 0,
          pfApplicable: false,
          esiApplicable: false,
          ptApplicable: false,
          taxRegime: "NEW",
          effectiveFrom: "2024-01-01",
        })
      ).status,
    ).toBe(200);

    // Weekdays in August 2026: 3-7, 10-14, 17-21, 24-28, 31. The 5th has
    // no record, the 6th is a half day and the 7th is absent. The 31st is
    // entered through HR's manual attendance.
    const rows = [];
    for (let d = 3; d <= 28; d++) {
      const day = new Date(`${aug(d)}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6 || d === 5) continue;
      const status = d === 6 ? "HALF_DAY" : d === 7 ? "ABSENT" : "PRESENT";
      rows.push({
        companyId: a,
        employeeId: w,
        workDate: new Date(aug(d)),
        checkIn: new Date(`${aug(d)}T09:00:00Z`),
        checkOut: new Date(`${aug(d)}T${d === 10 ? "20" : "18"}:00:00Z`),
        workedMinutes: status === "PRESENT" ? 480 : 240,
        status,
        ...(d === 10
          ? {
              overtimeMinutes: 120,
              overtimeStatus: "APPROVED",
              approvedOvertimeMinutes: 120,
            }
          : {}),
      });
    }
    await db.attendance.createMany({ data: rows });
    expect(
      (
        await call(f, "time/attendance", "POST", "admin", {
          employeeId: w,
          workDate: aug(31),
          checkIn: "09:00",
          checkOut: "18:00",
          reason: "Biometric device offline",
        })
      ).status,
    ).toBe(200);

    const type = await db.leaveType.create({
      data: { companyId: a, name: "Earned", annualDays: 18, paid: true },
    });
    await db.leaveLedger.create({
      data: {
        companyId: a,
        employeeId: w,
        leaveTypeId: type.id,
        year: 2026,
        kind: "ENCASHMENT",
        days: -3,
      },
    });

    const loan = await call(f, "payroll/loans", "POST", "admin", {
      employeeId: w,
      kind: "LOAN",
      principal: 5000,
      instalment: 2000,
      startPeriod: "2026-08",
    });
    expect(loan.body.data).toMatchObject({ balance: 5000, status: "ACTIVE" });
    const advance = await call(f, "payroll/loans", "POST", "admin", {
      employeeId: w,
      kind: "ADVANCE",
      principal: 1000,
      startPeriod: "2026-08",
    });
    expect(advance.body.data.instalment).toBe(1000);
    expect(
      (
        await call(f, "payroll/loans", "POST", "admin", {
          employeeId: w,
          kind: "LOAN",
          principal: 1000,
          startPeriod: "2026-08",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, "payroll/loans", "POST", "other", {
          employeeId: w,
          kind: "ADVANCE",
          principal: 1000,
          startPeriod: "2026-08",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(f, `payroll/loans/${loan.body.data.id}`, "PUT", "other", {
          status: "CLOSED",
        })
      ).status,
    ).toBe(404);
    expect((await call(f, "payroll/loans", "GET", "worker")).status).toBe(403);
  });

  it("calculates pay from attendance with overtime, encashment, loans and bonus", async () => {
    const run = await call(f, "payroll/runs", "POST", "admin", {
      period: "2026-08",
    });
    expect(run.status).toBe(200);
    runId = run.body.data.id;
    const detail = (await call(f, `payroll/runs/${runId}`, "GET", "admin")).body
      .data;
    const item = detail.items.find(
      (i: { employeeId: string }) => i.employeeId === f.employees.worker,
    );
    expect(item).toMatchObject({
      totalDays: 31,
      absentDays: 2.5,
      lopDays: 2.5,
      paidDays: 28.5,
      overtimeMinutes: 120,
      overtimePay: 484,
      encashmentDays: 3,
      encashmentPay: 3000,
      loanDeduction: 2000,
      advanceDeduction: 1000,
    });
    const bonus = await call(
      f,
      `payroll/runs/${runId}/items/${item.id}`,
      "PUT",
      "admin",
      { bonus: 2500, reason: "Festival bonus" },
    );
    expect(bonus.body.data).toMatchObject({ bonus: 2500, lopDays: 2.5 });
    // Variable pay survives recalculation.
    await call(f, `payroll/runs/${runId}/recalculate`, "POST", "admin");
    const again = (
      await call(f, `payroll/runs/${runId}`, "GET", "admin")
    ).body.data.items.find(
      (i: { employeeId: string }) => i.employeeId === f.employees.worker,
    );
    expect(again.bonus).toBe(2500);
    expect(again.earnings).toMatchObject({
      conveyance: 1471,
      bonus: 2500,
      overtime: 484,
      leaveEncashment: 3000,
    });
    expect(again.gross).toBe(51953);
    expect(again.deductions).toBe(3000);
    expect(again.netPay).toBe(48953);
  });

  it("requires submission and approval by another person, and locks the month", async () => {
    const w = f.employees.worker;
    expect(
      (await call(f, `payroll/runs/${runId}/process`, "POST", "admin")).status,
    ).toBe(409);
    expect(
      (await call(f, `payroll/runs/${runId}/submit`, "POST", "admin")).body.data
        .status,
    ).toBe("SUBMITTED");
    const locked = await call(f, "time/attendance", "POST", "admin", {
      employeeId: w,
      workDate: aug(5),
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Forgot to punch",
    });
    expect(locked.status).toBe(409);
    expect(locked.body.errorCode).toBe("PAYROLL_LOCKED");
    const type = await db.leaveType.findFirstOrThrow({
      where: { companyId: a, name: "Earned" },
    });
    const leave = await db.leaveRequest.create({
      data: {
        companyId: a,
        employeeId: w,
        leaveTypeId: type.id,
        startDate: new Date(aug(7)),
        endDate: new Date(aug(7)),
        days: 1,
        reason: "Unwell",
      },
    });
    expect(
      (
        await call(f, `time/leave/${leave.id}`, "PUT", "admin", {
          status: "Approved",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(f, `payroll/runs/${runId}/recalculate`, "POST", "admin"))
        .status,
    ).toBe(409);
    expect(
      (await call(f, `payroll/runs/${runId}/approve`, "POST", "admin", {})).body
        .errorCode,
    ).toBe("SELF_APPROVAL");
    expect(
      (await call(f, `payroll/runs/${runId}/approve`, "POST", "worker", {}))
        .status,
    ).toBe(403);
    expect(
      (await call(f, `payroll/runs/${runId}/approve`, "POST", "finance", {}))
        .body.data.status,
    ).toBe("APPROVED");
  });

  it("sends a run back to draft with a reason and unlocks the month", async () => {
    july = (
      await call(f, "payroll/runs", "POST", "admin", { period: "2026-07" })
    ).body.data.id;
    await call(f, `payroll/runs/${july}/submit`, "POST", "admin");
    const day = {
      employeeId: f.employees.staff,
      workDate: "2026-07-15",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Device was offline",
    };
    expect(
      (await call(f, "time/attendance", "POST", "admin", day)).status,
    ).toBe(409);
    expect(
      (await call(f, `payroll/runs/${july}/reject`, "POST", "finance", {}))
        .status,
    ).toBe(422);
    const back = await call(
      f,
      `payroll/runs/${july}/reject`,
      "POST",
      "finance",
      {
        note: "Attendance for 15 July is missing",
      },
    );
    expect(back.body.data).toMatchObject({
      status: "DRAFT",
      reviewNote: "Attendance for 15 July is missing",
    });
    expect(
      (await call(f, "time/attendance", "POST", "admin", day)).status,
    ).toBe(200);
  });

  it("processes the approved run, settling loans and encashment", async () => {
    const processed = await call(
      f,
      `payroll/runs/${runId}/process`,
      "POST",
      "admin",
    );
    expect(processed.body.data.status).toBe("PROCESSED");
    const loans = await db.employeeLoan.findMany({
      where: { employeeId: f.employees.worker },
      include: { repayments: true },
      orderBy: { kind: "asc" },
    });
    expect(loans.map((l) => [l.kind, l.balance, l.status])).toEqual([
      ["ADVANCE", 0, "CLOSED"],
      ["LOAN", 3000, "ACTIVE"],
    ]);
    expect(loans.every((l) => l.repayments.length === 1)).toBe(true);
    const ledger = await db.leaveLedger.findFirstOrThrow({
      where: { employeeId: f.employees.worker, kind: "ENCASHMENT" },
    });
    expect(ledger).toMatchObject({ amount: 3000, refId: runId });
    const slip = await db.payslip.findFirstOrThrow({
      where: { employeeId: f.employees.worker },
    });
    expect(slip.netPay).toBe(48953);
    expect(slip.breakdown).toMatchObject({
      deductions: { loan: 2000, advance: 1000 },
      days: { absent: 2.5, lop: 2.5 },
      overtime: { minutes: 120, pay: 484 },
      encashment: { days: 3, pay: 3000 },
    });
    // A later run no longer pays the settled encashment.
    const june = await call(f, "payroll/runs", "POST", "admin", {
      period: "2026-06",
    });
    const next = (
      await call(f, `payroll/runs/${june.body.data.id}`, "GET", "admin")
    ).body.data.items.find(
      (i: { employeeId: string }) => i.employeeId === f.employees.worker,
    );
    expect(next).toMatchObject({ encashmentPay: 0, loanDeduction: 0 });
  });

  it("issues a payslip PDF to HR and the employee only", async () => {
    const slip = await db.payslip.findFirstOrThrow({
      where: { employeeId: f.employees.worker },
    });
    for (const who of ["worker", "admin"]) {
      const pdf = await call(f, `payroll/payslips/${slip.id}/pdf`, "GET", who);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(String(pdf.body).startsWith("%PDF")).toBe(true);
    }
    for (const who of ["staff", "other"])
      expect(
        (await call(f, `payroll/payslips/${slip.id}/pdf`, "GET", who)).status,
      ).toBe(404);
  });

  it("applies company statutory rules from their effective date", async () => {
    const before = (
      await call(f, "payroll/statutory-rules?period=2026-08", "GET", "admin")
    ).body.data;
    expect(
      before.items.some((r: { scope: string }) => r.scope === "PLATFORM"),
    ).toBe(true);
    const platformPf = before.applied.PF;
    const rule = await call(f, "payroll/statutory-rules", "POST", "admin", {
      ruleType: "PF",
      name: "PF reduced rate",
      effectiveFrom: "2026-10-01",
      employeeRate: 10,
      employerRate: 10,
      ceiling: 15000,
      calculationMethod: "PERCENT_OF_BASIC",
    });
    expect(rule.status).toBe(200);
    const oct = (
      await call(f, "payroll/statutory-rules?period=2026-10", "GET", "admin")
    ).body.data;
    expect(oct.applied.PF).toBe(rule.body.data.id);
    expect(
      (await call(f, "payroll/statutory-rules?period=2026-08", "GET", "admin"))
        .body.data.applied.PF,
    ).toBe(platformPf);
    // Other tenants and non-payroll users do not see it; only the platform
    // can change platform rules.
    const other = (
      await call(f, "payroll/statutory-rules?period=2026-10", "GET", "other")
    ).body.data;
    expect(other.applied.PF).toBe(platformPf);
    expect(
      (await call(f, "payroll/statutory-rules", "GET", "worker")).status,
    ).toBe(403);
    expect(
      (
        await call(f, "platform/statutory-rules", "POST", "admin", {
          ruleType: "PF",
          name: "x",
          effectiveFrom: "2026-10-01",
          calculationMethod: "PERCENT_OF_BASIC",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          f,
          `payroll/statutory-rules/${rule.body.data.id}`,
          "PUT",
          "other",
          {
            ruleType: "PF",
            name: "hijack",
            effectiveFrom: "2026-10-01",
            calculationMethod: "PERCENT_OF_BASIC",
          },
        )
      ).status,
    ).toBe(404);
  });
});
