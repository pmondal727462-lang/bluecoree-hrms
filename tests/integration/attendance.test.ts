import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let a = "",
  general = "",
  night = "";
// Past weekdays in a UTC company working Monday to Friday.
const monday = "2026-09-14",
  tuesday = "2026-09-15",
  wednesday = "2026-09-16",
  saturday = "2026-09-19";
beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
  // Location is not required for these punches.
  await call(f, "time/policy", "PUT", "admin", {
    overtimeRequiresApproval: false,
    gpsTrackingEnabled: false,
    geofenceEnabled: false,
    latitude: null,
    longitude: null,
    radiusMeters: 200,
  });
});
afterAll(async () => {
  await db.rosterEntry.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});
const manual = (workDate: string, checkIn: string, checkOut: string) =>
  call(f, "time/attendance", "POST", "admin", {
    employeeId: f.employees.staff,
    workDate,
    checkIn,
    checkOut,
    reason: "Phase 3 rule check",
  });

describe("Phase 3 attendance", () => {
  it("configures fixed, flexible, split and night shifts with their rules", async () => {
    const base = {
      startMinute: 540,
      endMinute: 1080,
      graceMinutes: 15,
      breakMinutes: 60,
    };
    expect(
      (
        await call(f, "time/shifts", "POST", "admin", {
          ...base,
          name: "Flexible",
          kind: "FLEXIBLE",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, "time/shifts", "POST", "admin", {
          ...base,
          name: "Split",
          kind: "SPLIT",
          splitStartMinute: 600,
          splitEndMinute: 700,
        })
      ).status,
    ).toBe(422);
    const split = await call(f, "time/shifts", "POST", "admin", {
      ...base,
      endMinute: 780,
      name: "Split",
      kind: "SPLIT",
      splitStartMinute: 1020,
      splitEndMinute: 1260,
    });
    expect(split.status).toBe(200);
    const g = await call(f, "time/shifts", "POST", "admin", {
      ...base,
      name: "General",
      minimumMinutes: 480,
      halfDayMinutes: 240,
      earlyExitGraceMinutes: 10,
      overtimeAfterMinutes: 30,
    });
    expect(g.body.data).toMatchObject({
      kind: "FIXED",
      minimumMinutes: 480,
      overtimeAfterMinutes: 30,
    });
    general = g.body.data.id;
    night = (
      await call(f, "time/shifts", "POST", "admin", {
        ...base,
        name: "Night",
        startMinute: 1320,
        endMinute: 420,
      })
    ).body.data.id;
    expect(
      (
        await call(f, "time/assign-shift", "PUT", "admin", {
          employeeId: f.employees.staff,
          shiftId: general,
        })
      ).status,
    ).toBe(200);
  });

  it("plans rosters per day with tenant and permission checks", async () => {
    const save = await call(f, "time/rosters", "PUT", "admin", {
      entries: [
        { employeeId: f.employees.staff, workDate: tuesday, shiftId: night },
        { employeeId: f.employees.staff, workDate: wednesday, weeklyOff: true },
        { employeeId: f.employees.staff, workDate: saturday, shiftId: general },
      ],
    });
    expect(save.body.data).toEqual({ saved: 3, cleared: 0 });
    const week = await call(
      f,
      `time/rosters?from=${monday}&to=${addDay(monday, 6)}`,
      "GET",
      "admin",
    );
    const row = week.body.data.items.find(
      (r: { id: string }) => r.id === f.employees.staff,
    );
    expect(row.shift.name).toBe("General");
    expect(row.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workDate: tuesday, shiftId: night }),
        expect.objectContaining({ workDate: wednesday, weeklyOff: true }),
      ]),
    );
    expect(
      (
        await call(f, "time/rosters", "PUT", "staff", {
          entries: [
            {
              employeeId: f.employees.staff,
              workDate: monday,
              weeklyOff: true,
            },
          ],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(f, "time/rosters", "PUT", "other", {
          entries: [
            {
              employeeId: f.employees.staff,
              workDate: monday,
              weeklyOff: true,
            },
          ],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          f,
          `time/rosters?from=${monday}&to=2026-10-30`,
          "GET",
          "admin",
        )
      ).status,
    ).toBe(422);
    // The daily register shows the rostered plan.
    const register = async (date: string) =>
      (
        await call(f, `time/roster?date=${date}`, "GET", "admin")
      ).body.data.items.find((r: { id: string }) => r.id === f.employees.staff);
    expect((await register(tuesday)).shift.name).toBe("Night");
    expect((await register(wednesday)).status).toBe("Weekly off");
  });

  it("applies half day, early exit, overtime, off days and rostered shifts", async () => {
    // Monday, General shift 09:00-18:00, full day 480, half day 240.
    const half = await manual(monday, "09:00", "15:00");
    expect(half.body.data).toMatchObject({
      status: "HALF_DAY",
      workedMinutes: 300,
      earlyExitMinutes: 180,
      offDay: false,
    });
    // A rostered weekly off has no shift (so no break): all work is
    // overtime, with no late mark or early exit.
    const off = await manual(wednesday, "10:00", "13:00");
    expect(off.body.data).toMatchObject({
      offDay: true,
      workedMinutes: 180,
      overtimeMinutes: 180,
      earlyExitMinutes: 0,
      lateMinutes: 0,
      overtimeStatus: "APPROVED",
    });
    // A rostered night shift on Tuesday ends the next morning.
    const nightWork = await manual(tuesday, "22:00", "07:30");
    expect(nightWork.body.data).toMatchObject({
      workDate: `${tuesday}T00:00:00.000Z`,
      shiftName: "Night",
      offDay: false,
    });
    // Saturday is normally off, but the roster makes it a working day.
    const rostered = await manual(saturday, "09:40", "18:00");
    expect(rostered.body.data).toMatchObject({
      offDay: false,
      lateMinutes: 40,
      shiftName: "General",
    });
  });

  it("holds overtime for HR approval when the policy requires it", async () => {
    await call(f, "time/policy", "PUT", "admin", {
      overtimeRequiresApproval: true,
      gpsTrackingEnabled: false,
      geofenceEnabled: false,
      latitude: null,
      longitude: null,
      radiusMeters: 200,
    });
    const long = await manual("2026-09-17", "09:00", "20:00");
    expect(long.body.data).toMatchObject({
      overtimeMinutes: 120,
      overtimeStatus: "PENDING",
      approvedOvertimeMinutes: 0,
    });
    const pending = await call(
      f,
      "time/attendance?scope=company&overtimeStatus=PENDING&from=2026-09-01&to=2026-09-30",
      "GET",
      "admin",
    );
    expect(pending.body.data.items.map((x: { id: string }) => x.id)).toEqual([
      long.body.data.id,
    ]);
    expect(
      (
        await call(f, `time/overtime/${long.body.data.id}`, "PUT", "staff", {
          status: "APPROVED",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(f, `time/overtime/${long.body.data.id}`, "PUT", "other", {
          status: "APPROVED",
        })
      ).status,
    ).toBe(404);
    const approved = await call(
      f,
      `time/overtime/${long.body.data.id}`,
      "PUT",
      "admin",
      { status: "APPROVED", minutes: 90 },
    );
    expect(approved.body.data).toMatchObject({
      overtimeStatus: "APPROVED",
      approvedOvertimeMinutes: 90,
    });
    expect(
      (
        await call(f, `time/overtime/${long.body.data.id}`, "PUT", "admin", {
          status: "REJECTED",
        })
      ).status,
    ).toBe(409);
  });

  it("logs every punch with its source, IP and device", async () => {
    await db.attendance.deleteMany({
      where: { employeeId: f.employees.staff, checkOut: null },
    });
    const web = await call(f, "time/check-in", "POST", "staff", {
      deviceId: "browser-device-01",
    });
    expect(web.status).toBe(200);
    expect(web.body.data.source).toBe("Web");
    const punch = await db.attendancePunch.findFirstOrThrow({
      where: { attendanceId: web.body.data.id },
    });
    expect(punch).toMatchObject({
      direction: "IN",
      source: "Web",
      deviceId: "browser-device-01",
    });
    expect(punch.ip).toBeTruthy();
    await db.attendance.update({
      where: { id: web.body.data.id },
      data: { checkIn: new Date(Date.now() - 3 * 3600000) },
    });
    const mobile = await call(f, "v1/attendance/check-out", "POST", "staff", {
      deviceId: "android-device-01",
    });
    expect(mobile.status).toBe(200);
    expect(
      await db.attendancePunch.findFirstOrThrow({
        where: { attendanceId: web.body.data.id, direction: "OUT" },
      }),
    ).toMatchObject({ source: "Mobile", deviceId: "android-device-01" });
  });
});

function addDay(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
