import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";
const f = new Fixture();
let companyId = "",
  spare = "";
const subscription = {
  planCode: "BASIC",
  status: "ACTIVE",
  trialEndsAt: null,
  currentPeriodEnd: null,
  graceDays: 7,
  employeeLimit: 50,
};
const employee = (code: string) => ({
  employeeCode: code,
  firstName: "Licence",
  lastName: code,
  officialEmail: `${code.toLowerCase()}@example.com`,
  joinedAt: "2026-01-01",
  status: "Active",
});
beforeAll(async () => {
  companyId = (await f.company("CLIENT")).id;
  await f.user("admin", companyId, "Company Admin");
  await f.user("staff", companyId, "Employee");
  await f.user("root", (await f.company("OWNER")).id, "Company Admin", {
    superAdmin: true,
  });
  await db.employee.createMany({
    data: Array.from({ length: 48 }, (_, i) => ({
      ...employee(`EMP${i}`),
      companyId,
      joinedAt: new Date("2026-01-01"),
    })),
  });
  spare = (
    await db.employee.findFirstOrThrow({
      where: { companyId, employeeCode: "EMP0" },
    })
  ).id;
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});
describe("per-client purchased employee capacity", () => {
  it("allows only Management to set a client-specific 50-employee limit", async () => {
    expect(
      (
        await call(
          f,
          `platform/subscriptions/${companyId}`,
          "PUT",
          "admin",
          subscription,
        )
      ).status,
    ).toBe(403);
    const saved = await call(
      f,
      `platform/subscriptions/${companyId}`,
      "PUT",
      "root",
      subscription,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.employeeLimit).toBe(50);
    const current = (await call(f, "subscription", "GET", "admin")).body.data
      .current;
    expect(current.limits.employees).toBe(50);
    expect(current.usage.employees).toBe(50);
  });
  it("blocks the 51st active employee without leaving a saved record", async () => {
    const result = await call(
      f,
      "employees",
      "POST",
      "admin",
      employee("OVER51"),
    );
    expect(result.status, JSON.stringify(result.body)).toBe(402);
    expect(
      await db.employee.count({ where: { companyId, employeeCode: "OVER51" } }),
    ).toBe(0);
  });
  it("reuses inactive seats and permits only one concurrent addition at the limit", async () => {
    expect(
      (
        await call(f, `employees/${spare}`, "PUT", "admin", {
          status: "Inactive",
        })
      ).status,
    ).toBe(200);
    const attempts = await Promise.all([
      call(f, "employees", "POST", "admin", employee("RACE1")),
      call(f, "employees", "POST", "admin", employee("RACE2")),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 402]);
    expect(
      (
        await call(f, `employees/${spare}`, "PUT", "admin", {
          status: "Active",
        })
      ).status,
    ).toBe(402);
    expect(
      await db.employee.count({
        where: { companyId, status: { not: "Inactive" } },
      }),
    ).toBe(50);
    expect(
      (
        await call(f, `platform/subscriptions/${companyId}`, "PUT", "root", {
          ...subscription,
          employeeLimit: 49,
        })
      ).status,
    ).toBe(422);
  });
  it("hides unpurchased home modules and enforces direct API restrictions", async () => {
    const home = await call(f, "home", "GET", "staff");
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    expect(home.body.data).toMatchObject({
      payslip: null,
      expenses: null,
      training: null,
      pendingSelfReviews: null,
    });
    expect((await call(f, "payroll/payslips", "GET", "staff")).status).toBe(
      402,
    );
    expect((await call(f, "expenses/claims", "GET", "staff")).status).toBe(402);
    expect(
      (
        await call(
          f,
          "time/rosters?from=2026-09-14&to=2026-09-20",
          "GET",
          "admin",
        )
      ).status,
    ).toBe(402);
    const setup = await call(f, "setup-progress", "GET", "admin");
    expect(
      setup.body.data.steps.some((s: { key: string }) => s.key === "payroll"),
    ).toBe(false);
  });
});
