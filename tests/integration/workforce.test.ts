import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as tenantDb, systemDb as db, withTenant } from "../../src/lib/db";
import { finalizeWork } from "../../src/modules/workforce/attendance";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let companyId = "",
  jobId = "",
  assignmentId = "",
  attendanceId = "";
const today = new Date().toISOString().slice(0, 10);
const date = new Date(today);
beforeAll(async () => {
  companyId = (await f.company("A")).id;
  const other = (await f.company("B")).id;
  await f.user("admin", companyId, "Company Admin");
  await f.user("staff", companyId, "Employee");
  await f.user("peer", companyId, "Employee");
  await f.user("other", other, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("workforce workflows", () => {
  it("allows HR to create jobs and prevents employee or cross-company edits", async () => {
    const body = { code: "SITE01", name: "Site maintenance" };
    expect(
      (await call(f, "workforce/jobs", "POST", "staff", body)).status,
    ).toBe(403);
    const created = await call(f, "workforce/jobs", "POST", "admin", body);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    jobId = created.body.data.id;
    expect(
      (await call(f, `workforce/jobs/${jobId}`, "PUT", "other", body)).status,
    ).toBe(404);
    expect((await call(f, "workforce/jobs", "GET", "other")).body.data).toEqual(
      [],
    );
    await withTenant(f.companies[1], async () => {
      expect(
        await tenantDb.workJob.findUnique({ where: { id: jobId } }),
      ).toBeNull();
    });
  });
  it("schedules activities, rejects overlap and restricts employee progress", async () => {
    const body = {
      jobId,
      employeeId: f.employees.staff,
      title: "Inspect equipment",
      startsAt: `${today}T09:00:00Z`,
      endsAt: `${today}T10:00:00Z`,
    };
    const created = await call(
      f,
      "workforce/assignments",
      "POST",
      "admin",
      body,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    assignmentId = created.body.data.id;
    expect(
      (await call(f, "workforce/assignments", "POST", "admin", body)).status,
    ).toBe(409);
    expect(
      (
        await call(f, "workforce/assignments", "POST", "admin", {
          ...body,
          employeeId: f.employees.other,
        })
      ).status,
    ).toBe(404);
    const progress = {
      status: "COMPLETED",
      progress: 40,
      note: "Inspection complete",
    };
    expect(
      (
        await call(
          f,
          `workforce/assignments/${assignmentId}/progress`,
          "PUT",
          "peer",
          progress,
        )
      ).status,
    ).toBe(403);
    const updated = await call(
      f,
      `workforce/assignments/${assignmentId}/progress`,
      "PUT",
      "staff",
      progress,
    );
    expect(updated.body.data.progress).toBe(100);
    expect(
      (await call(f, "workforce/assignments", "GET", "peer")).body.data,
    ).toEqual([]);
  });
  it("blocks scheduling approved leave and includes it in site totals", async () => {
    const leaveType = await db.leaveType.create({
      data: { companyId, name: "Annual leave", annualDays: 20 },
    });
    await db.leaveRequest.create({
      data: {
        companyId,
        employeeId: f.employees.peer,
        leaveTypeId: leaveType.id,
        startDate: date,
        endDate: date,
        days: 1,
        reason: "Test leave",
        status: "Approved",
      },
    });
    const body = {
      jobId,
      employeeId: f.employees.peer,
      title: "Cannot schedule leave",
      startsAt: `${today}T11:00:00Z`,
      endsAt: `${today}T12:00:00Z`,
    };
    expect(
      (await call(f, "workforce/assignments", "POST", "admin", body)).status,
    ).toBe(409);
    const sites = await call(
      f,
      `workforce/sites?date=${today}`,
      "GET",
      "admin",
    );
    expect(sites.status, JSON.stringify(sites.body)).toBe(200);
    expect(
      sites.body.data.sites.find((s: { id: string | null }) => !s.id),
    ).toMatchObject({ employees: 3, onLeave: 1, noPunch: 2 });
    expect((await call(f, "workforce/sites", "GET", "staff")).status).toBe(403);
  });
  it("prevents duplicate timers, closes jobs for breaks, and prevents working while on break", async () => {
    expect(
      (await call(f, "workforce/logs/start", "POST", "staff", { jobId }))
        .status,
    ).toBe(409);
    const attendance = await db.attendance.create({
      data: {
        companyId,
        employeeId: f.employees.staff,
        workDate: date,
        checkIn: new Date(Date.now() - 4 * 3600000),
        breakMinutes: 60,
      },
    });
    attendanceId = attendance.id;
    const results = await Promise.all([
      call(f, "workforce/logs/start", "POST", "staff", { jobId }),
      call(f, "workforce/logs/start", "POST", "staff", { jobId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await call(f, "workforce/breaks/start", "POST", "staff", {})).status,
    ).toBe(200);
    expect(
      await db.workLog.count({ where: { companyId, endedAt: null } }),
    ).toBe(0);
    expect(
      (await call(f, "workforce/logs/start", "POST", "staff", { jobId }))
        .status,
    ).toBe(409);
    expect(
      (await call(f, "workforce/breaks/start", "POST", "staff", {})).status,
    ).toBe(409);
    expect(
      (await call(f, "workforce/breaks/stop", "POST", "staff", {})).status,
    ).toBe(200);
    expect((await call(f, "workforce/logs", "GET", "peer")).body.data).toEqual(
      [],
    );
  });
  it("honors payroll locks and closes activity without discarding correction evidence", async () => {
    const run = await db.payrollRun.create({
      data: {
        companyId,
        period: today.slice(0, 7),
        status: "PROCESSED",
        createdBy: f.users.admin,
      },
    });
    expect(
      (await call(f, "workforce/breaks/start", "POST", "staff", {})).status,
    ).toBe(409);
    expect(
      (await call(f, "workforce/logs/start", "POST", "staff", { jobId }))
        .status,
    ).toBe(409);
    await db.payrollRun.delete({ where: { id: run.id } });
    expect(
      (await call(f, "workforce/logs/start", "POST", "staff", { jobId }))
        .status,
    ).toBe(200);
    const attendance = await db.attendance.findUniqueOrThrow({
      where: { id: attendanceId },
    });
    await expect(
      db.$transaction((tx) =>
        finalizeWork(
          tx,
          companyId,
          attendanceId,
          attendance.checkIn,
          new Date(Date.now() - 3600000),
          60,
        ),
      ),
    ).rejects.toThrow(/exclude recorded/);
    const minutes = await db.$transaction((tx) =>
      finalizeWork(
        tx,
        companyId,
        attendanceId,
        attendance.checkIn,
        new Date(),
        60,
      ),
    );
    expect(minutes).toBe(60);
    expect(
      await db.workLog.count({ where: { companyId, endedAt: null } }),
    ).toBe(0);
  });
  it("links agency contracts to employees and rejects overlapping or foreign contracts", async () => {
    const agency = await call(f, "workforce/agencies", "POST", "admin", {
      name: "Test agency",
      email: "agency@example.com",
    });
    expect(agency.status, JSON.stringify(agency.body)).toBe(200);
    const body = {
      agencyId: agency.body.data.id,
      employeeId: f.employees.staff,
      startsOn: today,
      endsOn: today,
    };
    expect(
      (await call(f, "workforce/contracts", "POST", "admin", body)).status,
    ).toBe(200);
    expect(
      (await call(f, "workforce/contracts", "POST", "admin", body)).status,
    ).toBe(409);
    expect(
      (
        await call(f, "workforce/contracts", "POST", "admin", {
          ...body,
          employeeId: f.employees.other,
        })
      ).status,
    ).toBe(404);
    expect((await call(f, "workforce/contracts", "GET", "staff")).status).toBe(
      403,
    );
  });
  it("uses actual break duration in corrected attendance hours", async () => {
    const checkIn = new Date("2026-09-14T09:00:00Z");
    const attendance = await db.attendance.create({
      data: {
        companyId,
        employeeId: f.employees.peer,
        workDate: new Date("2026-09-14"),
        checkIn,
      },
    });
    await db.attendanceBreak.create({
      data: {
        companyId,
        employeeId: f.employees.peer,
        attendanceId: attendance.id,
        startedAt: new Date("2026-09-14T12:00:00Z"),
        endedAt: new Date("2026-09-14T14:00:00Z"),
      },
    });
    const corrected = await call(
      f,
      `time/attendance/${attendance.id}`,
      "PUT",
      "admin",
      {
        employeeId: f.employees.peer,
        checkIn: checkIn.toISOString(),
        checkOut: "2026-09-14T18:00:00Z",
        reason: "Verify two-hour actual break deduction",
      },
    );
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.data).toMatchObject({
      workedMinutes: 420,
      breakMinutes: 120,
    });
  });
  it("enforces Basic versus Advanced workforce entitlements", async () => {
    const basic = await db.subscriptionPlan.findUniqueOrThrow({
      where: { code: "BASIC" },
    });
    expect(basic.features).toContain("jobtracking");
    expect(basic.features).not.toContain("workplanning");
    await db.subscription.update({
      where: { companyId },
      data: { planId: basic.id, status: "ACTIVE", currentPeriodEnd: null },
    });
    expect((await call(f, "workforce/jobs", "GET", "staff")).status).toBe(200);
    expect(
      (await call(f, "workforce/assignments", "GET", "staff")).status,
    ).toBe(402);
    expect((await call(f, "workforce/agencies", "GET", "admin")).status).toBe(
      402,
    );
  });
});
