import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let a = "";
const types: Record<string, string> = {};
const year = new Date().getUTCFullYear();
// Future working days (Monday to Friday) in the current year.
const future = (() => {
  const days: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while (days.length < 12 && d.getUTCFullYear() === year) {
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5)
      days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
})();
beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("solo", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  await db.holidaySelection.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await db.compOffRequest.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await db.leaveLedger.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});
const request = (who: string, body: Record<string, unknown>) =>
  call(f, "time/leave", "POST", who, { reason: "Personal work", ...body });
const balance = async (who: string, name: string) =>
  (await call(f, `time/balances?year=${year}`, "GET", who)).body.data.find(
    (b: { name: string }) => b.name === name,
  );

describe("Phase 6 leave", () => {
  it("adds the standard leave types once", async () => {
    const first = await call(f, "time/leave-types/defaults", "POST", "admin");
    expect(first.body.data.added).toHaveLength(7);
    expect(
      (await call(f, "time/leave-types/defaults", "POST", "admin")).body.data
        .added,
    ).toEqual([]);
    for (const t of await db.leaveType.findMany({ where: { companyId: a } }))
      types[t.name] = t.id;
    expect(await balance("staff", "Earned / Privilege Leave")).toMatchObject({
      accrual: "MONTHLY",
      carryForwardMax: 30,
      encashable: true,
    });
  });

  it("allows two half days on one date and unpaid leave beyond balance", async () => {
    const day = future[0];
    const firstHalf = await request("solo", {
      leaveTypeId: types["Casual Leave"],
      startDate: day,
      endDate: day,
      halfDay: true,
      session: "FIRST",
    });
    expect(firstHalf.body.data).toMatchObject({ days: 0.5, halfDay: true });
    expect(
      (
        await request("solo", {
          leaveTypeId: types["Sick Leave"],
          startDate: day,
          endDate: day,
          halfDay: true,
          session: "SECOND",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("solo", {
          leaveTypeId: types["Casual Leave"],
          startDate: day,
          endDate: day,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("solo", {
          leaveTypeId: types["Maternity Leave"],
          startDate: future[1],
          endDate: future[1],
          halfDay: true,
          session: "FIRST",
        })
      ).status,
    ).toBe(422);
    const lop = await request("solo", {
      leaveTypeId: types["Loss of Pay"],
      startDate: future[2],
      endDate: future[3],
    });
    expect(lop.status).toBe(200);
  });

  it("routes two-level leave through the reporting manager, then HR", async () => {
    await call(f, `time/leave-types/${types["Casual Leave"]}`, "PUT", "admin", {
      name: "Casual Leave",
      annualDays: 12,
      paid: true,
      approvalLevels: 2,
    });
    const r = await request("staff", {
      leaveTypeId: types["Casual Leave"],
      startDate: future[4],
      endDate: future[4],
    });
    const id = r.body.data.id;
    const team = await call(f, "time/leave?scope=team", "GET", "manager");
    expect(team.body.data.items.map((x: { id: string }) => x.id)).toContain(id);
    const level1 = await call(f, `time/leave/${id}`, "PUT", "manager", {
      status: "Approved",
    });
    expect(level1.body.data).toMatchObject({ status: "Pending", level: 2 });
    expect(
      (
        await call(f, `time/leave/${id}`, "PUT", "manager", {
          status: "Approved",
        })
      ).status,
    ).toBe(403);
    const final = await call(f, `time/leave/${id}`, "PUT", "admin", {
      status: "Approved",
    });
    expect(final.body.data.status).toBe("Approved");
    expect(final.body.data.approvals).toHaveLength(2);
    // Without a manager, HR approval is final.
    const solo = await request("solo", {
      leaveTypeId: types["Casual Leave"],
      startDate: future[5],
      endDate: future[5],
    });
    expect(
      (
        await call(f, `time/leave/${solo.body.data.id}`, "PUT", "admin", {
          status: "Approved",
        })
      ).body.data.status,
    ).toBe("Approved");
  });

  it("lets employees take optional holidays within the limit", async () => {
    await call(f, "time/policy", "PUT", "admin", {
      optionalHolidayLimit: 1,
      compOffEnabled: true,
      compOffExpiryDays: 60,
      gpsTrackingEnabled: false,
      geofenceEnabled: false,
      latitude: null,
      longitude: null,
      radiusMeters: 200,
    });
    const h1 = await call(f, "time/holidays", "POST", "admin", {
      name: "Onam",
      date: future[6],
      optional: true,
    });
    const h2 = await call(f, "time/holidays", "POST", "admin", {
      name: "Pongal",
      date: future[7],
      optional: true,
    });
    expect(
      (
        await call(
          f,
          `time/optional-holidays/${h1.body.data.id}`,
          "POST",
          "staff",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          f,
          `time/optional-holidays/${h2.body.data.id}`,
          "POST",
          "staff",
        )
      ).status,
    ).toBe(409);
    // The chosen optional holiday is not charged as leave for that employee.
    const mine = await request("staff", {
      leaveTypeId: types["Sick Leave"],
      startDate: future[6],
      endDate: future[7],
    });
    expect(mine.body.data.days).toBe(1);
    const theirs = await request("solo", {
      leaveTypeId: types["Sick Leave"],
      startDate: future[6],
      endDate: future[7],
    });
    expect(theirs.body.data.days).toBe(2);
  });

  it("credits compensatory off for work on an off day", async () => {
    // A past Sunday (weekly off) with a full day of work.
    const sunday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7) - 7);
      return d.toISOString().slice(0, 10);
    })();
    const worked = await call(f, "time/attendance", "POST", "admin", {
      employeeId: f.employees.staff,
      workDate: sunday,
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Weekend release support",
    });
    expect(worked.body.data.offDay).toBe(true);
    const claim = await call(f, "time/comp-off", "POST", "staff", {
      workDate: sunday,
      days: 1,
      reason: "Worked on release weekend",
    });
    expect(claim.status).toBe(200);
    expect(
      (
        await call(f, `time/comp-off/${claim.body.data.id}`, "PUT", "other", {
          status: "Approved",
        })
      ).status,
    ).toBe(404);
    const approved = await call(
      f,
      `time/comp-off/${claim.body.data.id}`,
      "PUT",
      "admin",
      { status: "Approved" },
    );
    expect(approved.body.data.expiresAt).toBeTruthy();
    expect(await balance("staff", "Compensatory Off")).toMatchObject({
      compOffEarned: 1,
      remaining: 1,
    });
  });

  it("carries forward, encashes and adjusts balances", async () => {
    expect(
      (
        await call(f, "time/leave-carry-forward", "POST", "staff", {
          fromYear: year - 1,
        })
      ).status,
    ).toBe(403);
    const carry = await call(f, "time/leave-carry-forward", "POST", "admin", {
      fromYear: year - 1,
    });
    expect(carry.body.data.carried).toBeGreaterThan(0);
    expect(
      (
        await call(f, "time/leave-carry-forward", "POST", "admin", {
          fromYear: year - 1,
        })
      ).body.data.carried,
    ).toBe(0);
    const el = await balance("solo", "Earned / Privilege Leave");
    expect(el.carriedForward).toBe(15);
    const encash = await call(f, "time/leave-encash", "POST", "admin", {
      employeeId: f.employees.solo,
      leaveTypeId: types["Earned / Privilege Leave"],
      year,
      days: 2,
    });
    expect(encash.status).toBe(200);
    expect(
      (
        await call(f, "time/leave-encash", "POST", "admin", {
          employeeId: f.employees.solo,
          leaveTypeId: types["Earned / Privilege Leave"],
          year,
          days: 14,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, "time/leave-encash", "POST", "admin", {
          employeeId: f.employees.solo,
          leaveTypeId: types["Casual Leave"],
          year,
          days: 1,
        })
      ).status,
    ).toBe(422);
    await call(f, "time/leave-adjust", "POST", "admin", {
      entries: [
        {
          employeeId: f.employees.solo,
          leaveTypeId: types["Sick Leave"],
          year,
          days: 1.5,
          note: "Joining bonus days",
        },
      ],
    });
    const after = await balance("solo", "Earned / Privilege Leave");
    expect(after.encashed).toBe(2);
    expect(after.remaining).toBe(el.remaining - 2);
    expect((await balance("solo", "Sick Leave")).adjusted).toBe(1.5);
    expect(
      (
        await call(f, "time/leave-adjust", "POST", "other", {
          entries: [
            {
              employeeId: f.employees.solo,
              leaveTypeId: types["Sick Leave"],
              year,
              days: 1,
              note: "Cross tenant",
            },
          ],
        })
      ).status,
    ).toBe(404);
  });
});
