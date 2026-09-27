import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { runTask } from "../../src/jobs/tasks";
import { Fixture } from "./helpers";

// Phase 18: scheduled tasks run once per period and only touch their data.
const f = new Fixture();
let a = "";
const day = 86400000;
const utcToday = () => new Date(new Date().toISOString().slice(0, 10));

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee", { login: false });
});
afterAll(async () => {
  const where = { companyId: { in: f.companies } };
  await db.payment.deleteMany({ where });
  await db.invoice.deleteMany({ where });
  await db.document.deleteMany({ where });
  await db.notification.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 18 scheduled jobs", () => {
  it("sends document expiry notices on the 30, 7 and 1 day marks", async () => {
    await db.document.createMany({
      data: [
        {
          companyId: a,
          employeeId: f.employees.staff,
          title: "Passport",
          category: "ID_PROOF",
          expiresOn: new Date(utcToday().getTime() + 7 * day),
          uploadedBy: f.users.admin,
        },
        {
          companyId: a,
          employeeId: f.employees.staff,
          title: "Licence",
          category: "ID_PROOF",
          expiresOn: new Date(utcToday().getTime() + 8 * day),
          uploadedBy: f.users.admin,
        },
      ],
    });
    await runTask("document-expiry");
    const notes = await db.notification.findMany({
      where: { companyId: a, event: "document.expiring" },
    });
    expect(notes.map((n) => n.title)).toContain("Document expiring: Passport");
    expect(notes.map((n) => n.title)).not.toContain(
      "Document expiring: Licence",
    );
    // Both the employee and HR are told.
    expect(new Set(notes.map((n) => n.userId))).toEqual(
      new Set([f.users.staff, f.users.admin]),
    );
  });

  it("greets birthdays once a day", async () => {
    const now = new Date();
    await db.employee.update({
      where: { id: f.employees.staff },
      data: {
        dateOfBirth: new Date(
          Date.UTC(1990, now.getUTCMonth(), now.getUTCDate()),
        ),
      },
    });
    await runTask("greetings");
    await runTask("greetings");
    expect(
      await db.notification.count({
        where: { companyId: a, userId: f.users.staff, event: "birthday" },
      }),
    ).toBe(1);
  });

  it("closes online payment orders left unfinished for a week", async () => {
    const invoice = await db.invoice.create({
      data: {
        companyId: a,
        number: `INV/JOB/${f.prefix}`,
        planCode: "X",
        billingCycle: "MONTHLY",
        periodStart: new Date(),
        periodEnd: new Date(),
        lines: { items: [], purchase: {} },
        subtotal: 100,
        taxRate: 18,
        total: 118,
        billingName: "A",
        dueDate: new Date(),
      },
    });
    const [stale, fresh] = await Promise.all([
      db.payment.create({
        data: {
          companyId: a,
          invoiceId: invoice.id,
          provider: "RAZORPAY",
          providerOrderId: `order_old_${f.prefix}`,
          amount: 118,
          createdAt: new Date(Date.now() - 8 * day),
        },
      }),
      db.payment.create({
        data: {
          companyId: a,
          invoiceId: invoice.id,
          provider: "RAZORPAY",
          providerOrderId: `order_new_${f.prefix}`,
          amount: 118,
        },
      }),
    ]);
    await runTask("stale-payments");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: stale.id } })).status,
    ).toBe("FAILED");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: fresh.id } })).status,
    ).toBe("CREATED");
  });

  it("refuses unknown jobs", async () => {
    await expect(runTask("nope")).rejects.toThrow(/Unknown job/);
  });
});
