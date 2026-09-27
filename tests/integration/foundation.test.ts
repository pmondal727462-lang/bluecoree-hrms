import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture, password, png } from "./helpers";

const f = new Fixture();
let a = "",
  b = "",
  bEmail = "";
beforeAll(async () => {
  a = (await f.company("A")).id;
  b = (await f.company("B")).id;
  await f.user("root", a, "Super Admin", { superAdmin: true });
  await f.user("owner", a, "Company Owner");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee", {
    managerOf: "admin",
    joinedAt: "2019-01-01",
  });
  await f.user("saas", a, "SaaS Admin");
  bEmail = (await f.user("other", b, "Company Admin")).email;
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("Roles and company settings", () => {
  it("provisions owner and SaaS roles with the expected reach", async () => {
    const owner = (await call(f, "auth/me", "GET", "owner")).body.data;
    expect(owner.permissions).toEqual(
      expect.arrayContaining([
        "payroll.manage",
        "security.manage",
        "company.write",
      ]),
    );
    // SaaS Admin outside the provider company has no platform access.
    const saas = (await call(f, "auth/me", "GET", "saas")).body.data;
    expect(saas.platformRole).toBeNull();
    expect((await call(f, "platform/overview", "GET", "saas")).status).toBe(
      403,
    );
    expect(
      (await call(f, "auth/me", "GET", "root")).body.data.platformRole,
    ).toBe("super");
  });
  it("stores registration details, preferences and a validated logo", async () => {
    const body = {
      legalName: "Test A Private Limited",
      city: "Kolkata",
      state: "West Bengal",
      pinCode: "700001",
      country: "India",
      currency: "inr",
      dateFormat: "DD/MM/YYYY",
      financialYearStartMonth: 4,
      payrollCycle: "MONTHLY",
      payrollCutoffDay: 25,
    };
    expect(
      (await call(f, "company/settings", "PUT", "staff", body)).status,
    ).toBe(403);
    const saved = await call(f, "company/settings", "PUT", "admin", body);
    expect(saved.body.data.currency).toBe("INR");
    expect(
      (await call(f, "company/settings", "GET", "other")).body.data.legalName,
    ).toBeNull();
    expect(
      (
        await call(f, "company/settings/logo", "POST", "admin", {
          dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, "company/settings/logo", "POST", "admin", {
          dataUrl: png,
        })
      ).status,
    ).toBe(200);
    const logo = await call(f, "company/settings/logo", "GET", "staff");
    expect(logo.headers.get("content-type")).toBe("image/png");
  });
});

describe("Employee lifecycle", () => {
  it("records joining and field changes as history", async () => {
    const created = await call(f, "employees", "POST", "admin", {
      employeeCode: "NEW-1",
      firstName: "New",
      lastName: "Joiner",
      officialEmail: "new.joiner@example.com",
      joinedAt: "2026-01-05",
      status: "Probation",
    });
    const id = created.body.data.id;
    const history = await call(f, `employees/${id}/history`, "GET", "admin");
    expect(
      history.body.data.map((h: { eventType: string }) => h.eventType),
    ).toEqual(["JOINED"]);
    const designation = await db.designation.findFirstOrThrow({
      where: { companyId: a },
    });
    const confirm = await call(
      f,
      `employees/${id}/lifecycle`,
      "POST",
      "admin",
      { eventType: "CONFIRMATION", effectiveDate: "2026-07-05" },
    );
    expect(confirm.body.data.status).toBe("Active");
    await call(f, `employees/${id}/lifecycle`, "POST", "admin", {
      eventType: "PROMOTION",
      effectiveDate: "2026-08-01",
      designationId: designation.id,
    });
    const events = (
      await call(f, `employees/${id}/history`, "GET", "admin")
    ).body.data.map((h: { eventType: string }) => h.eventType);
    expect(events).toEqual(
      expect.arrayContaining(["JOINED", "CONFIRMATION", "PROMOTION"]),
    );
    expect(
      (await call(f, `employees/${id}/history`, "GET", "other")).status,
    ).toBe(404);
    expect(
      (
        await call(f, `employees/${id}/lifecycle`, "POST", "staff", {
          eventType: "PROMOTION",
          effectiveDate: "2026-08-01",
          designationId: designation.id,
        })
      ).status,
    ).toBe(403);
  });
  it("calculates full & final settlement and completes the exit", async () => {
    const staff = f.employees.staff;
    await call(f, `payroll/structures/${staff}`, "PUT", "admin", {
      basic: 30000,
      hra: 10000,
      pfApplicable: true,
      esiApplicable: false,
      ptApplicable: false,
      taxRegime: "NEW",
      effectiveFrom: "2026-04-01",
    });
    expect(
      (
        await call(
          f,
          `employees/${f.employees.owner}/lifecycle`,
          "POST",
          "admin",
          {
            eventType: "RESIGNATION",
            effectiveDate: "2026-09-01",
            lastWorkingDay: "2026-09-20",
          },
        )
      ).status,
    ).toBe(409);
    const resigned = await call(
      f,
      `employees/${staff}/lifecycle`,
      "POST",
      "admin",
      {
        eventType: "RESIGNATION",
        effectiveDate: "2026-09-01",
        lastWorkingDay: "2026-09-20",
        reason: "Higher studies",
      },
    );
    expect(resigned.body.data.status).toBe("On notice");
    const s = (await call(f, `employees/${staff}/settlement`, "GET", "admin"))
      .body.data;
    // 20 of 30 days of ₹40,000; gratuity 15/26 × 30,000 × 8 years; 11 notice days short.
    expect(s.pendingSalary).toBe(26667);
    expect(s.gratuity).toBe(138462);
    expect(s.noticeRecovery).toBe(14667);
    expect(s.netPayable).toBe(26667 + 138462 - 14667);
    expect(
      (await call(f, `employees/${staff}/settlement`, "GET", "other")).status,
    ).toBe(404);
    const waived = await call(
      f,
      `employees/${staff}/settlement`,
      "PUT",
      "admin",
      {
        leaveEncashment: 5000,
        otherEarnings: 0,
        otherDeductions: 1000,
        noticeServedDays: 19,
        waiveNoticeRecovery: true,
      },
    );
    expect(waived.body.data.netPayable).toBe(26667 + 138462 + 5000 - 1000);
    expect(
      (await call(f, `employees/${staff}/settlement/approve`, "POST", "admin"))
        .body.data.status,
    ).toBe("APPROVED");
    expect(
      (
        await call(f, `employees/${staff}/settlement`, "PUT", "admin", {
          leaveEncashment: 1,
          otherEarnings: 0,
          otherDeductions: 0,
          noticeServedDays: 0,
          waiveNoticeRecovery: false,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(f, `employees/${staff}/settlement/paid`, "POST", "admin"))
        .body.data.status,
    ).toBe("PAID");
    const exit = await call(
      f,
      `employees/${staff}/lifecycle`,
      "POST",
      "admin",
      { eventType: "EXIT", effectiveDate: "2026-09-20" },
    );
    expect(exit.body.data.status).toBe("Inactive");
    expect((await call(f, "auth/me", "GET", "staff")).status).toBe(401);
  });
});

describe("Super Admin company controls", () => {
  it("suspends and reactivates a company without touching its data", async () => {
    expect(
      (
        await call(f, `platform/companies/${b}/status`, "POST", "admin", {
          status: "SUSPENDED",
        })
      ).status,
    ).toBe(403);
    const suspended = await call(
      f,
      `platform/companies/${b}/status`,
      "POST",
      "root",
      { status: "SUSPENDED", reason: "Unpaid invoice" },
    );
    expect(suspended.body.data.status).toBe("SUSPENDED");
    expect((await call(f, "auth/me", "GET", "other")).status).toBe(401);
    const blocked = await f.login("other", b, bEmail);
    expect(blocked.status).toBe(403);
    expect(blocked.body.errorCode).toBe("COMPANY_SUSPENDED");
    expect(await db.employee.count({ where: { companyId: b } })).toBe(1);
    await call(f, `platform/companies/${b}/status`, "POST", "root", {
      status: "ACTIVE",
    });
    expect((await f.login("other", b, bEmail)).status).toBe(200);
    const list = (await call(f, "platform/companies", "GET", "root")).body.data;
    expect(
      list.find((c: { id: string }) => c.id === b).lastLoginAt,
    ).toBeTruthy();
  });
  it("extends trials and issues a one-time access reset link", async () => {
    const before = (
      await db.subscription.findUniqueOrThrow({ where: { companyId: b } })
    ).trialEndsAt!;
    const extended = await call(
      f,
      `platform/companies/${b}/extend-trial`,
      "POST",
      "root",
      { days: 10 },
    );
    expect(
      new Date(extended.body.data.trialEndsAt).getTime() - before.getTime(),
    ).toBe(10 * 86400000);
    const reset = await call(
      f,
      `platform/companies/${b}/reset-access`,
      "POST",
      "root",
      {},
    );
    const url = new URL(reset.body.data.resetUrl);
    expect((await call(f, "auth/me", "GET", "other")).status).toBe(401);
    const redeemed = await call(f, "auth/reset-password", "POST", "", {
      challengeId: url.searchParams.get("id"),
      token: url.searchParams.get("token"),
      newPassword: "Brand-New-Password-456!",
    });
    expect(redeemed.status).toBe(200);
    expect(
      (await f.login("other", b, bEmail, "Brand-New-Password-456!")).status,
    ).toBe(200);
    expect((await f.login("other", b, bEmail, password)).status).toBe(401);
    await f.login("other", b, bEmail, "Brand-New-Password-456!");
  });
});

describe("Provider support desk", () => {
  it("lets companies raise tickets and keeps provider notes internal", async () => {
    const attachment = {
      name: "error.png",
      type: "image/png",
      base64: png.split(",")[1],
    };
    const created = await call(f, "support/tickets", "POST", "admin", {
      subject: "Cannot export payroll",
      category: "TECHNICAL",
      priority: "HIGH",
      body: "The export button fails.",
      attachment,
    });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect(
      (await call(f, `support/tickets/${id}`, "GET", "other")).status,
    ).toBe(404);
    expect(
      (await call(f, `platform/tickets/${id}`, "GET", "admin")).status,
    ).toBe(403);
    await call(f, `platform/tickets/${id}/messages`, "POST", "root", {
      body: "Escalated to engineering.",
      internal: true,
    });
    await call(f, `platform/tickets/${id}/messages`, "POST", "root", {
      body: "Fixed; please retry.",
    });
    const seen = (await call(f, `support/tickets/${id}`, "GET", "admin")).body
      .data;
    const bodies = seen.messages.map((m: { body: string }) => m.body);
    expect(bodies).toContain("Fixed; please retry.");
    expect(bodies).not.toContain("Escalated to engineering.");
    expect(seen.status).toBe("WAITING_ON_CUSTOMER");
    const first = seen.messages[0];
    const file = await call(
      f,
      `support/attachments/${first.id}`,
      "GET",
      "admin",
    );
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(
      (await call(f, `support/attachments/${first.id}`, "GET", "other")).status,
    ).toBe(404);
    const desk = (await call(f, "platform/tickets", "GET", "root")).body.data;
    expect(desk.some((t: { id: string }) => t.id === id)).toBe(true);
    const health = (await call(f, "platform/health", "GET", "root")).body.data
      .checks;
    expect(
      health.find((c: { component: string }) => c.component === "database")
        .status,
    ).toBe("UP");
  });
});
