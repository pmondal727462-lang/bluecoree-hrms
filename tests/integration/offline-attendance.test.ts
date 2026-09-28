import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { issueOfflinePermit } from "../../src/modules/time/offline";
import type { Context } from "../../src/modules/auth/service";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let companyId = "";
const deviceId = randomUUID();
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const clock = (hour: string) => `${yesterday}T${hour}:00:00.000Z`;
function body(who: string, direction: "IN" | "OUT", at: string) {
  const ctx = { userId: f.users[who], companyId } as Context;
  const permit = issueOfflinePermit(
    ctx,
    f.employees[who],
    deviceId,
    Date.parse(clock("00")),
  ).permit;
  return {
    deviceId,
    offline: { eventId: randomUUID(), direction, capturedAt: at, permit },
  };
}
beforeAll(async () => {
  companyId = (await f.company("OFFLINE")).id;
  for (const who of ["staff", "peer", "gps", "face", "locked"])
    await f.user(who, companyId, "Employee");
  await f.user("other", (await f.company("OTHER")).id, "Employee");
  await db.employee.updateMany({
    where: { companyId },
    data: { attendanceMode: "OPEN" },
  });
  await db.attendancePolicy.create({
    data: { companyId, gpsTrackingEnabled: false, geofenceEnabled: false },
  });
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});
describe("offline employee attendance", () => {
  it("prepares an authenticated device without accepting anonymous requests", async () => {
    expect(
      (await call(f, `time/offline-permit?deviceId=${deviceId}`)).status,
    ).toBe(401);
    const r = await call(
      f,
      `time/offline-permit?deviceId=${deviceId}`,
      "GET",
      "staff",
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      deviceId,
      userId: f.users.staff,
      employeeId: f.employees.staff,
      checkedIn: false,
    });
  });
  it("preserves original timestamps and handles concurrent retries exactly once", async () => {
    const punch = body("staff", "IN", clock("09"));
    const [a, b] = await Promise.all([
      call(f, "time/check-in", "POST", "staff", punch),
      call(f, "time/check-in", "POST", "staff", punch),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(a.body.data.checkIn).toBe(clock("09"));
    expect(a.body.data.source).toBe("Offline Web");
    const out = await call(
      f,
      "time/check-out",
      "POST",
      "staff",
      body("staff", "OUT", clock("18")),
    );
    expect(out.status).toBe(200);
    expect(out.body.data.checkOut).toBe(clock("18"));
    expect(
      await db.attendancePunch.count({
        where: { companyId, employeeId: f.employees.staff },
      }),
    ).toBe(2);
    expect(
      (await call(f, "time/check-in", "POST", "staff", punch)).status,
    ).toBe(200);
    expect(
      (
        await call(f, "time/check-in", "POST", "staff", {
          ...punch,
          offline: { ...punch.offline, capturedAt: clock("10") },
        })
      ).status,
    ).toBe(409);
  });
  it("rejects another employee, tenant, device, future time and out-of-order punch", async () => {
    const punch = body("staff", "IN", clock("09"));
    expect((await call(f, "time/check-in", "POST", "peer", punch)).status).toBe(
      422,
    );
    expect(
      (await call(f, "time/check-in", "POST", "other", punch)).status,
    ).toBe(422);
    expect(
      (
        await call(f, "time/check-in", "POST", "staff", {
          ...punch,
          deviceId: randomUUID(),
        })
      ).status,
    ).toBe(422);
    const future = body(
      "peer",
      "IN",
      new Date(Date.now() + 3600000).toISOString(),
    );
    expect(
      (await call(f, "time/check-in", "POST", "peer", future)).status,
    ).toBe(422);
    expect(
      (await call(f, "time/check-in", "POST", "staff", punch)).status,
    ).toBe(409);
  });
  it("does not bypass GPS or required face verification", async () => {
    await db.employee.update({
      where: { id: f.employees.gps },
      data: { attendanceMode: "GPS" },
    });
    await db.attendancePolicy.update({
      where: { companyId },
      data: { gpsTrackingEnabled: true },
    });
    expect(
      (
        await call(
          f,
          "time/check-in",
          "POST",
          "gps",
          body("gps", "IN", clock("09")),
        )
      ).status,
    ).toBe(422);
    await db.attendancePolicy.update({
      where: { companyId },
      data: { gpsTrackingEnabled: false, faceFallback: "NONE" },
    });
    await db.employee.update({
      where: { id: f.employees.face },
      data: { faceRequired: true },
    });
    expect(
      (
        await call(
          f,
          "time/check-in",
          "POST",
          "face",
          body("face", "IN", clock("09")),
        )
      ).status,
    ).toBe(428);
    expect(
      await db.attendance.count({
        where: {
          companyId,
          employeeId: { in: [f.employees.gps, f.employees.face] },
        },
      }),
    ).toBe(0);
  });
  it("retains payroll locks for delayed punches", async () => {
    await db.payrollRun.create({
      data: {
        companyId,
        period: yesterday.slice(0, 7),
        status: "PROCESSED",
        createdBy: f.users.staff,
      },
    });
    const r = await call(
      f,
      "time/check-in",
      "POST",
      "locked",
      body("locked", "IN", clock("09")),
    );
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/locked/);
  });
});
