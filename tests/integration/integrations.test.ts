import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { resolver } from "../../src/modules/integrations/outbound";
import { e164 } from "../../src/integrations/messaging";
import { call, Fixture } from "./helpers";

// Phase 14: public API writes and journal, attendance webhooks, OpenAPI
// coverage, SMS/WhatsApp delivery.
const f = new Fixture();
let a = "";
let key = "";
const outbound: { url: string; body: string }[] = [];

beforeAll(async () => {
  resolver.lookup = async () => ["93.184.216.34"];
  vi.stubEnv("SMS_PROVIDER", "twilio");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
  vi.stubEnv("SMS_FROM", "+15550001111");
  vi.stubEnv("WHATSAPP_TOKEN", "wa-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!/twilio|facebook/.test(url)) return real(input, init);
      outbound.push({ url, body: String(init?.body ?? "") });
      return Response.json({ ok: true });
    }),
  );
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
  const created = await call(f, "integrations/api-keys", "POST", "admin", {
    name: "HRIS sync",
    scopes: [
      "employees.read",
      "employees.write",
      "attendance.write",
      "leave.write",
      "payroll.read",
    ],
  });
  key = created.body.data.key;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const where = { companyId: { in: f.companies } };
  await db.webhookDelivery.deleteMany({ where });
  await db.webhook.deleteMany({ where });
  await db.apiLog.deleteMany({ where });
  await db.apiKey.deleteMany({ where });
  await db.notificationTemplate.deleteMany({ where });
  await db.notification.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});
const withKey = (path: string, method = "GET", body?: unknown, k = key) =>
  call(f, path, method, "", body, { "x-api-key": k });

describe("Phase 14 public API", () => {
  it("creates and updates employees with the write scope, audited to the key", async () => {
    const created = await withKey("v1/employees", "POST", {
      employeeCode: "EXT1",
      firstName: "Ravi",
      lastName: "Kumar",
      officialEmail: "ravi@example.com",
      joinedAt: "2026-09-01",
    });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    // Server-to-server clients send no Origin header.
    const noOrigin = await call(
      f,
      "v1/employees",
      "POST",
      "",
      {
        employeeCode: "EXT3",
        firstName: "No",
        lastName: "Origin",
        officialEmail: "no-origin@example.com",
        joinedAt: "2026-09-01",
      },
      { "x-api-key": key, origin: "" },
    );
    expect(noOrigin.status).toBe(200);
    const updated = await withKey(`v1/employees/${id}`, "PUT", {
      lastName: "Kumar Singh",
    });
    expect(updated.body.data.lastName).toBe("Kumar Singh");
    const audit = await db.auditLog.findFirst({
      where: { companyId: a, recordId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorName).toBe("API key: HRIS sync");
    // Keys cannot reach another tenant's records.
    const foreign = await call(f, "integrations/api-keys", "POST", "other", {
      name: "Other",
      scopes: ["employees.write"],
    });
    expect(
      (
        await withKey(
          `v1/employees/${id}`,
          "PUT",
          { lastName: "X" },
          foreign.body.data.key,
        )
      ).status,
    ).toBe(404);
    // A read-only key cannot write.
    const reader = await call(f, "integrations/api-keys", "POST", "admin", {
      name: "Reader",
      scopes: ["employees.read"],
    });
    expect(
      (
        await withKey(
          "v1/employees",
          "POST",
          {
            employeeCode: "EXT2",
            firstName: "A",
            lastName: "B",
            officialEmail: "ab@example.com",
            joinedAt: "2026-09-01",
          },
          reader.body.data.key,
        )
      ).status,
    ).toBe(403);
  });

  it("records attendance and sends the attendance webhook", async () => {
    await call(f, "integrations/webhooks", "POST", "admin", {
      name: "Attendance feed",
      url: "https://hooks.example.com/hrms",
      events: ["attendance.checked_in", "attendance.checked_out"],
    });
    const saved = await withKey("v1/attendance", "POST", {
      employeeId: f.employees.staff,
      workDate: "2026-09-15",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Imported from the access-control system",
    });
    expect(saved.status).toBe(200);
    const staffCheck = await call(f, "time/check-in", "POST", "staff", {});
    expect(staffCheck.status).toBe(200);
    const deliveries = await db.webhookDelivery.findMany({
      where: { companyId: a },
    });
    expect(deliveries.map((d) => d.event)).toContain("attendance.checked_in");
  });

  it("serves the accounting journal through the API", async () => {
    expect((await withKey("v1/accounting-journal")).status).toBe(422);
    const journal = await withKey(
      "v1/accounting-journal?from=2026-01-01&to=2026-12-31",
    );
    expect(journal.status).toBe(200);
    expect(journal.body.data).toHaveProperty("entries");
  });
});

describe("Phase 14 documentation and messaging", () => {
  it("documents every module in the OpenAPI specification", async () => {
    const spec = (await call(f, "docs", "GET", "")).body as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    for (const path of [
      "/payroll/runs/{id}/approve",
      "/assets/{id}/assign",
      "/training/sessions",
      "/public/careers/{companyCode}",
      "/v1/accounting-journal",
      "/v1/approvals",
      "/time/check-in",
    ])
      expect(spec.paths).toHaveProperty([path]);
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual([
      "accessCookie",
      "apiKey",
      "bearer",
    ]);
  });

  it("sends SMS and WhatsApp only for events the company enabled", async () => {
    expect(e164("98765 43210")).toBe("+919876543210");
    expect(e164("+44 20 7946 0958")).toBe("+442079460958");
    expect(e164("123")).toBeNull();
    await db.employee.update({
      where: { id: f.employees.staff },
      data: { mobile: "9876543210" },
    });
    for (const channel of ["SMS", "WHATSAPP"])
      await call(f, "notifications/templates", "PUT", "admin", {
        event: "leave.approved",
        channel,
        subject: "Leave approved",
        body: "Hi {{name}}, your leave is approved.",
        active: true,
      });
    const templates = (await call(f, "notifications/templates", "GET", "admin"))
      .body.data as { event: string; sms: unknown; whatsapp: unknown }[];
    expect(templates.find((t) => t.event === "leave.approved")).toMatchObject({
      sms: { channel: "SMS" },
      whatsapp: { channel: "WHATSAPP" },
    });
    // Approving leave sends the notification through both channels.
    const type = await db.leaveType.create({
      data: { companyId: a, name: "Casual", annualDays: 12 },
    });
    const leave = await call(f, "time/leave", "POST", "staff", {
      leaveTypeId: type.id,
      startDate: "2026-12-14",
      endDate: "2026-12-14",
      reason: "Family function",
    });
    outbound.length = 0;
    const approved = await withKey(`v1/leave/${leave.body.data.id}`, "PUT", {
      status: "Approved",
    });
    expect(approved.status).toBe(200);
    const sms = outbound.find((o) => o.url.includes("twilio"))!;
    expect(new URLSearchParams(sms.body).get("To")).toBe("+919876543210");
    expect(new URLSearchParams(sms.body).get("Body")).toContain(
      "your leave is approved",
    );
    const wa = outbound.find((o) => o.url.includes("facebook"))!;
    expect(JSON.parse(wa.body)).toMatchObject({
      to: "919876543210",
      type: "text",
    });
    // Events without an SMS template are not texted.
    outbound.length = 0;
    await call(f, "time/leave", "POST", "staff", {
      leaveTypeId: type.id,
      startDate: "2026-12-15",
      endDate: "2026-12-15",
      reason: "Another day",
    });
    expect(outbound).toHaveLength(0);
  });
});
