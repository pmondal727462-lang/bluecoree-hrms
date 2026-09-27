import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { provisionCompany } from "../../src/modules/auth/service";
import { GET, POST, PUT, DELETE } from "../../src/app/api/[...path]/route";
import { deleteAttendance } from "./cleanup";
import { testClientIp } from "./client";
import { addDays, dayDate, localDay } from "../../src/modules/time/rules";
const prefix = `TIME-${randomBytes(4).toString("hex").toUpperCase()}`;
const password = "Phase2-Integration-Password-123!";
const companies: string[] = [],
  userIds: string[] = [];
let admin = "",
  staff = "",
  other = "",
  employeeId = "",
  otherId = "",
  shiftId = "",
  typeId = "",
  holidayId = "",
  leaveId = "",
  attendanceId = "";
let leaveStart = `${new Date().getUTCFullYear() + 1}-01-04`;
while (dayDate(leaveStart).getUTCDay() !== 1)
  leaveStart = addDays(leaveStart, 1);
async function call(
  path: string,
  method = "GET",
  cookie = admin,
  body?: unknown,
) {
  const req = new NextRequest(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      "x-forwarded-for": testClientIp,
      origin: process.env.APP_URL || "http://localhost:3000",
      "content-type": "application/json",
      cookie,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await { GET, POST, PUT, DELETE }[
    method as "GET" | "POST" | "PUT" | "DELETE"
  ](req, { params: Promise.resolve({ path: path.split("?")[0].split("/") }) });
  return {
    status: result.status,
    body: await result.json(),
    cookie: result.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
}
beforeAll(async () => {
  const hash = await bcrypt.hash(password, 12);
  for (const suffix of ["A", "B"]) {
    const c = await db.$transaction(
      (tx) =>
        provisionCompany(tx, {
          code: prefix + suffix,
          name: "Phase 2 test " + suffix,
          email: "test@time.example",
          timezone: "UTC",
          workingDays: [1, 2, 3, 4, 5],
        }),
      { timeout: 20000 },
    );
    companies.push(c.id);
    for (const roleName of suffix === "A"
      ? ["Company Admin", "Employee"]
      : ["Company Admin"]) {
      const role = await db.role.findUniqueOrThrow({
        where: { companyId_name: { companyId: c.id, name: roleName } },
      });
      const user = await db.user.create({
        data: {
          companyId: c.id,
          roleId: role.id,
          name: roleName,
          email:
            roleName === "Employee"
              ? "employee@time.example"
              : "admin@time.example",
          passwordHash: hash,
        },
      });
      userIds.push(user.id);
      const e = await db.employee.create({
        data: {
          companyId: c.id,
          userId: user.id,
          firstName: roleName,
          lastName: suffix,
          employeeCode: roleName === "Employee" ? "STAFF" : "ADMIN",
          officialEmail: user.email,
          joinedAt: new Date("2020-01-01"),
        },
      });
      const login = await call("auth/login", "POST", "", {
        companyCode: c.code,
        identifier: user.email,
        password,
      });
      expect(login.status).toBe(200);
      if (suffix === "B") {
        other = login.cookie;
        otherId = e.id;
      } else if (roleName === "Employee") {
        staff = login.cookie;
        employeeId = e.id;
      } else admin = login.cookie;
    }
  }
});
afterAll(async () => {
  if (companies.length)
    await db.$transaction(async (tx) => {
      const where = { companyId: { in: companies } };
      await tx.attendanceRegularization.deleteMany({ where });
      await tx.leaveRequest.deleteMany({ where });
      await tx.leaveType.deleteMany({ where });
      await tx.holiday.deleteMany({ where });
      await deleteAttendance(tx, where);
      await tx.employee.deleteMany({ where });
      await tx.shift.deleteMany({ where });
      await tx.attendancePolicy.deleteMany({ where });
      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.loginHistory.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.rolePermission.deleteMany({ where: { role: where } });
      await tx.role.deleteMany({ where });
      await tx.department.deleteMany({ where });
      await tx.designation.deleteMany({ where });
      await tx.branch.deleteMany({ where });
      await tx.auditLog.deleteMany({ where });
      await tx.company.deleteMany({ where: { id: { in: companies } } });
    });
  await db.$disconnect();
});
describe("Phase 2 attendance and leave", () => {
  it("requires authentication and restricts company attendance/configuration", async () => {
    expect((await call("time/summary", "GET", "")).status).toBe(401);
    expect(
      (await call("time/attendance?scope=company", "GET", staff)).status,
    ).toBe(403);
    expect(
      (
        await call("time/policy", "PUT", staff, {
          geofenceEnabled: false,
          latitude: null,
          longitude: null,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(403);
  });
  it("creates a shift, assigns it and rejects foreign-tenant assignments", async () => {
    const result = await call("time/shifts", "POST", admin, {
      name: "Day",
      startMinute: 540,
      endMinute: 1080,
      graceMinutes: 10,
      breakMinutes: 60,
    });
    expect(result.status).toBe(200);
    shiftId = result.body.data.id;
    expect(
      (await call("time/assign-shift", "PUT", admin, { employeeId, shiftId }))
        .status,
    ).toBe(200);
    expect(
      (
        await call("time/assign-shift", "PUT", other, {
          employeeId: otherId,
          shiftId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("time/assign-shift", "PUT", admin, {
          employeeId: otherId,
          shiftId,
        })
      ).status,
    ).toBe(404);
  });
  it("enforces GPS area and accuracy before accepting attendance", async () => {
    expect(
      (
        await call("time/policy", "PUT", admin, {
          geofenceEnabled: true,
          latitude: 12,
          longitude: 77,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(200);
    expect((await call("time/check-in", "POST", staff, {})).status).toBe(422);
    expect(
      (
        await call("time/check-in", "POST", staff, {
          location: { latitude: 0, longitude: 0, accuracy: 10 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("time/check-in", "POST", staff, {
          location: { latitude: 12, longitude: 77, accuracy: 300 },
        })
      ).status,
    ).toBe(422);
  });
  it("records GPS without a geofence, requires permission and isolates saved locations", async () => {
    const policy = {
      gpsTrackingEnabled: true,
      geofenceEnabled: false,
      latitude: null,
      longitude: null,
      radiusMeters: 200,
    };
    expect((await call("time/policy", "PUT", staff, policy)).status).toBe(403);
    expect((await call("time/policy", "PUT", admin, policy)).status).toBe(200);
    expect(
      (await call("time/summary", "GET", staff)).body.data.employeePolicy
        .gpsTrackingEnabled,
    ).toBe(true);
    expect((await call("time/check-in", "POST", staff, {})).status).toBe(422);
    const location = { latitude: 19.076, longitude: 72.8777, accuracy: 15 };
    expect(
      (
        await call("time/check-in", "POST", staff, {
          location: { ...location, latitude: 91 },
        })
      ).status,
    ).toBe(422);
    const started = await call("time/check-in", "POST", staff, { location });
    expect(started.status).toBe(200);
    expect(started.body.data.checkInLocation).toMatchObject(location);
    expect(started.body.data.checkInLocation.recordedAt).toBeTruthy();
    expect((await call("time/check-out", "POST", staff, {})).status).toBe(422);
    const finished = await call("time/check-out", "POST", staff, {
      location: { ...location, latitude: 19.077 },
    });
    expect(finished.status).toBe(200);
    expect(finished.body.data.checkOutLocation.latitude).toBe(19.077);
    expect(
      (await call("time/attendance?scope=own", "GET", staff)).body.data.items[0]
        .checkInLocation,
    ).toMatchObject(location);
    expect(
      (await call("time/attendance?scope=company", "GET", admin)).body.data
        .items[0].checkOutLocation.latitude,
    ).toBe(19.077);
    expect(
      (await call("time/attendance?scope=company", "GET", other)).body.data
        .total,
    ).toBe(0);
    expect(
      (await call("time/attendance?scope=own", "GET", admin)).body.data.total,
    ).toBe(0);
    // Older policy clients must not accidentally disable GPS tracking.
    expect(
      (
        await call("time/policy", "PUT", admin, {
          geofenceEnabled: false,
          latitude: null,
          longitude: null,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("time/summary", "GET", staff)).body.data.policy
        .gpsTrackingEnabled,
    ).toBe(true);
    await deleteAttendance(db, { id: started.body.data.id });
    expect(
      (
        await call("time/policy", "PUT", admin, {
          ...policy,
          gpsTrackingEnabled: false,
        })
      ).status,
    ).toBe(200);
    const disabled = await call("time/check-in", "POST", staff, { location });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.checkInLocation).toBeNull();
    await deleteAttendance(db, { id: disabled.body.data.id });
    expect(
      (
        await call("time/policy", "PUT", admin, {
          gpsTrackingEnabled: false,
          geofenceEnabled: true,
          latitude: 12,
          longitude: 77,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(200);
  });
  it("uses assigned location areas and isolates location filters by company", async () => {
    const location = {
      name: "North office",
      address: "North road",
      geofenceEnabled: true,
      latitude: 13,
      longitude: 78,
      radiusMeters: 100,
    };
    expect((await call("branches", "POST", staff, location)).status).toBe(403);
    expect(
      (await call("branches", "POST", admin, { ...location, latitude: null }))
        .status,
    ).toBe(422);
    const created = await call("branches", "POST", admin, location);
    expect(created.status).toBe(200);
    const branchId = created.body.data.id;
    const second = await call("branches", "POST", admin, {
      name: "South office",
    });
    expect(second.status).toBe(200);
    expect(
      (await call(`branches/${branchId}`, "PUT", other, location)).status,
    ).toBe(404);
    expect(
      (await call(`employees/${otherId}`, "PUT", other, { branchId })).status,
    ).toBe(422);
    expect(
      (await call(`employees/${employeeId}`, "PUT", admin, { branchId }))
        .status,
    ).toBe(200);
    const summary = await call("time/summary", "GET", staff);
    expect(summary.body.data.employeePolicy.latitude).toBe(13);
    expect(summary.body.data.policy.latitude).toBe(12);
    expect(
      (
        await call("time/check-in", "POST", staff, {
          location: { latitude: 12, longitude: 77, accuracy: 10 },
        })
      ).status,
    ).toBe(403);
    expect((await call("time/check-in", "POST", staff, {})).status).toBe(422);
    expect(
      (
        await call("time/check-in", "POST", staff, {
          location: { latitude: 13, longitude: 78, accuracy: 101 },
        })
      ).status,
    ).toBe(422);
    const punch = await call("time/check-in", "POST", staff, {
      location: { latitude: 13, longitude: 78, accuracy: 10 },
    });
    expect(punch.status).toBe(200);
    expect(punch.body.data.checkInLocation).toMatchObject({
      locationName: "North office",
      distanceMeters: 0,
      radiusMeters: 100,
    });
    expect(
      (await call(`time/attendance?scope=company&branchId=${branchId}`)).body
        .data.total,
    ).toBe(1);
    expect(
      (
        await call(
          `time/attendance?scope=company&branchId=${second.body.data.id}`,
        )
      ).body.data.total,
    ).toBe(0);
    expect(
      (await call(`time/roster?branchId=${branchId}`)).body.data.total,
    ).toBe(1);
    expect(
      (await call(`time/roster?branchId=${branchId}`, "GET", other)).body.data
        .total,
    ).toBe(0);
    expect(
      (
        await call("time/check-out", "POST", staff, {
          location: { latitude: 12, longitude: 77, accuracy: 10 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("time/check-out", "POST", staff, {
          location: { latitude: 13, longitude: 78, accuracy: 10 },
        })
      ).status,
    ).toBe(200);
    await deleteAttendance(db, { id: punch.body.data.id });
    expect(
      (await call(`employees/${employeeId}`, "PUT", admin, { branchId: null }))
        .status,
    ).toBe(200);
    expect(
      (await call("time/summary", "GET", staff)).body.data.employeePolicy
        .latitude,
    ).toBe(12);
  });
  it("serializes simultaneous punches and does not accept client timestamps", async () => {
    expect(
      (
        await call("time/check-in", "POST", staff, {
          checkIn: "2026-01-01T00:00:00Z",
        })
      ).status,
    ).toBe(422);
    const body = { location: { latitude: 12, longitude: 77, accuracy: 10 } };
    const results = await Promise.all([
      call("time/check-in", "POST", staff, body),
      call("time/check-in", "POST", staff, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    attendanceId = results.find((r) => r.status === 200)!.body.data.id;
    expect((await call("time/check-out", "POST", staff, body)).status).toBe(
      200,
    );
    expect((await call("time/check-out", "POST", staff, body)).status).toBe(
      409,
    );
    expect((await call("time/check-in", "POST", staff, body)).status).toBe(409);
  });
  it("tracks checked-in field employees only with explicit consent and tenant scope", async () => {
    expect(
      (
        await call("time/policy", "PUT", admin, {
          gpsTrackingEnabled: false,
          geofenceEnabled: true,
          latitude: 12,
          longitude: 77,
          radiusMeters: 200,
          fieldTrackingEnabled: true,
          fieldTrackingIntervalSeconds: 15,
          fieldTrackingMaxMinutes: 60,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`employees/${employeeId}`, "PUT", admin, {
          fieldTrackingAllowed: true,
        })
      ).status,
    ).toBe(200);
    const device = "field-device-test-123";
    expect(
      (
        await call("time/field-tracking", "POST", staff, {
          deviceId: device,
          consent: true,
        })
      ).status,
    ).toBe(409);
    await db.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
      },
    });
    const started = await call("time/field-tracking", "POST", staff, {
      deviceId: device,
      consent: true,
    });
    expect(started.status).toBe(200);
    const point = await call("time/field-tracking/location", "POST", staff, {
      sessionId: started.body.data.id,
      deviceId: device,
      location: { latitude: 12.001, longitude: 77.001, accuracy: 12 },
    });
    expect(point.status).toBe(200);
    expect(
      (
        await call("time/field-tracking/location", "POST", staff, {
          sessionId: started.body.data.id,
          deviceId: device,
          location: { latitude: 12.001, longitude: 77.001, accuracy: 12 },
        })
      ).status,
    ).toBe(429);
    expect(
      (await call("time/field-tracking", "GET", staff)).body.data[0].points
        .length,
    ).toBe(1);
    expect(
      (await call("time/field-tracking", "GET", admin)).body.data[0].employee
        .id,
    ).toBe(employeeId);
    expect((await call("time/field-tracking", "GET", other)).body.data).toEqual(
      [],
    );
    expect(
      (
        await call(
          `time/field-tracking/${started.body.data.id}`,
          "DELETE",
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call("time/check-out", "POST", staff, {
          location: { latitude: 12, longitude: 77, accuracy: 10 },
        })
      ).status,
    ).toBe(200);
  });
  it("isolates employee history and company reports", async () => {
    const own = await call(
      `time/attendance?scope=own&employeeId=${otherId}`,
      "GET",
      staff,
    );
    expect(own.status).toBe(200);
    expect(own.body.data.total).toBe(1);
    expect(own.body.data.items[0].employeeId).toBe(employeeId);
    expect(
      (await call("time/attendance?scope=company", "GET", other)).body.data
        .total,
    ).toBe(0);
    const roster = await call("time/roster");
    expect(roster.status).toBe(200);
    expect(
      roster.body.data.items.find((e: { id: string }) => e.id === employeeId)
        .status,
    ).toBe("Present");
  });
  it("corrects hours with a required audit reason and rejects tenant injection", async () => {
    const today = localDay(new Date(), "UTC");
    // The latest weekday before today, so the day is a working day.
    let yesterday = addDays(today, -1);
    while ([0, 6].includes(new Date(`${yesterday}T00:00:00Z`).getUTCDay()))
      yesterday = addDays(yesterday, -1);
    const b = {
      employeeId,
      checkIn: `${yesterday}T09:00:00Z`,
      checkOut: `${yesterday}T19:00:00Z`,
      reason: "Forgot checkout; manager verified",
    };
    expect(
      (await call(`time/attendance/${attendanceId}`, "PUT", staff, b)).status,
    ).toBe(403);
    expect(
      (await call(`time/attendance/${attendanceId}`, "PUT", other, b)).status,
    ).toBe(404);
    const result = await call(
      `time/attendance/${attendanceId}`,
      "PUT",
      admin,
      b,
    );
    expect(result.status).toBe(200);
    expect(result.body.data.workedMinutes).toBe(540);
    expect(result.body.data.overtimeMinutes).toBe(60);
    expect(
      await db.auditLog.count({
        where: {
          companyId: companies[0],
          module: "attendance",
          action: "CORRECT",
        },
      }),
    ).toBe(1);
  });
  it("imports device CSV atomically and rejects duplicates", async () => {
    const day = addDays(localDay(new Date(), "UTC"), -3);
    const row = `STAFF,${day}T09:00:00Z,${day}T18:00:00Z`;
    const bad = await call("time/import", "POST", admin, {
      csv: `employeeCode,checkIn,checkOut\n${row}\nUNKNOWN,${day}T09:00:00Z,${day}T18:00:00Z`,
      reason: "Device export test",
    });
    expect(bad.status).toBe(422);
    expect(
      await db.attendance.count({
        where: { companyId: companies[0], workDate: dayDate(day) },
      }),
    ).toBe(0);
    const good = {
      csv: `employeeCode,checkIn,checkOut\n${row}`,
      reason: "Device export test",
    };
    expect(
      (await call("time/import", "POST", admin, good)).body.data.imported,
    ).toBe(1);
    expect((await call("time/import", "POST", admin, good)).status).toBe(409);
  });
  it("configures holidays and leave types and rejects employee administration", async () => {
    expect(
      (
        await call("time/leave-types", "POST", staff, {
          name: "Annual",
          annualDays: 10,
          paid: true,
        })
      ).status,
    ).toBe(403);
    const type = await call("time/leave-types", "POST", admin, {
      name: "Annual",
      annualDays: 10,
      paid: true,
    });
    expect(type.status).toBe(200);
    typeId = type.body.data.id;
    const holiday = await call("time/holidays", "POST", admin, {
      name: "Company day",
      date: addDays(leaveStart, 1),
    });
    expect(holiday.status).toBe(200);
    holidayId = holiday.body.data.id;
  });
  it("reserves working-day leave balances excluding holidays and weekends", async () => {
    const result = await call("time/leave", "POST", staff, {
      leaveTypeId: typeId,
      startDate: leaveStart,
      endDate: addDays(leaveStart, 6),
      reason: "Family holiday",
    });
    expect(result.status).toBe(200);
    expect(result.body.data.days).toBe(4);
    leaveId = result.body.data.id;
    const balance = await call(
      `time/balances?year=${leaveStart.slice(0, 4)}`,
      "GET",
      staff,
    );
    expect(balance.body.data[0].remaining).toBe(6);
    expect(balance.body.data[0].pending).toBe(4);
    expect(
      (
        await call("time/leave", "POST", staff, {
          leaveTypeId: typeId,
          startDate: leaveStart,
          endDate: leaveStart,
          reason: "Overlapping leave",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("time/leave", "POST", staff, {
          leaveTypeId: typeId,
          startDate: addDays(leaveStart, 7),
          endDate: addDays(leaveStart, 20),
          reason: "Excess allowance",
        })
      ).status,
    ).toBe(409);
  });
  it("rejects foreign-tenant leave types and decisions; approvals require a reviewer", async () => {
    expect(
      (
        await call("time/leave", "POST", other, {
          leaveTypeId: typeId,
          startDate: leaveStart,
          endDate: leaveStart,
          reason: "Wrong tenant",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`time/leave/${leaveId}`, "PUT", other, {
          status: "Approved",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`time/leave/${leaveId}`, "PUT", staff, {
          status: "Approved",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`time/leave/${leaveId}`, "PUT", admin, {
          status: "Approved",
          note: "Approved by HR",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`time/leave/${leaveId}`, "PUT", admin, {
          status: "Rejected",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("time/leave?scope=company", "GET", other)).body.data.total,
    ).toBe(0);
  });
  it("protects allowances and holiday dates used by requests, then releases cancelled balance", async () => {
    expect(
      (
        await call(`time/leave-types/${typeId}`, "PUT", admin, {
          name: "Annual",
          annualDays: 1,
          paid: true,
        })
      ).status,
    ).toBe(409);
    expect((await call(`time/holidays/${holidayId}`, "DELETE")).status).toBe(
      409,
    );
    expect(
      (
        await call(`time/leave/${leaveId}`, "PUT", staff, {
          status: "Cancelled",
          note: "Plans changed",
        })
      ).status,
    ).toBe(200);
    const balance = await call(
      `time/balances?year=${leaveStart.slice(0, 4)}`,
      "GET",
      staff,
    );
    expect(balance.body.data[0].remaining).toBe(10);
    expect((await call(`time/holidays/${holidayId}`, "DELETE")).status).toBe(
      200,
    );
  });
  it("prevents administrators from approving their own requests", async () => {
    const result = await call("time/leave", "POST", admin, {
      leaveTypeId: typeId,
      startDate: leaveStart,
      endDate: leaveStart,
      reason: "Admin personal leave",
    });
    expect(result.status).toBe(200);
    expect(
      (
        await call(`time/leave/${result.body.data.id}`, "PUT", admin, {
          status: "Approved",
        })
      ).status,
    ).toBe(403);
  });
  it("serializes concurrent leave reservations against the annual allowance", async () => {
    const type = await call("time/leave-types", "POST", admin, {
      name: "One day",
      annualDays: 1,
      paid: true,
    });
    const results = await Promise.all(
      [21, 22].map((offset) =>
        call("time/leave", "POST", staff, {
          leaveTypeId: type.body.data.id,
          startDate: addDays(leaveStart, offset),
          endDate: addDays(leaveStart, offset),
          reason: "Concurrent balance reservation",
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("keeps company calendar settings consistent with existing records", async () => {
    const result = await call("company");
    const { id, createdAt, updatedAt, ...company } = result.body.data;
    expect(
      (
        await call("company", "PUT", admin, {
          ...company,
          timezone: "Asia/Kolkata",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("company", "PUT", admin, {
          ...company,
          workingDays: [1, 2, 3, 4],
        })
      ).status,
    ).toBe(409);
  });
  it("enforces composite foreign keys on attendance tenant relationships", async () => {
    await expect(
      db.attendance.create({
        data: {
          companyId: companies[0],
          employeeId: otherId,
          workDate: dayDate("2021-01-01"),
          checkIn: new Date("2021-01-01T09:00:00Z"),
          checkOut: new Date("2021-01-01T17:00:00Z"),
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
  it("rejects future or reversed attendance intervals", async () => {
    const future = addDays(localDay(new Date(), "UTC"), 2);
    expect(
      (
        await call("time/attendance", "POST", admin, {
          employeeId,
          checkIn: `${future}T09:00:00Z`,
          checkOut: `${future}T17:00:00Z`,
          reason: "Invalid future record",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("time/attendance", "POST", admin, {
          employeeId,
          checkIn: "2021-01-01T17:00:00Z",
          checkOut: "2021-01-01T09:00:00Z",
          reason: "Invalid reversed record",
        })
      ).status,
    ).toBe(422);
  });
  it("requires enrollment and verified daily punches without replacing the first check-in", async () => {
    const faceSample = "data:image/jpeg;base64,dGVzdA==";
    // Each scan is a new frame; re-sending one is rejected as a replay.
    let scan = 0;
    const freshSample = () =>
      `data:image/jpeg;base64,${Buffer.from(`scan-${++scan}-${prefix}`).toString("base64").replace(/=+$/, "")}`;
    vi.stubEnv("FACE_PROVIDER_URL", "https://face.example");
    vi.stubEnv("FACE_PROVIDER_KEY", "test-key");
    let accepted = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const input = JSON.parse(init.body);
        return Response.json({
          requestId: input.requestId,
          template: "protected-template",
          confidence: 0.99,
          livenessPassed: accepted,
          status: accepted ? "SUCCESS" : "FAILED",
        });
      }),
    );
    try {
      await db.employee.update({
        where: { id: employeeId },
        data: { faceRequired: true, attendanceMode: "OPEN" },
      });
      expect((await call("time/summary", "GET", staff)).status).toBe(428);
      expect(
        (await call("face/status", "GET", staff)).body.data.enrollmentRequired,
      ).toBe(true);
      accepted = false;
      expect(
        (
          await call("face/enroll", "POST", staff, {
            faceSample,
            consent: true,
          })
        ).status,
      ).toBe(422);
      expect(await db.faceProfile.count({ where: { employeeId } })).toBe(0);
      accepted = true;
      expect(
        (
          await call("face/enroll", "POST", staff, {
            faceSample,
            consent: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call("face/enroll", "POST", staff, {
            faceSample,
            consent: true,
          })
        ).status,
      ).toBe(409);
      expect((await call("time/summary", "GET", staff)).status).toBe(200);
      expect((await call("time/check-in", "POST", staff, {})).status).toBe(422);
      await deleteAttendance(db, { employeeId });
      accepted = false;
      expect(
        (
          await call("time/face-punch", "POST", staff, {
            faceSample: freshSample(),
          })
        ).status,
      ).toBe(403);
      expect(await db.attendance.count({ where: { employeeId } })).toBe(0);
      accepted = true;
      const first = await call("time/face-punch", "POST", staff, {
        faceSample: freshSample(),
      });
      expect(first.status).toBe(200);
      expect(first.body.data.checkOut).toBeNull();
      expect(first.body.data.source).toBe("Face");
      const id = first.body.data.id;
      const start = new Date(Date.now() - 180000);
      await db.attendance.update({ where: { id }, data: { checkIn: start } });
      const second = await call("time/face-punch", "POST", staff, {
        faceSample: freshSample(),
      });
      expect(second.status).toBe(200);
      expect(second.body.data.checkIn).toBe(start.toISOString());
      expect(second.body.data.checkOut).toBeTruthy();
      expect(
        (
          await call("time/face-punch", "POST", staff, {
            faceSample: freshSample(),
          })
        ).status,
      ).toBe(409);
      await db.attendance.update({
        where: { id },
        data: { checkOut: new Date(Date.now() - 120000) },
      });
      const last = await call("time/face-punch", "POST", staff, {
        faceSample: freshSample(),
      });
      expect(last.status).toBe(200);
      expect(last.body.data.checkIn).toBe(start.toISOString());
      expect(
        new Date(last.body.data.checkOut).getTime(),
      ).toBeGreaterThanOrEqual(new Date(second.body.data.checkOut).getTime());
      vi.stubEnv("FACE_PROVIDER_KEY", "");
      expect(
        (
          await call("time/face-punch", "POST", staff, {
            faceSample: freshSample(),
          })
        ).status,
      ).toBe(503);
      expect(
        (
          await db.attendance.findUniqueOrThrow({ where: { id } })
        ).checkOut?.toISOString(),
      ).toBe(last.body.data.checkOut);
      expect(
        await db.faceVerificationLog.count({
          where: { employeeId, status: "FAILED" },
        }),
      ).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await db.employee.update({
        where: { id: employeeId },
        data: { faceRequired: false },
      });
    }
  });
  it("syncs attendance only after HR approves a missed punch justification", async () => {
    const today = localDay(new Date(), "UTC"),
      missed = addDays(today, -3),
      open = addDays(today, -4),
      cancelled = addDays(today, -5);
    await deleteAttendance(db, {
      employeeId,
      workDate: { in: [missed, open, cancelled].map(dayDate) },
    });
    const reason = "Biometric device was offline at the gate";
    expect(
      (
        await call("time/regularizations", "POST", staff, {
          workDate: missed,
          checkOut: "18:30",
          reason,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("time/regularizations", "POST", staff, {
          workDate: addDays(today, 1),
          checkIn: "09:00",
          checkOut: "18:00",
          reason,
        })
      ).status,
    ).toBe(422);
    const request = await call("time/regularizations", "POST", staff, {
      workDate: missed,
      checkIn: "09:05",
      checkOut: "18:30",
      reason,
    });
    expect(request.status).toBe(200);
    expect(request.body.data.status).toBe("Pending");
    expect(request.body.data.checkIn).toBe(`${missed}T09:05:00.000Z`);
    expect(request.body.data.checkOut).toBe(`${missed}T18:30:00.000Z`);
    const id = request.body.data.id;
    expect(
      (
        await call("time/regularizations", "POST", staff, {
          workDate: missed,
          checkIn: "09:00",
          checkOut: "18:00",
          reason,
        })
      ).status,
    ).toBe(409);
    expect(
      await db.attendance.count({
        where: { employeeId, workDate: dayDate(missed) },
      }),
    ).toBe(0);
    expect(
      (await call("time/regularizations?scope=company", "GET", staff)).status,
    ).toBe(403);
    const mine = await call("time/regularizations", "GET", staff);
    expect(mine.body.data.items.map((r: { id: string }) => r.id)).toContain(id);
    expect(
      (
        await call("time/regularizations?scope=company", "GET", other)
      ).body.data.items.some((r: { id: string }) => r.id === id),
    ).toBe(false);
    expect(
      (
        await call(`time/regularizations/${id}`, "PUT", other, {
          status: "Approved",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`time/regularizations/${id}`, "PUT", staff, {
          status: "Approved",
        })
      ).status,
    ).toBe(403);
    const approved = await call(`time/regularizations/${id}`, "PUT", admin, {
      status: "Approved",
      note: "Verified with security log",
    });
    expect(approved.status).toBe(200);
    const synced = await db.attendance.findFirstOrThrow({
      where: { employeeId, workDate: dayDate(missed) },
    });
    expect(approved.body.data.attendanceId).toBe(synced.id);
    expect(synced.source).toBe("Regularization");
    expect(synced.checkIn.toISOString()).toBe(`${missed}T09:05:00.000Z`);
    expect(synced.workedMinutes).toBe(505);
    expect(synced.correctionReason).toContain(reason);
    expect(
      (
        await call(`time/regularizations/${id}`, "PUT", admin, {
          status: "Approved",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("time/regularizations", "POST", staff, {
          workDate: missed,
          checkIn: "09:00",
          checkOut: "18:00",
          reason,
        })
      ).status,
    ).toBe(409);

    const location = { latitude: 12, longitude: 77, accuracy: 10 };
    const openRecord = await db.attendance.create({
      data: {
        companyId: companies[0],
        employeeId,
        workDate: dayDate(open),
        checkIn: new Date(`${open}T09:00:00Z`),
        checkInLocation: location,
      },
    });
    const checkout = await call("time/regularizations", "POST", staff, {
      workDate: open,
      checkIn: "06:00",
      checkOut: "17:00",
      reason: "Forgot to check out after the client meeting",
    });
    expect(checkout.status).toBe(200);
    expect(checkout.body.data.checkIn).toBe(`${open}T09:00:00.000Z`);
    expect(
      (
        await call(
          `time/regularizations/${checkout.body.data.id}`,
          "PUT",
          admin,
          {
            status: "Approved",
          },
        )
      ).status,
    ).toBe(200);
    const closed = await db.attendance.findUniqueOrThrow({
      where: { id: openRecord.id },
    });
    expect(closed.checkOut?.toISOString()).toBe(`${open}T17:00:00.000Z`);
    expect(closed.checkInLocation).toEqual(location);

    const withdrawn = await call("time/regularizations", "POST", staff, {
      workDate: cancelled,
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Submitted for the wrong date",
    });
    const withdrawnId = withdrawn.body.data.id;
    expect(
      (
        await call(`time/regularizations/${withdrawnId}`, "PUT", staff, {
          status: "Cancelled",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`time/regularizations/${withdrawnId}`, "PUT", admin, {
          status: "Approved",
        })
      ).status,
    ).toBe(409);
    expect(
      await db.attendance.count({
        where: { employeeId, workDate: dayDate(cancelled) },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          companyId: companies[0],
          module: "attendance_regularization",
        },
      }),
    ).toBe(6);
  });
  it("marks rejected missed punches absent, notifies HR and the employee, and never blocks later days", async () => {
    const today = localDay(new Date(), "UTC"),
      openDay = addDays(today, -6),
      nightDay = addDays(today, -7);
    await deleteAttendance(db, {
      employeeId,
      // Earlier tests assign a shift, so today's scan may belong to yesterday.
      workDate: {
        in: [today, addDays(today, -1), openDay, nightDay].map(dayDate),
      },
    });
    // Only the forgotten check-out below is left open.
    await db.attendance.updateMany({
      where: { employeeId, checkOut: null },
      data: { checkOut: new Date() },
    });
    expect(
      (
        await call("time/policy", "PUT", admin, {
          gpsTrackingEnabled: false,
          geofenceEnabled: false,
          latitude: null,
          longitude: null,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(200);
    const openRecord = await db.attendance.create({
      data: {
        companyId: companies[0],
        employeeId,
        workDate: dayDate(openDay),
        checkIn: new Date(`${openDay}T09:00:00Z`),
      },
    });
    expect((await call("time/check-in", "POST", staff, {})).status).toBe(409);
    const request = await call("time/regularizations", "POST", staff, {
      workDate: openDay,
      checkOut: "18:00",
      reason: "Forgot to check out at the gate",
    });
    expect(request.status).toBe(200);
    const hrNotice = await db.notification.findFirst({
      where: {
        companyId: companies[0],
        event: "attendance.regularization_submitted",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(hrNotice?.body).toContain(openDay);
    expect(hrNotice?.body).toContain("18:00");
    // The pending request no longer blocks today.
    const todayIn = await call("time/check-in", "POST", staff, {});
    expect(todayIn.status).toBe(200);
    expect(todayIn.body.data.workDate.slice(0, 10)).not.toBe(openDay);
    // The forgotten day waits for HR with no hours instead of staying open.
    expect(
      await db.attendance.findUniqueOrThrow({ where: { id: openRecord.id } }),
    ).toMatchObject({ status: "PENDING_REVIEW", workedMinutes: 0 });
    expect(
      (
        await call(`time/roster?date=${openDay}`, "GET", admin)
      ).body.data.items.find((e: { id: string }) => e.id === employeeId)
        ?.status,
    ).toBe("Awaiting HR review");

    const rejected = await call(
      `time/regularizations/${request.body.data.id}`,
      "PUT",
      admin,
      { status: "Rejected", note: "No gate record for that evening" },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.attendanceId).toBe(openRecord.id);
    const absent = await db.attendance.findUniqueOrThrow({
      where: { id: openRecord.id },
    });
    expect(absent).toMatchObject({ status: "ABSENT", workedMinutes: 0 });
    expect(absent.checkOut!.getTime() - absent.checkIn.getTime()).toBe(1000);
    const roster = await call(`time/roster?date=${openDay}`, "GET", admin);
    expect(
      roster.body.data.items.find((e: { id: string }) => e.id === employeeId)
        ?.status,
    ).toBe("Absent");
    const staffUser = (
      await db.employee.findUniqueOrThrow({ where: { id: employeeId } })
    ).userId!;
    expect(
      await db.notification.count({
        where: {
          userId: staffUser,
          event: "attendance.regularization_rejected",
        },
      }),
    ).toBe(1);

    // HR manual attendance with local times; a night shift ends next day.
    const manual = await call("time/attendance", "POST", admin, {
      employeeId,
      workDate: nightDay,
      checkIn: "22:00",
      checkOut: "06:30",
      reason: "Night shift, gate device offline",
    });
    expect(manual.status).toBe(200);
    expect(manual.body.data).toMatchObject({
      source: "Manual",
      checkIn: `${nightDay}T22:00:00.000Z`,
      checkOut: `${addDays(nightDay, 1)}T06:30:00.000Z`,
    });
    const listed = await call(
      `time/attendance?scope=company&source=Manual&from=${nightDay}&to=${nightDay}`,
      "GET",
      admin,
    );
    expect(listed.body.data.items.map((a: { id: string }) => a.id)).toEqual([
      manual.body.data.id,
    ]);
    expect(
      (
        await call("time/attendance", "POST", staff, {
          employeeId,
          workDate: nightDay,
          checkIn: "09:00",
          checkOut: "18:00",
          reason: "Trying to add my own attendance",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("time/attendance", "POST", admin, {
          employeeId: otherId,
          workDate: nightDay,
          checkIn: "09:00",
          checkOut: "18:00",
          reason: "Cross-company attempt",
        })
      ).status,
    ).toBe(404);
  });
});
