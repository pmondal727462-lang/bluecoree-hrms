import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 17: data retention with safeguards, and a cross-tenant sweep over
// the record endpoints added in Phases 7-15 (OWASP A01).
const f = new Fixture();
let a = "";
let b = "";
const old = (days: number) => new Date(Date.now() - days * 86400000);

beforeAll(async () => {
  a = (await f.company("A")).id;
  b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("leaver", a, "Employee", { login: false });
  await f.user("other", b, "Company Admin");
});
afterAll(async () => {
  const where = { companyId: { in: f.companies } };
  await db.retentionRun.deleteMany({ where });
  await db.retentionPolicy.deleteMany({ where });
  await db.exitSettlement.deleteMany({ where });
  await db.offer.deleteMany({ where });
  await db.jobOpening.deleteMany({ where });
  await db.assetAssignment.deleteMany({ where });
  await db.asset.deleteMany({ where });
  await db.trainingSession.deleteMany({ where });
  await db.course.deleteMany({ where });
  await db.employeeLoan.deleteMany({ where });
  await db.payrollRun.deleteMany({ where });
  await db.invoice.deleteMany({ where });
  await db.performanceReview.deleteMany({ where });
  await db.reviewCycle.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 17 data retention", () => {
  it("refuses short periods, previews, needs confirmation and respects scope", async () => {
    expect((await call(f, "security/retention", "GET", "staff")).status).toBe(
      403,
    );
    expect(
      (
        await call(f, "security/retention", "PUT", "admin", {
          category: "login_history",
          retainDays: 30,
          enabled: true,
        })
      ).body.errorCode,
    ).toBe("RETENTION_TOO_SHORT");
    await db.loginHistory.createMany({
      data: [
        { companyId: a, channel: "WEB", success: true, createdAt: old(200) },
        { companyId: a, channel: "WEB", success: true, createdAt: old(10) },
        { companyId: b, channel: "WEB", success: true, createdAt: old(200) },
      ],
    });
    // Nothing runs until a policy is enabled.
    expect(
      (
        await call(f, "security/retention/run", "POST", "admin", {
          category: "login_history",
        })
      ).body.errorCode,
    ).toBe("RETENTION_DISABLED");
    await call(f, "security/retention", "PUT", "admin", {
      category: "login_history",
      retainDays: 90,
      enabled: true,
    });
    const view = (await call(f, "security/retention", "GET", "admin")).body
      .data;
    expect(
      view.policies.find(
        (p: { category: string }) => p.category === "login_history",
      ),
    ).toMatchObject({ enabled: true, wouldAffect: 1, minimumDays: 90 });
    expect(
      (
        await call(f, "security/retention/run", "POST", "admin", {
          category: "login_history",
          dryRun: false,
        })
      ).body.errorCode,
    ).toBe("CONFIRMATION_REQUIRED");
    const done = await call(f, "security/retention/run", "POST", "admin", {
      category: "login_history",
      dryRun: false,
      confirm: true,
    });
    expect(done.body.data.affected).toBe(1);
    // The recent row and the other company's old row remain.
    expect(
      await db.loginHistory.count({
        where: { companyId: a, createdAt: { lt: old(90) } },
      }),
    ).toBe(0);
    expect(
      await db.loginHistory.count({
        where: { companyId: a, createdAt: { gte: old(11) } },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await db.loginHistory.count({
        where: { companyId: b, createdAt: { lt: old(90) } },
      }),
    ).toBe(1);
  });

  it("anonymises old applications and leavers, and stops under a legal hold", async () => {
    const job = await db.jobOpening.create({
      data: {
        companyId: a,
        title: "Clerk",
        description: "x",
        status: "CLOSED",
        createdBy: f.users.admin,
      },
    });
    await db.candidate.createMany({
      data: [
        {
          companyId: a,
          jobId: job.id,
          name: "Rejected Person",
          email: "rej@example.com",
          phone: "999",
          stage: "REJECTED",
          updatedAt: old(60),
          resumeData: Buffer.from("cv"),
        },
        {
          companyId: a,
          jobId: job.id,
          name: "Hired Person",
          email: "hired@example.com",
          stage: "HIRED",
          updatedAt: old(60),
        },
      ],
    });
    await db.employee.update({
      where: { id: f.employees.leaver },
      data: {
        status: "Inactive",
        mobile: "9876543210",
        personalEmail: "leaver@home.example",
      },
    });
    await db.exitSettlement.create({
      data: {
        companyId: a,
        employeeId: f.employees.leaver,
        exitType: "RESIGNATION",
        lastWorkingDay: old(800),
      },
    });
    for (const [category, retainDays] of [
      ["applications", 30],
      ["exited_employees", 730],
    ] as const)
      await call(f, "security/retention", "PUT", "admin", {
        category,
        retainDays,
        enabled: true,
      });
    // A legal hold blocks removal but allows a preview.
    await call(f, "security/retention/legal-hold", "PUT", "admin", {
      enabled: true,
      reason: "Pending dispute",
    });
    const blocked = await call(f, "security/retention/run", "POST", "admin", {
      category: "applications",
      dryRun: false,
      confirm: true,
    });
    expect(blocked.body.errorCode).toBe("LEGAL_HOLD");
    expect(
      (
        await call(f, "security/retention/run", "POST", "admin", {
          category: "applications",
        })
      ).body.data.affected,
    ).toBe(1);
    await call(f, "security/retention/legal-hold", "PUT", "admin", {
      enabled: false,
      reason: "Dispute settled",
    });
    for (const category of ["applications", "exited_employees"])
      await call(f, "security/retention/run", "POST", "admin", {
        category,
        dryRun: false,
        confirm: true,
      });
    const people = await db.candidate.findMany({
      where: { jobId: job.id },
      orderBy: { stage: "asc" },
    });
    expect(people.map((p) => [p.stage, p.name, p.phone, p.resumeData])).toEqual(
      [
        ["HIRED", "Hired Person", null, null],
        ["REJECTED", "Removed applicant", null, null],
      ],
    );
    const leaver = await db.employee.findUniqueOrThrow({
      where: { id: f.employees.leaver },
    });
    expect(leaver).toMatchObject({
      mobile: null,
      personalEmail: null,
      firstName: "leaver",
    });
    const audit = await db.auditLog.findFirst({
      where: { companyId: a, action: "RETENTION_RUN" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("Phase 17 cross-tenant sweep", () => {
  it("returns 404 for another company's records on every new detail endpoint", async () => {
    const run = await db.payrollRun.create({
      data: { companyId: a, period: "2025-01", createdBy: f.users.admin },
    });
    const loan = await db.employeeLoan.create({
      data: {
        companyId: a,
        employeeId: f.employees.staff,
        kind: "LOAN",
        principal: 1000,
        instalment: 100,
        balance: 1000,
        startPeriod: "2025-01",
        createdBy: f.users.admin,
      },
    });
    const job = await db.jobOpening.create({
      data: {
        companyId: a,
        title: "Dev",
        description: "x",
        status: "OPEN",
        createdBy: f.users.admin,
      },
    });
    const cand = await db.candidate.create({
      data: { companyId: a, jobId: job.id, name: "C", email: "c@example.com" },
    });
    const offer = await db.offer.create({
      data: {
        companyId: a,
        candidateId: cand.id,
        annualCtc: 1,
        joiningDate: new Date("2027-01-01"),
        expiresOn: new Date("2026-12-01"),
        createdBy: f.users.admin,
      },
    });
    const asset = await db.asset.create({
      data: {
        companyId: a,
        assetCode: "X1",
        category: "LAPTOP",
        name: "L",
        createdBy: f.users.admin,
      },
    });
    const course = await db.course.create({
      data: { companyId: a, code: "C1", title: "T", createdBy: f.users.admin },
    });
    const session = await db.trainingSession.create({
      data: {
        companyId: a,
        courseId: course.id,
        startsAt: new Date("2027-01-01T04:00:00Z"),
        endsAt: new Date("2027-01-01T06:00:00Z"),
        createdBy: f.users.admin,
      },
    });
    const cycle = await db.reviewCycle.create({
      data: {
        companyId: a,
        name: "C",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-06-30"),
        status: "ACTIVE",
      },
    });
    const review = await db.performanceReview.create({
      data: { companyId: a, cycleId: cycle.id, employeeId: f.employees.staff },
    });
    const invoice = await db.invoice.create({
      data: {
        companyId: a,
        number: `INV/TEST/${f.prefix}`,
        planCode: "X",
        billingCycle: "MONTHLY",
        periodStart: new Date(),
        periodEnd: new Date(),
        lines: { items: [], purchase: {} },
        subtotal: 0,
        taxRate: 18,
        total: 0,
        billingName: "A",
        dueDate: new Date(),
      },
    });
    const probes: [string, string][] = [
      ["GET", `payroll/runs/${run.id}`],
      ["GET", `payroll/loans/${loan.id}`],
      ["GET", `recruitment/offers/${offer.id}`],
      ["GET", `recruitment/candidates/${cand.id}`],
      ["GET", `assets/${asset.id}`],
      ["GET", `training/sessions/${session.id}/enrollments`],
      ["GET", `performance/reviews/${review.id}`],
      ["GET", `subscription/invoices/${invoice.id}/pdf`],
      ["POST", `payroll/runs/${run.id}/submit`],
      ["POST", `assets/${asset.id}/assign`],
    ];
    for (const [method, path] of probes) {
      const r = await call(
        f,
        path,
        method,
        "other",
        method === "POST" ? {} : undefined,
      );
      expect(
        [403, 404, 422].includes(r.status),
        `${method} ${path} → ${r.status}`,
      ).toBe(true);
      expect(JSON.stringify(r.body)).not.toContain(f.employees.staff);
    }
    // A GET for a loan list across tenants returns nothing from company A.
    const loans = (await call(f, "payroll/loans", "GET", "other")).body.data;
    expect(loans.map((l: { id: string }) => l.id)).not.toContain(loan.id);
  });
});
