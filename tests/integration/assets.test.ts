import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 11: asset register, issue/return with condition and warranty,
// exit clearance, and the two-level expense approval.
const f = new Fixture();
let a = "";
let laptop = "";

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("hr", a, "HR Manager");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("solo", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  const where = { companyId: { in: f.companies } };
  await db.assetAssignment.deleteMany({ where });
  await db.asset.deleteMany({ where });
  await db.exitSettlement.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 11 assets", () => {
  it("keeps an asset register for HR only", async () => {
    const body = {
      assetCode: "LT-001",
      category: "LAPTOP",
      name: "ThinkPad T14",
      brand: "Lenovo",
      serialNumber: "PF-12345",
      cost: 85000,
      purchaseDate: "2026-01-10",
      warrantyUntil: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      condition: "NEW",
    };
    expect((await call(f, "assets", "POST", "staff", body)).status).toBe(403);
    laptop = (await call(f, "assets", "POST", "hr", body)).body.data.id;
    expect((await call(f, "assets", "POST", "hr", body)).status).toBe(409);
    expect(
      (
        await call(f, "assets", "POST", "hr", {
          ...body,
          assetCode: "LT-002",
          warrantyUntil: "2025-01-01",
        })
      ).status,
    ).toBe(422);
    await call(f, "assets", "POST", "hr", {
      assetCode: "SIM-01",
      category: "SIM",
      name: "Jio SIM",
    });
    expect(
      (await call(f, "assets?warrantyWithin=60", "GET", "hr")).body.data.map(
        (x: { assetCode: string }) => x.assetCode,
      ),
    ).toEqual(["LT-001"]);
    expect(
      (await call(f, "assets?q=pf-123", "GET", "hr")).body.data,
    ).toHaveLength(1);
    expect((await call(f, "assets", "GET", "other")).body.data).toHaveLength(0);
    expect((await call(f, `assets/${laptop}`, "GET", "other")).status).toBe(
      404,
    );
  });

  it("issues and returns assets with condition and history", async () => {
    expect(
      (
        await call(f, `assets/${laptop}/assign`, "POST", "hr", {
          employeeId: f.employees.other,
          issuedOn: "2026-09-01",
        })
      ).status,
    ).toBe(404);
    const issued = await call(f, `assets/${laptop}/assign`, "POST", "hr", {
      employeeId: f.employees.staff,
      issuedOn: "2026-09-01",
    });
    expect(issued.body.data.issueCondition).toBe("NEW");
    const again = await call(f, `assets/${laptop}/assign`, "POST", "hr", {
      employeeId: f.employees.solo,
      issuedOn: "2026-09-02",
    });
    expect(again.body.errorCode).toBe("ASSET_UNAVAILABLE");
    const mine = (await call(f, "assets/mine", "GET", "staff")).body.data;
    expect(mine).toHaveLength(1);
    expect(
      (
        await call(
          f,
          `assets/assignments/${mine[0].id}/acknowledge`,
          "POST",
          "solo",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          f,
          `assets/assignments/${mine[0].id}/acknowledge`,
          "POST",
          "staff",
        )
      ).body.data.acknowledgedAt,
    ).toBeTruthy();
    expect(
      (
        await call(f, `assets/${laptop}/status`, "POST", "hr", {
          status: "RETIRED",
          note: "Old",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(f, `assets/${laptop}/return`, "POST", "hr", {
          returnedOn: "2026-08-01",
          condition: "GOOD",
        })
      ).status,
    ).toBe(422);
    await call(f, `assets/${laptop}/return`, "POST", "hr", {
      returnedOn: "2026-09-20",
      condition: "DAMAGED",
      notes: "Cracked screen",
    });
    const detail = (await call(f, `assets/${laptop}`, "GET", "hr")).body.data;
    expect(detail).toMatchObject({ status: "IN_REPAIR", condition: "DAMAGED" });
    expect(detail.history[0]).toMatchObject({
      issueCondition: "NEW",
      returnCondition: "DAMAGED",
    });
    // Repaired, back in stock, then issued again.
    await call(f, `assets/${laptop}/status`, "POST", "hr", {
      status: "IN_STOCK",
      note: "Screen replaced",
    });
    expect(
      (
        await call(f, `assets/${laptop}/assign`, "POST", "hr", {
          employeeId: f.employees.solo,
          issuedOn: "2026-09-21",
          condition: "GOOD",
        })
      ).status,
    ).toBe(200);
  });

  it("blocks final settlement while assets are outstanding", async () => {
    await db.employee.update({
      where: { id: f.employees.solo },
      data: { status: "On notice" },
    });
    await db.exitSettlement.create({
      data: {
        companyId: a,
        employeeId: f.employees.solo,
        exitType: "RESIGNATION",
        lastWorkingDay: new Date("2026-09-30"),
      },
    });
    const blocked = await call(
      f,
      `employees/${f.employees.solo}/settlement/approve`,
      "POST",
      "admin",
    );
    expect(blocked.body.errorCode).toBe("ASSETS_OUTSTANDING");
    // Reporting the asset lost clears the hold and closes the assignment.
    await call(f, `assets/${laptop}/status`, "POST", "hr", {
      status: "LOST",
      note: "Not returned at exit; cost recovered",
    });
    const held = await db.assetAssignment.count({
      where: { employeeId: f.employees.solo, returnedOn: null },
    });
    expect(held).toBe(0);
    const after = await call(
      f,
      `employees/${f.employees.solo}/settlement/approve`,
      "POST",
      "admin",
    );
    expect(after.body.errorCode).not.toBe("ASSETS_OUTSTANDING");
  });
});

describe("Phase 11 expenses", () => {
  it("routes claims employee → manager → finance → paid", async () => {
    const added = await call(
      f,
      "expenses/categories/defaults",
      "POST",
      "admin",
    );
    expect(added.body.data.added).toEqual([
      "Travel",
      "Food",
      "Hotel",
      "Fuel",
      "Mobile",
      "Other",
    ]);
    expect(
      (await call(f, "expenses/categories/defaults", "POST", "admin")).body.data
        .added,
    ).toEqual([]);
    const cat = await db.expenseCategory.findFirstOrThrow({
      where: { companyId: a, name: "Mobile" },
    });
    const claim = async (who: string) =>
      (
        await call(f, "expenses/claims", "POST", who, {
          categoryId: cat.id,
          expenseDate: "2026-09-10",
          amount: 499,
          description: "Monthly phone bill",
        })
      ).body.data.id;
    const id = await claim("staff");
    // Finance cannot skip the manager.
    const skip = await call(f, `expenses/claims/${id}`, "PUT", "admin", {
      action: "approve",
    });
    expect(skip.body.errorCode).toBe("MANAGER_FIRST");
    const first = await call(f, `expenses/claims/${id}`, "PUT", "manager", {
      action: "approve",
      note: "Business use",
    });
    expect(first.body.data.status).toBe("MANAGER_APPROVED");
    const second = await call(f, `expenses/claims/${id}`, "PUT", "admin", {
      action: "approve",
    });
    expect(second.body.data.status).toBe("APPROVED");
    const paid = await call(f, `expenses/claims/${id}`, "PUT", "admin", {
      action: "reimburse",
    });
    expect(paid.body).toMatchObject({ data: { status: "REIMBURSED" } });

    // Without an approving manager, finance approves directly.
    const direct = await claim("solo");
    expect(
      (
        await call(f, `expenses/claims/${direct}`, "PUT", "admin", {
          action: "approve",
        })
      ).body.data.status,
    ).toBe("APPROVED");
    // Finance can reject at its stage; the employee cannot cancel after it.
    const rejected = await claim("staff");
    await call(f, `expenses/claims/${rejected}`, "PUT", "manager", {
      action: "approve",
    });
    expect(
      (
        await call(f, `expenses/claims/${rejected}`, "PUT", "admin", {
          action: "reject",
          note: "Personal number",
        })
      ).body.data.status,
    ).toBe("REJECTED");
  });
});
