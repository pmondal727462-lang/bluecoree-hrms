import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import {
  GET as admsGet,
  POST as admsPost,
} from "../../src/app/iclock/[...path]/route";
import { POST as apiPost } from "../../src/app/api/[...path]/route";
import { call, Fixture } from "./helpers";
import { testClientIp } from "./client";

const f = new Fixture();
let a = "",
  essl = "",
  serial = "";
beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("peer", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
  serial = `ESSL${f.prefix}`;
});
afterAll(async () => {
  await db.deviceSyncLog.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await db.devicePunch.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await db.attendanceDevice.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});

const adms = async (
  method: "GET" | "POST",
  action: string,
  query: Record<string, string>,
  body?: string,
) => {
  const req = new NextRequest(
    `http://localhost:3000/iclock/${action}?${new URLSearchParams(query)}`,
    {
      method,
      headers: {
        "x-forwarded-for": testClientIp,
        "content-type": "text/plain",
      },
      ...(body !== undefined ? { body } : {}),
    },
  );
  const res = await (method === "GET" ? admsGet : admsPost)(req, {
    params: Promise.resolve({ path: [action] }),
  });
  return { status: res.status, text: await res.text() };
};
const line = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0`;
const staffDay = (day: string) =>
  db.attendance.findFirst({
    where: {
      employeeId: f.employees.staff,
      workDate: new Date(`${day}T00:00:00Z`),
    },
  });

describe("Phase 4 biometric integration", () => {
  it("registers devices per company and keeps serials unique", async () => {
    const reg = await call(f, "biometric/devices", "POST", "admin", {
      name: "Gate terminal",
      vendor: "ESSL",
      serialNumber: serial,
    });
    expect(reg.status).toBe(200);
    expect(reg.body.data).toMatchObject({
      mode: "PUSH",
      status: "NEVER_CONNECTED",
    });
    expect(reg.body.data).not.toHaveProperty("secretEncrypted");
    essl = reg.body.data.id;
    expect(
      (
        await call(f, "biometric/devices", "POST", "staff", {
          name: "Mine",
          vendor: "ESSL",
          serialNumber: `X${serial}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(f, "biometric/devices", "POST", "other", {
          name: "Copy",
          vendor: "ESSL",
          serialNumber: serial,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(f, "biometric/devices", "GET", "other")).body.data,
    ).toEqual([]);
    expect(
      (await call(f, `biometric/devices/${essl}`, "GET", "other")).status,
    ).toBe(404);
  });

  it("accepts ADMS handshake and uploads, applying first and last punches", async () => {
    expect((await adms("GET", "cdata", { SN: "UNKNOWN123" })).status).toBe(401);
    const hello = await adms("GET", "cdata", { SN: serial, options: "all" });
    expect(hello.text).toContain(`GET OPTION FROM: ${serial}`);
    const upload = await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG", Stamp: "1" },
      [
        line("STAFF", "2026-09-14 09:05:00"),
        line("STAFF", "2026-09-14 13:00:00"),
        line("STAFF", "2026-09-14 18:10:00"),
        line("9999", "2026-09-14 09:30:00"),
        "garbage line",
      ].join("\n"),
    );
    expect(upload.text).toBe("OK: 5");
    const day = await staffDay("2026-09-14");
    expect(day).toMatchObject({ source: "Biometric", offDay: false });
    expect(day?.checkIn.toISOString()).toBe("2026-09-14T09:05:00.000Z");
    expect(day?.checkOut?.toISOString()).toBe("2026-09-14T18:10:00.000Z");
    expect(
      await db.attendancePunch.count({
        where: { attendanceId: day!.id, source: "Biometric" },
      }),
    ).toBe(3);
    const statuses = await db.devicePunch.groupBy({
      by: ["status"],
      where: { deviceId: essl },
      _count: { _all: true },
    });
    expect(
      Object.fromEntries(statuses.map((s) => [s.status, s._count._all])),
    ).toEqual({ PROCESSED: 3, UNMAPPED: 1 });
    // A re-upload is de-duplicated and changes nothing.
    await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG" },
      line("STAFF", "2026-09-14 09:05:00"),
    );
    const log = await call(f, `biometric/devices/${essl}/logs`, "GET", "admin");
    expect(log.body.data.items[0]).toMatchObject({
      duplicates: 1,
      inserted: 0,
    });
    // An earlier punch synced late moves the check-in.
    await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG" },
      line("STAFF", "2026-09-14 08:55:00"),
    );
    expect((await staffDay("2026-09-14"))?.checkIn.toISOString()).toBe(
      "2026-09-14T08:55:00.000Z",
    );
    const device = (await call(f, "biometric/devices", "GET", "admin")).body
      .data[0];
    expect(device.status).toBe("ONLINE");
    expect(device.waiting).toEqual({ UNMAPPED: 1 });
  });

  it("applies waiting punches when a device user ID is mapped", async () => {
    const unmapped = await call(f, "biometric/unmapped", "GET", "admin");
    expect(unmapped.body.data).toEqual([
      expect.objectContaining({ deviceUserId: "9999", punches: 1 }),
    ]);
    const saved = await call(f, "biometric/mappings", "PUT", "admin", {
      mappings: [{ deviceUserId: "9999", employeeId: f.employees.peer }],
    });
    expect(saved.body.data.processed).toBe(1);
    expect(
      await db.attendance.count({ where: { employeeId: f.employees.peer } }),
    ).toBe(1);
    expect(
      (
        await call(f, "biometric/mappings", "PUT", "other", {
          mappings: [{ deviceUserId: "1", employeeId: f.employees.peer }],
        })
      ).status,
    ).toBe(404);
  });

  it("closes a day left open as a missed punch and respects HR corrections", async () => {
    await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG" },
      line("STAFF", "2026-09-15 09:00:00"),
    );
    expect((await staffDay("2026-09-15"))?.checkOut).toBeNull();
    await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG" },
      line("STAFF", "2026-09-16 09:10:00"),
    );
    expect(await staffDay("2026-09-15")).toMatchObject({
      status: "MISSED_PUNCH",
      workedMinutes: 0,
    });
    // The employee can still justify the missing check-out.
    const request = await call(f, "time/regularizations", "POST", "staff", {
      workDate: "2026-09-15",
      checkOut: "18:00",
      reason: "Device was offline at exit",
    });
    expect(request.status).toBe(200);
    // Days set by HR are not changed by device punches.
    await call(f, "time/attendance", "POST", "admin", {
      employeeId: f.employees.peer,
      workDate: "2026-09-17",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Entered by HR",
    });
    await adms(
      "POST",
      "cdata",
      { SN: serial, table: "ATTLOG" },
      line("9999", "2026-09-17 20:00:00"),
    );
    const ignored = await db.devicePunch.findFirstOrThrow({
      where: { deviceId: essl, deviceUserId: "9999", status: "IGNORED" },
    });
    expect(ignored.reason).toContain("set by HR");
  });

  it("queues a resend command on manual sync for ADMS devices", async () => {
    expect(
      (await call(f, `biometric/devices/${essl}/sync`, "POST", "staff")).status,
    ).toBe(403);
    expect(
      (await call(f, `biometric/devices/${essl}/sync`, "POST", "admin")).status,
    ).toBe(200);
    expect((await adms("GET", "getrequest", { SN: serial })).text).toMatch(
      /^C:\d+:DATA QUERY ATTLOG StartTime=/,
    );
    expect((await adms("GET", "getrequest", { SN: serial })).text).toBe("OK");
  });

  it("accepts generic and Hikvision pushes with device tokens only", async () => {
    const generic = await call(f, "biometric/devices", "POST", "admin", {
      name: "Agent",
      vendor: "GENERIC",
      serialNumber: `AGENT${f.prefix}`,
    });
    const token = generic.body.data.pushToken as string;
    expect(token).toMatch(/^hrmsdev_/);
    const pushed = await call(
      f,
      "biometric/push",
      "POST",
      "",
      { punches: [{ deviceUserId: "PEER", punchedAt: "2026-09-18 09:00:00" }] },
      { authorization: `Bearer ${token}` },
    );
    expect(pushed.body.data).toMatchObject({ inserted: 1, processed: 1 });
    expect(
      (
        await call(
          f,
          "biometric/push",
          "POST",
          "",
          {
            punches: [
              { deviceUserId: "PEER", punchedAt: "2026-09-18 10:00:00" },
            ],
          },
          { authorization: "Bearer hrmsdev_wrong" },
        )
      ).status,
    ).toBe(401);

    const hik = await call(f, "biometric/devices", "POST", "admin", {
      name: "Face terminal",
      vendor: "HIKVISION",
      serialNumber: `HIK${f.prefix}`,
    });
    // Devices send no Origin header and no session.
    const req = new NextRequest(
      `http://localhost:3000/api/biometric/hikvision/${hik.body.data.pushToken}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": testClientIp,
        },
        body: JSON.stringify({
          dateTime: "2026-09-18T18:30:00Z",
          eventType: "AccessControllerEvent",
          AccessControllerEvent: {
            employeeNoString: "PEER",
            majorEventType: 5,
          },
        }),
      },
    );
    const res = await apiPost(req, {
      params: Promise.resolve({
        path: ["biometric", "hikvision", hik.body.data.pushToken],
      }),
    });
    expect(res.status).toBe(200);
    const peerDay = await db.attendance.findFirstOrThrow({
      where: {
        employeeId: f.employees.peer,
        workDate: new Date("2026-09-18T00:00:00Z"),
      },
    });
    expect(peerDay.checkOut?.toISOString()).toBe("2026-09-18T18:30:00.000Z");
  });

  it("enforces a device IP allow-list", async () => {
    await call(f, `biometric/devices/${essl}`, "PUT", "admin", {
      ipAllowlist: ["10.9.9.9"],
    });
    expect((await adms("GET", "cdata", { SN: serial })).status).toBe(401);
    await call(f, `biometric/devices/${essl}`, "PUT", "admin", {
      ipAllowlist: [],
    });
    expect((await adms("GET", "cdata", { SN: serial })).status).toBe(200);
  });
});
