import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture, password } from "./helpers";

const f = new Fixture();
let companyId = "";
let ownerEmail = "";
let clientEmail = "";
beforeAll(async () => {
  const provider = await f.company("P");
  const client = await f.company("C");
  companyId = client.id;
  ownerEmail = (
    await f.user("owner", provider.id, "Super Admin", { superAdmin: true })
  ).email;
  clientEmail = (await f.user("client", client.id, "Company Admin")).email;
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("software owner", () => {
  it("loads every owner dashboard data source", async () => {
    for (const route of [
      "overview",
      "companies",
      "plans",
      "add-ons",
      "coupons",
      "invoices",
      "tickets",
      "backups",
      "audit",
    ]) {
      const result = await call(f, `platform/${route}`, "GET", "owner");
      expect(result.status, `${route}: ${JSON.stringify(result.body)}`).toBe(
        200,
      );
    }
  });
  it("allows owner sign-in without a company code and rejects client credentials", async () => {
    const owner = await call(f, "auth/owner-login", "POST", "", {
      identifier: ownerEmail,
      password,
    });
    expect(owner.status).toBe(200);
    expect(owner.headers.getSetCookie().join(";")).toContain("hrms_access");
    const denied = await call(f, "auth/owner-login", "POST", "", {
      identifier: clientEmail,
      password,
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.getSetCookie()).toHaveLength(0);
    expect((await call(f, "platform/companies", "GET", "client")).status).toBe(
      403,
    );
  });

  it("enforces per-client rights and restores plan defaults without changing the plan", async () => {
    const before = await db.subscription.findUniqueOrThrow({
      where: { companyId },
      include: { plan: true },
    });
    const route = `platform/companies/${companyId}/rights`;
    expect(
      (
        await call(f, route, "PUT", "client", {
          enabledFeatures: [],
          disabledFeatures: ["reports"],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(f, route, "PUT", "owner", {
          enabledFeatures: ["reports"],
          disabledFeatures: ["reports"],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, route, "PUT", "owner", {
          enabledFeatures: ["invented"],
          disabledFeatures: [],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, route, "PUT", "owner", {
          enabledFeatures: [],
          disabledFeatures: ["reports"],
        })
      ).status,
    ).toBe(200);
    expect((await call(f, "dashboard", "GET", "client")).status).toBe(402);
    expect(
      (
        await call(f, route, "PUT", "owner", {
          enabledFeatures: ["reports"],
          disabledFeatures: [],
        })
      ).status,
    ).toBe(200);
    expect((await call(f, "dashboard", "GET", "client")).status).toBe(200);
    expect(
      (
        await call(f, route, "PUT", "owner", {
          enabledFeatures: [],
          disabledFeatures: [],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await db.subscriptionPlan.findUniqueOrThrow({
          where: { id: before.planId },
        })
      ).features,
    ).toEqual(before.plan.features);
    expect(
      await db.auditLog.count({
        where: { module: "client_rights", recordId: companyId },
      }),
    ).toBe(3);
  });
});
