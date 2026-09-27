import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db, withTenant } from "../../src/lib/db";
import { notify } from "../../src/modules/notifications/service";
import { call, Fixture } from "./helpers";

// Phase 13: push delivery (Expo and FCM) and the v1 mobile endpoints.
const f = new Fixture();
let a = "";
const sent: { url: string; body: string }[] = [];

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("EXPO_PUSH_ENABLED", "1");
  vi.stubEnv("FCM_PROJECT_ID", "demo-project");
  vi.stubEnv("FCM_CLIENT_EMAIL", "push@demo-project.iam.gserviceaccount.com");
  vi.stubEnv(
    "FCM_PRIVATE_KEY",
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!/exp\.host|googleapis\.com/.test(url)) return real(input, init);
      sent.push({ url, body: String(init?.body ?? "") });
      if (url.includes("oauth2"))
        return Response.json({ access_token: "fcm-access", expires_in: 3600 });
      if (url.includes("exp.host")) {
        const tokens = JSON.parse(String(init?.body)) as { to: string }[];
        return Response.json({
          data: tokens.map((t) =>
            t.to.includes("gone")
              ? { status: "error", details: { error: "DeviceNotRegistered" } }
              : { status: "ok" },
          ),
        });
      }
      return Response.json({ name: "projects/demo/messages/1" });
    }),
  );
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.pushToken.deleteMany({ where: { companyId: { in: f.companies } } });
  await db.notification.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 13 push delivery", () => {
  it("delivers allowed events to Expo and FCM tokens and drops dead tokens", async () => {
    for (const token of [
      "ExponentPushToken[live-staff-token-0001]",
      "ExponentPushToken[gone-staff-token-0002]",
      "fcm-native-token-abcdefghijklmnopqrstuvwxyz",
    ])
      expect(
        (
          await call(f, "v1/push-token", "POST", "staff", {
            token,
            platform: "android",
          })
        ).status,
      ).toBe(200);
    // Callers always notify inside the tenant scope.
    await withTenant(a, () =>
      notify(
        a,
        [f.users.staff],
        "leave.approved",
        { leaveType: "Casual", startDate: "2026-10-01", endDate: "2026-10-01" },
        "/leave",
      ),
    );
    const expo = sent.find((x) => x.url.includes("exp.host"))!;
    const fcm = sent.find((x) => x.url.includes("messages:send"))!;
    expect(JSON.parse(expo.body)).toHaveLength(2);
    expect(expo.body).toContain("Leave approved");
    expect(JSON.parse(fcm.body).message).toMatchObject({
      token: "fcm-native-token-abcdefghijklmnopqrstuvwxyz",
      data: { event: "leave.approved", link: "/leave" },
    });
    // The JWT assertion is signed with the configured service account key.
    const auth = sent.find((x) => x.url.includes("oauth2"))!;
    expect(
      new URLSearchParams(auth.body).get("assertion")?.split("."),
    ).toHaveLength(3);
    const tokens = await db.pushToken.findMany({
      where: { userId: f.users.staff },
      orderBy: { token: "asc" },
    });
    expect(tokens.map((t) => [t.token.slice(0, 22), t.active])).toEqual([
      ["ExponentPushToken[gone", false],
      ["ExponentPushToken[live", true],
      ["fcm-native-token-abcde", true],
    ]);
    // Events outside the push list are in-app only.
    sent.length = 0;
    await withTenant(a, () => notify(a, [f.users.staff], "welcome", {}));
    expect(sent).toHaveLength(0);
  });
});

describe("Phase 13 mobile API", () => {
  it("serves the employee screens through v1 with the usual checks", async () => {
    const home = await call(f, "v1/home", "GET", "staff");
    expect(home.body.data.employee.name).toBe("staff Tester");
    expect(
      (await call(f, "v1/notifications", "GET", "staff")).body.data.items
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await call(f, "v1/documents?scope=own", "GET", "staff")).status,
    ).toBe(200);
    expect((await call(f, "v1/helpdesk", "GET", "staff")).status).toBe(200);
    expect((await call(f, "v1/unknown", "GET", "staff")).status).toBe(404);
    // Company-only lists stay forbidden for employees.
    expect(
      (await call(f, "v1/documents?scope=company", "GET", "staff")).status,
    ).toBe(403);
  });

  it("lists approvals for the manager and finance, never their own", async () => {
    const cat = await db.expenseCategory.create({
      data: { companyId: a, name: "Travel", requiresReceipt: false },
    });
    const claim = await call(f, "v1/expenses/claims", "POST", "staff", {
      categoryId: cat.id,
      expenseDate: "2026-09-10",
      amount: 250,
      description: "Cab to client",
    });
    expect(claim.status).toBe(200);
    const mgr = (await call(f, "v1/approvals", "GET", "manager")).body.data;
    expect(mgr.expenses.map((x: { id: string }) => x.id)).toEqual([
      claim.body.data.id,
    ]);
    expect((await call(f, "v1/approvals", "GET", "staff")).body.data).toEqual({
      leave: [],
      expenses: [],
    });
    await call(f, `expenses/claims/${claim.body.data.id}`, "PUT", "manager", {
      action: "approve",
    });
    const finance = (await call(f, "v1/approvals", "GET", "admin")).body.data;
    expect(finance.expenses).toHaveLength(1);
    expect(
      (await call(f, "v1/approvals", "GET", "other")).body.data.expenses,
    ).toHaveLength(0);
  });
});
