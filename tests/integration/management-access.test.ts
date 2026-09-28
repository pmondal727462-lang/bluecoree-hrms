import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";
const f = new Fixture();
let companyId = "",
  adminEmail = "";
beforeAll(async () => {
  companyId = (await f.company("CLIENT")).id;
  adminEmail = (await f.user("admin", companyId, "Company Admin")).email;
  await f.user("staff", companyId, "Employee");
  await f.user("root", (await f.company("OWNER")).id, "Company Admin", {
    superAdmin: true,
  });
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});
describe("Management client access and annual catalogue", () => {
  it("assigns Basic and quotes the exact base, employee and tracking prices", async () => {
    const assigned = await call(
      f,
      `platform/subscriptions/${companyId}`,
      "PUT",
      "root",
      {
        planCode: "BASIC",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: null,
        graceDays: 7,
        notes: "Integration check",
      },
    );
    expect(assigned.status).toBe(200);
    const catalogue = (await call(f, "public/plans")).body.data;
    const basic = catalogue.plans.find(
      (p: { code: string }) => p.code === "BASIC",
    );
    expect(basic).toMatchObject({
      priceAnnual: 30000,
      pricePerEmployeeAnnual: 100,
      priceMonthly: null,
    });
    expect(basic.features).toContain("face");
    expect(
      catalogue.plans.find((p: { code: string }) => p.code === "PROFESSIONAL"),
    ).toMatchObject({
      name: "Advanced",
      priceAnnual: 30000,
      pricePerEmployeeAnnual: 150,
    });
    expect(
      catalogue.plans.some((p: { code: string }) => p.code === "ENTERPRISE"),
    ).toBe(false);
    expect(catalogue.addOns.map((a: { code: string }) => a.code)).toEqual([
      "LIVE_TRACKING",
    ]);
    const q = await call(f, "subscription/quote", "POST", "admin", {
      planCode: "BASIC",
      cycle: "ANNUAL",
      addOns: [{ code: "LIVE_TRACKING" }],
    });
    expect(q.status).toBe(200);
    expect(q.body.data.subtotal).toBe(30500);
    expect(
      (
        await call(f, "subscription/quote", "POST", "admin", {
          planCode: "BASIC",
          cycle: "MONTHLY",
        })
      ).status,
    ).toBe(422);
  });
  it("lets only the owner allow and block client modules, with audit evidence", async () => {
    const path = `platform/companies/${companyId}/rights`;
    expect(
      (
        await call(f, path, "PUT", "admin", {
          enabledFeatures: ["livetracking"],
          disabledFeatures: [],
        })
      ).status,
    ).toBe(403);
    expect((await call(f, "time/field-tracking", "GET", "admin")).status).toBe(
      402,
    );
    expect(
      (
        await call(f, path, "PUT", "root", {
          enabledFeatures: ["livetracking"],
          disabledFeatures: [],
        })
      ).status,
    ).toBe(200);
    expect((await call(f, "time/field-tracking", "GET", "admin")).status).toBe(
      200,
    );
    expect(
      (
        await call(f, path, "PUT", "root", {
          enabledFeatures: [],
          disabledFeatures: ["livetracking"],
        })
      ).status,
    ).toBe(200);
    expect((await call(f, "time/field-tracking", "GET", "admin")).status).toBe(
      402,
    );
    expect(
      await db.auditLog.count({
        where: { recordId: companyId, module: "client_rights" },
      }),
    ).toBeGreaterThanOrEqual(2);
  });
  it("suspends client sign-in and restores it when the owner enables access", async () => {
    const path = `platform/companies/${companyId}/status`;
    expect(
      (
        await call(f, path, "POST", "root", {
          status: "SUSPENDED",
          reason: "Integration check",
        })
      ).status,
    ).toBe(200);
    expect((await f.login("admin", companyId, adminEmail)).status).toBe(403);
    expect(
      (await call(f, path, "POST", "root", { status: "ACTIVE" })).status,
    ).toBe(200);
    expect((await f.login("admin", companyId, adminEmail)).status).toBe(200);
  });
});
