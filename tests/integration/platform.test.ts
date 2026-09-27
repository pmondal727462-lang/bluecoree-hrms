import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { provisionCompany } from "../../src/modules/auth/service";
import { GET, POST, PUT, DELETE } from "../../src/app/api/[...path]/route";
import { deleteAttendance } from "./cleanup";
import { testClientIp } from "./client";
import { deliverDue, resolver } from "../../src/modules/integrations/outbound";
import { codeForStep } from "../../src/modules/auth/totp";
const prefix = `PLAT-${randomBytes(4).toString("hex").toUpperCase()}`;
const password = "Platform-Integration-Password-123!";
const companies: string[] = [],
  codes: string[] = [];
let admin = "",
  staff = "",
  other = "",
  staffEmployeeId = "";
async function call(
  path: string,
  method = "GET",
  cookie = admin,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const req = new NextRequest(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      "x-forwarded-for": testClientIp,
      origin: process.env.APP_URL || "http://localhost:3000",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await { GET, POST, PUT, DELETE }[
    method as "GET" | "POST" | "PUT" | "DELETE"
  ](req, { params: Promise.resolve({ path: path.split("?")[0].split("/") }) });
  return {
    status: result.status,
    body: parseBody(await result.text()),
    headers: result.headers,
    cookie: result.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
}
function parseBody(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
beforeAll(async () => {
  const hash = await bcrypt.hash(password, 12);
  for (const suffix of ["A", "B"]) {
    const c = await db.$transaction(
      (tx) =>
        provisionCompany(tx, {
          code: prefix + suffix,
          name: "Platform test " + suffix,
          email: "test@platform.example",
          timezone: "UTC",
          workingDays: [1, 2, 3, 4, 5],
        }),
      { timeout: 20000 },
    );
    companies.push(c.id);
    codes.push(c.code);
    for (const roleName of suffix === "A"
      ? ["Company Admin", "Employee"]
      : ["Company Admin"]) {
      const role = await db.role.findUniqueOrThrow({
        where: { companyId_name: { companyId: c.id, name: roleName } },
      });
      const email =
        roleName === "Employee"
          ? "employee@platform.example"
          : "admin@platform.example";
      const user = await db.user.create({
        data: {
          companyId: c.id,
          roleId: role.id,
          name: roleName,
          email,
          passwordHash: hash,
        },
      });
      const e = await db.employee.create({
        data: {
          companyId: c.id,
          userId: user.id,
          firstName: roleName,
          lastName: suffix,
          employeeCode: roleName === "Employee" ? "STAFF" : "ADMIN",
          officialEmail: email,
          joinedAt: new Date("2020-01-01"),
        },
      });
      const login = await call("auth/login", "POST", "", {
        companyCode: c.code,
        identifier: email,
        password,
      });
      expect(login.status).toBe(200);
      if (suffix === "B") other = login.cookie;
      else if (roleName === "Employee") {
        staff = login.cookie;
        staffEmployeeId = e.id;
      } else admin = login.cookie;
    }
  }
});
afterAll(async () => {
  if (companies.length)
    await db.$transaction(
      async (tx) => {
        const where = { companyId: { in: companies } };
        await deleteAttendance(tx, where);
        await tx.payslip.deleteMany({ where });
        await tx.employee.deleteMany({ where });
        await tx.session.deleteMany({ where: { user: where } });
        await tx.loginHistory.deleteMany({ where });
        await tx.securityEvent.deleteMany({ where });
        await tx.employeeDevice.deleteMany({ where });
        await tx.user.deleteMany({ where });
        await tx.rolePermission.deleteMany({ where: { role: where } });
        await tx.role.deleteMany({ where });
        await tx.department.deleteMany({ where });
        await tx.designation.deleteMany({ where });
        await tx.branch.deleteMany({ where });
        await tx.auditLog.deleteMany({ where });
        await tx.company.deleteMany({ where: { id: { in: companies } } });
      },
      { timeout: 30000 },
    );
  await db.$disconnect();
});

describe("Attendance locations and geofence events", () => {
  let office = "",
    warehouse = "";
  it("lets only time administrators manage locations", async () => {
    const body = {
      name: "Head Office",
      type: "HEAD_OFFICE",
      latitude: 22.5726,
      longitude: 88.3639,
      radiusMeters: 100,
    };
    expect((await call("time/locations", "POST", staff, body)).status).toBe(
      403,
    );
    const created = await call("time/locations", "POST", admin, body);
    expect(created.status).toBe(200);
    office = created.body.data.id;
    const second = await call("time/locations", "POST", admin, {
      ...body,
      name: "Warehouse",
      type: "WAREHOUSE",
      latitude: 22.6,
      longitude: 88.4,
      radiusMeters: 150,
    });
    warehouse = second.body.data.id;
    expect(
      (
        await call("time/employee-locations", "PUT", other, {
          employeeId: staffEmployeeId,
          locationIds: [office],
        })
      ).status,
    ).toBe(404);
    const assigned = await call("time/employee-locations", "PUT", admin, {
      employeeId: staffEmployeeId,
      locationIds: [office, warehouse],
    });
    expect(assigned.status).toBe(200);
    expect(
      (await call(`time/locations/${office}`, "PUT", other, body)).status,
    ).toBe(404);
  });
  it("accepts a punch inside any assigned location and logs rejections", async () => {
    const summary = await call("time/summary", "GET", staff);
    expect(summary.body.data.employeePolicy.geofenceEnabled).toBe(true);
    expect(summary.body.data.assignedLocations).toHaveLength(2);
    const outside = await call("time/check-in", "POST", staff, {
      location: { latitude: 23.5, longitude: 88.3, accuracy: 10 },
      deviceId: "browser-device-01",
    });
    expect(outside.status).toBe(403);
    const rejected = await db.geofenceEvent.findFirstOrThrow({
      where: { employeeId: staffEmployeeId, accepted: false },
    });
    expect(rejected.reason).toBe("OUTSIDE_AREA");
    expect(rejected.deviceId).toBe("browser-device-01");
    const inside = await call("time/check-in", "POST", staff, {
      location: { latitude: 22.6003, longitude: 88.4001, accuracy: 12 },
      deviceId: "browser-device-01",
    });
    expect(inside.status).toBe(200);
    expect(inside.body.data.checkInLocation.locationName).toBe("Warehouse");
    expect(inside.body.data.checkInLocation.deviceId).toBe("browser-device-01");
    const accepted = await db.geofenceEvent.findFirstOrThrow({
      where: { employeeId: staffEmployeeId, accepted: true },
    });
    expect(accepted.attendanceId).toBe(inside.body.data.id);
    expect(accepted.locationId).toBe(warehouse);
    expect(accepted.eventType).toBe("CHECK_IN");
    expect(
      (
        await call("time/check-out", "POST", staff, {
          location: { latitude: 22.5726, longitude: 88.3639, accuracy: 500 },
        })
      ).status,
    ).toBe(422);
    const own = await call("time/geofence-events", "GET", staff);
    expect(own.body.data.total).toBe(3);
    expect(
      (await call("time/geofence-events?scope=company", "GET", staff)).status,
    ).toBe(403);
    expect(
      (await call("time/geofence-events?scope=company", "GET", other)).body.data
        .total,
    ).toBe(0);
  });
});

describe("Mobile sessions and device management", () => {
  const device = {
    deviceId: "android-device-0001",
    deviceName: "Pixel",
    platform: "android",
    osVersion: "15",
    appVersion: "1.0.0",
  };
  const mobileLogin = () =>
    call("v1/auth/login", "POST", "", {
      companyCode: codes[0],
      identifier: "employee@platform.example",
      password,
      device,
    });
  it("links mobile sessions to registered devices", async () => {
    const login = await mobileLogin();
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;
    const session = await db.mobileSession.findFirstOrThrow({
      where: { companyId: companies[0], platform: "android" },
      include: { device: true },
    });
    expect(session.device?.deviceId).toBe(device.deviceId);
    expect((await call("devices", "GET", staff)).status).toBe(403);
    const list = await call("devices", "GET", admin);
    const row = list.body.data.items.find(
      (d: { deviceId: string }) => d.deviceId === device.deviceId,
    );
    expect(row.activeSessions).toBe(1);
    expect(
      (await call(`devices/${row.id}`, "PUT", other, { action: "deactivate" }))
        .status,
    ).toBe(404);
    expect(
      (await call("v1/profile", "GET", "", undefined, bearer(token))).status,
    ).toBe(200);
    const out = await call(`devices/${row.id}`, "PUT", admin, {
      action: "force-logout",
    });
    expect(out.body.data.signedOut).toBe(1);
    expect(
      (await call("v1/profile", "GET", "", undefined, bearer(token))).status,
    ).toBe(401);
  });
  it("blocks deactivated devices until an administrator reactivates them", async () => {
    const row = await db.employeeDevice.findFirstOrThrow({
      where: { companyId: companies[0], deviceId: device.deviceId },
    });
    await mobileLogin();
    const deactivated = await call(`devices/${row.id}`, "PUT", admin, {
      action: "deactivate",
    });
    expect(deactivated.body.data.signedOut).toBe(1);
    const blocked = await mobileLogin();
    expect(blocked.status).toBe(403);
    expect(blocked.body.errorCode).toBe("DEVICE_DEACTIVATED");
    const plain = await call("v1/auth/login", "POST", "", {
      companyCode: codes[0],
      identifier: "employee@platform.example",
      password,
    });
    expect(
      (
        await call(
          "v1/devices",
          "POST",
          "",
          device,
          bearer(plain.body.data.accessToken),
        )
      ).status,
    ).toBe(403);
    await call(`devices/${row.id}`, "PUT", admin, { action: "activate" });
    expect((await mobileLogin()).status).toBe(200);
    expect((await call(`devices/${row.id}`, "DELETE", admin)).status).toBe(200);
    expect(await db.employeeDevice.count({ where: { id: row.id } })).toBe(0);
  });
});

describe("Integration hub", () => {
  type Sent = { url: string; headers: Record<string, string>; body: string };
  const sent: Sent[] = [];
  let status = 200;
  beforeAll(() => {
    resolver.lookup = async (host: string) =>
      host === "internal.example.com" ? ["10.0.0.5"] : ["93.184.216.34"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({
          url: String(url),
          headers: init.headers as Record<string, string>,
          body: String(init.body),
        });
        return new Response("{}", { status });
      }),
    );
  });
  afterAll(() => vi.unstubAllGlobals());
  const waitFor = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      "Timed out: " +
        JSON.stringify(
          await db.webhookDelivery.findMany({
            where: { companyId: companies[0] },
          }),
        ),
    );
  };

  it("restricts management and refuses private webhook targets", async () => {
    expect((await call("integrations", "GET", staff)).status).toBe(403);
    for (const url of [
      "http://hooks.example.com/hr",
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://internal.example.com/hook",
    ])
      expect(
        (
          await call("integrations/webhooks", "POST", admin, {
            name: "Bad",
            url,
            events: ["employee.created"],
          })
        ).status,
      ).toBe(422);
  });

  it("delivers signed webhooks after commit and retries failures", async () => {
    const hook = await call("integrations/webhooks", "POST", admin, {
      name: "HR sync",
      url: "https://hooks.example.com/hr",
      events: ["employee.created"],
    });
    expect(hook.status).toBe(200);
    const secret = hook.body.data.secret as string;
    expect(secret).toMatch(/^whsec_/);
    expect(
      JSON.stringify(await call("integrations/webhooks", "GET", admin)),
    ).not.toContain(secret);
    status = 500;
    const created = await call("employees", "POST", admin, {
      employeeCode: "HOOK-1",
      firstName: "Webhook",
      lastName: "Person",
      officialEmail: "hook@platform.example",
      joinedAt: "2026-01-05",
    });
    expect(created.status).toBe(201);
    // Delivery normally starts in the background after commit; drive it here
    // so the test does not depend on that timing. Claims prevent double sends.
    await deliverDue(companies[0]);
    await waitFor(
      async () =>
        (await db.webhookDelivery.count({
          where: {
            companyId: companies[0],
            attempts: { gt: 0 },
            status: "PENDING",
          },
        })) === 1,
    );
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { companyId: companies[0], event: "employee.created" },
    });
    expect(delivery.responseStatus).toBe(500);
    const request = sent.find(
      (r) => r.headers["x-hrms-delivery"] === delivery.id,
    )!;
    const expected = createHmac("sha256", secret)
      .update(`${request.headers["x-hrms-timestamp"]}.${request.body}`)
      .digest("hex");
    expect(request.headers["x-hrms-signature"]).toBe(`sha256=${expected}`);
    expect(JSON.parse(request.body).data.employeeCode).toBe("HOOK-1");
    expect(
      (
        await call(
          `integrations/deliveries/${delivery.id}/retry`,
          "POST",
          other,
        )
      ).status,
    ).toBe(404);
    status = 200;
    const retried = await call(
      `integrations/deliveries/${delivery.id}/retry`,
      "POST",
      admin,
    );
    expect(retried.body.data.status).toBe("SUCCESS");
    expect(retried.body.data.attempts).toBe(2);
  });

  it("issues scoped API keys and logs public API calls", async () => {
    const created = await call("integrations/api-keys", "POST", admin, {
      name: "Reporting",
      scopes: ["employees.read"],
    });
    const key = created.body.data.key as string;
    expect(key).toMatch(/^hrms_/);
    expect(await db.apiKey.count({ where: { keyHash: key } })).toBe(0);
    const list = await call("v1/employees", "GET", "", undefined, {
      "x-api-key": key,
    });
    expect(list.status).toBe(200);
    const seen = list.body.data.items.map(
      (e: { employeeCode: string }) => e.employeeCode,
    );
    expect(seen).toContain("STAFF");
    expect(list.body.data.total).toBe(3);
    expect(JSON.stringify(list.body)).not.toContain("sensitiveEncrypted");
    expect(
      (await call("v1/payslips", "GET", "", undefined, bearer(key))).status,
    ).toBe(403);
    const logs = await call("integrations/api-logs", "GET", admin);
    expect(
      logs.body.data.items.map((l: { status: number }) => l.status).sort(),
    ).toEqual([200, 403]);
    expect(
      (await call("integrations/api-logs", "GET", other)).body.data.total,
    ).toBe(0);
    expect(
      (
        await call(
          `integrations/api-keys/${created.body.data.id}`,
          "DELETE",
          other,
        )
      ).status,
    ).toBe(404);
    await call(
      `integrations/api-keys/${created.body.data.id}`,
      "DELETE",
      admin,
    );
    expect(
      (await call("v1/employees", "GET", "", undefined, { "x-api-key": key }))
        .status,
    ).toBe(401);
  });

  it("exports and pushes accounting journals with configurable mapping", async () => {
    expect(
      (
        await call("payroll/payslips", "POST", admin, {
          employeeId: staffEmployeeId,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          grossPay: 50000,
          deductions: 5000,
          netPay: 45000,
        })
      ).status,
    ).toBe(200);
    const books = await call("integrations/connections", "POST", admin, {
      category: "ACCOUNTING",
      provider: "Generic ledger API",
      name: "Books",
      secret: "books-secret-token",
      config: {
        endpointUrl: "https://books.example.com/journal",
        accountMapping: {
          salaryExpense: "5100 Salaries",
          pfEmployerContribution: "5110 PF",
          esiEmployerContribution: "5120 ESI",
          tdsPayable: "2210 TDS",
          salaryPayable: "2100 Salary Payable",
          otherDeductions: "2290 Deductions",
        },
      },
    });
    expect(books.status).toBe(200);
    expect(
      JSON.stringify(await call("integrations", "GET", admin)),
    ).not.toContain("books-secret-token");
    const range = "from=2026-08-01&to=2026-08-31";
    const exported = await call(
      `integrations/accounting-export?${range}&format=json`,
    );
    expect(exported.body.entries[0].lines).toEqual([
      { account: "5100 Salaries", debit: 50000, credit: 0 },
      { account: "2100 Salary Payable", debit: 0, credit: 45000 },
      { account: "2290 Deductions", debit: 0, credit: 5000 },
    ]);
    expect(exported.body.entries[0].balanced).toBe(true);
    const csv = await call(
      `integrations/accounting-export?${range}&format=csv`,
    );
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.body).toContain('"5100 Salaries","50000","0"');
    expect(
      (await call(`integrations/accounting-export?${range}&format=xlsx`))
        .status,
    ).toBe(200);
    status = 503;
    const failed = await call(
      "integrations/accounting-export/push",
      "POST",
      admin,
      {
        integrationId: books.body.data.id,
        from: "2026-08-01",
        to: "2026-08-31",
      },
    );
    expect(failed.body.data.status).toBe("FAILED");
    const pushed = sent.at(-1)!;
    expect(pushed.url).toBe("https://books.example.com/journal");
    expect(pushed.headers.authorization).toBe("Bearer books-secret-token");
    status = 200;
    const retried = await call(
      `integrations/logs/${failed.body.data.id}/retry`,
      "POST",
      admin,
    );
    expect(retried.body.data.status).toBe("SUCCESS");
    expect(
      (await call("integrations/logs", "GET", admin)).body.data.total,
    ).toBe(2);
    expect(
      (await call("integrations/logs", "GET", other)).body.data.total,
    ).toBe(0);
  });
});

describe("Login security, enforced MFA and session controls", () => {
  const email = "guard@platform.example";
  let userId = "",
    cookie = "";
  const signIn = (extra: Record<string, string> = {}, pass = password) =>
    call("auth/login", "POST", "", {
      companyCode: codes[0],
      identifier: email,
      password: pass,
      ...extra,
    });
  const policy = {
    requireForAdmins: false,
    requireForManagers: false,
    requireForEmployees: false,
    maxFailedAttempts: 3,
    lockoutMinutes: 15,
    passwordExpiryDays: null as number | null,
    sessionIdleMinutes: null as number | null,
  };
  const setPolicy = (changes: Partial<typeof policy> = {}) =>
    call("security/settings", "PUT", admin, { ...policy, ...changes });
  beforeAll(async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { companyId_name: { companyId: companies[0], name: "Employee" } },
    });
    const user = await db.user.create({
      data: {
        companyId: companies[0],
        roleId: role.id,
        name: "Guarded user",
        email,
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await setPolicy({ maxFailedAttempts: 5 });
  });

  it("locks an account after repeated failures until unlocked", async () => {
    expect((await call("security/settings", "PUT", staff, policy)).status).toBe(
      403,
    );
    expect((await setPolicy()).status).toBe(200);
    for (let i = 0; i < 3; i++)
      expect((await signIn({}, "Wrong-password-123!")).status).toBe(401);
    const locked = await signIn();
    expect(locked.status).toBe(423);
    expect(locked.body.errorCode).toBe("ACCOUNT_LOCKED");
    const history = await db.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.reason)).toEqual([
      "INVALID_PASSWORD",
      "INVALID_PASSWORD",
      "INVALID_PASSWORD",
      "LOCKED",
    ]);
    const events = await call(
      "security/events?type=ACCOUNT_LOCKED",
      "GET",
      admin,
    );
    expect(events.body.data.items[0].userId).toBe(userId);
    expect((await call("security/events", "GET", staff)).status).toBe(403);
    expect(
      (await call("security/events", "GET", other)).body.data.items.some(
        (e: { userId: string }) => e.userId === userId,
      ),
    ).toBe(false);
    expect(
      (await call(`security/users/${userId}/unlock`, "POST", other)).status,
    ).toBe(404);
    expect(
      (await call(`security/users/${userId}/unlock`, "POST", admin)).status,
    ).toBe(200);
    const ok = await signIn();
    expect(ok.status).toBe(200);
    cookie = ok.cookie;
    const own = await call("auth/login-history", "GET", cookie);
    expect(own.body.data.items[0].success).toBe(true);
    expect(
      own.body.data.items.every((h: { userId: string }) => h.userId === userId),
    ).toBe(true);
  });

  it("enforces MFA by role tier and accepts one-use recovery codes", async () => {
    await setPolicy({ requireForEmployees: true });
    const blocked = await call("time/summary", "GET", cookie);
    expect(blocked.status).toBe(428);
    expect(blocked.body.errorCode).toBe("MFA_SETUP_REQUIRED");
    const me = await call("auth/me", "GET", cookie);
    expect(me.body.data.mfaSetupRequired).toBe(true);
    expect((await call("time/summary", "GET", admin)).status).toBe(200);
    const setup = await call("auth/2fa/setup", "POST", cookie, { password });
    const step = Math.floor(Date.now() / 30000);
    expect(
      (
        await call("auth/2fa/enable", "POST", cookie, {
          password,
          code: codeForStep(setup.body.data.secret, step),
        })
      ).status,
    ).toBe(200);
    expect((await call("time/summary", "GET", cookie)).status).not.toBe(428);
    const generated = await call("auth/recovery-codes", "POST", cookie, {
      password,
    });
    const recovery = generated.body.data.codes as string[];
    expect(recovery).toHaveLength(10);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } }))
        .recoveryCodeHashes,
    ).not.toContain(recovery[0]);
    expect((await signIn()).body.errorCode).toBe("TWO_FACTOR_REQUIRED");
    expect((await signIn({ recoveryCode: recovery[0] })).status).toBe(200);
    expect((await signIn({ recoveryCode: recovery[0] })).status).toBe(401);
    expect(
      (await call("auth/recovery-codes", "GET", cookie)).body.data.remaining,
    ).toBe(9);
    expect(
      await db.securityEvent.count({
        where: { userId, type: "RECOVERY_CODE_USED" },
      }),
    ).toBe(1);
    await db.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0 },
    });
  });

  it("expires passwords, ends idle sessions and signs out all devices", async () => {
    await setPolicy({ passwordExpiryDays: 30, sessionIdleMinutes: 15 });
    const login = await signIn({
      recoveryCode: (
        await call("auth/recovery-codes", "POST", cookie, { password })
      ).body.data.codes[0],
    });
    cookie = login.cookie;
    await db.user.update({
      where: { id: userId },
      data: { passwordChangedAt: new Date(Date.now() - 40 * 86400000) },
    });
    const expired = await call("time/summary", "GET", cookie);
    expect(expired.body.errorCode).toBe("PASSWORD_EXPIRED");
    expect(
      (await call("auth/me", "GET", cookie)).body.data.passwordChangeRequired,
    ).toBe(true);
    await db.user.update({
      where: { id: userId },
      data: { passwordChangedAt: new Date() },
    });
    const session = (await call("auth/me", "GET", cookie)).body.data.sessionId;
    await db.session.update({
      where: { id: session },
      data: { lastUsedAt: new Date(Date.now() - 20 * 60000) },
    });
    expect((await call("auth/me", "GET", cookie)).status).toBe(401);
    expect(await db.session.count({ where: { id: session } })).toBe(0);
    await setPolicy({ requireForEmployees: false });
    await db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    const first = (await signIn()).cookie,
      second = (await signIn()).cookie;
    const revoked = await call("auth/sessions/revoke-all", "POST", first, {});
    expect(revoked.body.data.revoked).toBeGreaterThanOrEqual(1);
    expect((await call("auth/me", "GET", second)).status).toBe(401);
    expect((await call("auth/me", "GET", first)).status).toBe(200);
  });
});

describe("Subscriptions, plan limits and branding", () => {
  let testPlan = "";
  const planCode = `TEST_${prefix.replace(/[^A-Z0-9]/g, "")}`;
  const subscribe = (companyId: string, data: Record<string, unknown>) =>
    db.subscription.update({ where: { companyId }, data });
  beforeAll(async () => {
    testPlan = (
      await db.subscriptionPlan.create({
        data: {
          code: planCode,
          name: "Limited test plan",
          features: ["attendance", "api"],
          employeeLimit: 1,
          apiCallLimitMonthly: 1,
          active: false,
        },
      })
    ).id;
  });
  afterAll(async () => {
    const enterprise = await db.subscriptionPlan.findUniqueOrThrow({
      where: { code: "ENTERPRISE" },
    });
    await db.subscription.updateMany({
      where: { planId: testPlan },
      data: { planId: enterprise.id },
    });
    await db.subscriptionPlan.delete({ where: { id: testPlan } });
  });

  it("starts new companies on a free trial", async () => {
    const sub = await db.subscription.findUniqueOrThrow({
      where: { companyId: companies[0] },
      include: { plan: true },
    });
    expect(sub.plan.code).toBe("FREE_TRIAL");
    expect(sub.status).toBe("TRIAL");
    const days = (sub.trialEndsAt!.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThanOrEqual(15);
    const view = await call("subscription", "GET", admin);
    expect(view.body.data.current.status).toBe("TRIAL");
    expect(view.body.data.current.usage.employees).toBeGreaterThan(0);
    expect((await call("subscription", "GET", staff)).status).toBe(403);
    expect(
      (await call("auth/me", "GET", admin)).body.data.subscription.status,
    ).toBe("TRIAL");
  });

  it("pauses modules outside the plan or after expiry but keeps core data", async () => {
    const basic = await db.subscriptionPlan.findUniqueOrThrow({
      where: { code: "BASIC" },
    });
    await subscribe(companies[1], { planId: basic.id });
    const payroll = await call("payroll/payslips", "GET", other);
    expect(payroll.status).toBe(402);
    expect(payroll.body.errorCode).toBe("FEATURE_NOT_IN_PLAN");
    expect((await call("integrations", "GET", other)).status).toBe(402);
    expect((await call("time/summary", "GET", other)).status).toBe(200);
    await subscribe(companies[1], {
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() - 86400000),
      graceDays: 7,
    });
    expect((await call("time/summary", "GET", other)).status).toBe(200);
    expect(
      (await call("auth/me", "GET", other)).body.data.subscription.status,
    ).toBe("GRACE");
    await subscribe(companies[1], {
      trialEndsAt: new Date(Date.now() - 10 * 86400000),
    });
    const expired = await call("time/summary", "GET", other);
    expect(expired.status).toBe(402);
    expect(expired.body.errorCode).toBe("SUBSCRIPTION_EXPIRED");
    expect((await call("employees", "GET", other)).status).toBe(200);
    expect(
      (await call("auth/me", "GET", other)).body.data.subscription.status,
    ).toBe("EXPIRED");
  });

  it("enforces employee limits and monthly API quotas", async () => {
    await subscribe(companies[1], {
      planId: testPlan,
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
    const before = await db.employee.count({
      where: { companyId: companies[1] },
    });
    const blocked = await call("employees", "POST", other, {
      employeeCode: "LIMIT-2",
      firstName: "Over",
      lastName: "Limit",
      officialEmail: "limit@platform.example",
      joinedAt: "2026-01-05",
    });
    expect(blocked.status).toBe(402);
    expect(blocked.body.errorCode).toBe("PLAN_LIMIT_REACHED");
    expect(
      await db.employee.count({ where: { companyId: companies[1] } }),
    ).toBe(before);
    const key = (
      await call("integrations/api-keys", "POST", other, {
        name: "Quota",
        scopes: ["employees.read"],
      })
    ).body.data.key;
    const headers = { "x-api-key": key };
    expect(
      (await call("v1/employees", "GET", "", undefined, headers)).status,
    ).toBe(200);
    const over = await call("v1/employees", "GET", "", undefined, headers);
    expect(over.status).toBe(429);
    expect(over.body.errorCode).toBe("PLAN_QUOTA_EXCEEDED");
  });

  it("validates logos and publishes branding only on plans with white-label", async () => {
    const body = {
      brandName: "Acme People",
      portalTitle: "Acme HR",
      primaryColor: "#0f766e",
      secondaryColor: "#f59e0b",
      loginMessage: "Welcome to Acme",
      emailFooter: "Acme Ltd",
      payslipFooter: "Confidential",
      customDomain: null,
    };
    const denied = await call("branding", "PUT", admin, body);
    expect(denied.body.errorCode).toBe("FEATURE_NOT_IN_PLAN");
    const enterprise = await db.subscriptionPlan.findUniqueOrThrow({
      where: { code: "ENTERPRISE" },
    });
    await subscribe(companies[0], { planId: enterprise.id });
    expect((await call("branding", "PUT", staff, body)).status).toBe(403);
    expect((await call("branding", "PUT", admin, body)).status).toBe(200);
    for (const dataUrl of [
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script>").toString("base64")}`,
    ])
      expect(
        (await call("branding/logo", "POST", admin, { dataUrl })).status,
      ).toBe(422);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    expect(
      (
        await call("branding/logo", "POST", admin, {
          dataUrl: `data:image/png;base64,${png}`,
        })
      ).status,
    ).toBe(200);
    const pub = await call(`public/branding?company=${codes[0]}`, "GET", "");
    expect(pub.body.data.brandName).toBe("Acme People");
    expect(JSON.stringify(pub.body)).not.toContain("Confidential");
    const logo = await call(
      `public/branding/logo?company=${codes[0]}`,
      "GET",
      "",
    );
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(logo.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      (await call("auth/me", "GET", staff)).body.data.branding.primaryColor,
    ).toBe("#0f766e");
    expect(
      (await call(`public/branding?company=${codes[1]}`, "GET", "")).body.data,
    ).toBeNull();
  });
});
