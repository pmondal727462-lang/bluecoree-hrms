import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";
import { provisionSubscription } from "../../src/modules/saas/service";

const f = new Fixture();
let a = "",
  b = "";
beforeAll(async () => {
  a = (await f.company("A")).id;
  b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("other", b, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("Foundation hardening", () => {
  it("rejects cross-tenant document relationships at the database boundary", async () => {
    const data = {
      companyId: a,
      title: "Private document",
      category: "OTHER",
      uploadedBy: f.users.admin,
    };
    await expect(
      db.document.create({ data: { ...data, employeeId: f.employees.other } }),
    ).rejects.toMatchObject({ code: "P2003" });
    const onboarding = await db.onboarding.create({
      data: {
        companyId: b,
        name: "Joiner",
        email: "joiner@example.test",
        employeeCode: "JOINER",
        joiningDate: new Date("2026-09-01"),
        createdBy: f.users.other,
      },
    });
    await expect(
      db.document.create({ data: { ...data, onboardingId: onboarding.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    const document = await db.document.create({
      data: { ...data, employeeId: f.employees.staff },
    });
    await expect(
      db.documentAcknowledgement.create({
        data: {
          companyId: a,
          documentId: document.id,
          employeeId: f.employees.other,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.documentAcknowledgement.create({
        data: {
          companyId: a,
          documentId: document.id,
          employeeId: f.employees.staff,
        },
      }),
    ).resolves.toMatchObject({ companyId: a });
  });

  it("rejects cross-tenant log, attendance and performance references at the database boundary", async () => {
    await expect(
      db.loginHistory.create({
        data: {
          companyId: a,
          userId: f.users.other,
          channel: "web",
          success: true,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.loginHistory.create({
        data: {
          companyId: a,
          userId: f.users.staff,
          channel: "web",
          success: true,
        },
      }),
    ).resolves.toMatchObject({ companyId: a });

    const cycle = await db.reviewCycle.create({
      data: {
        companyId: b,
        name: "Other cycle",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-12-31"),
      },
    });
    await expect(
      db.goal.create({
        data: {
          companyId: a,
          employeeId: f.employees.staff,
          cycleId: cycle.id,
          title: "Cross-tenant goal",
          createdBy: f.users.admin,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    const location = await db.attendanceLocation.create({
      data: {
        companyId: b,
        name: "Other office",
        latitude: 12.9,
        longitude: 77.6,
        radiusMeters: 100,
      },
    });
    await expect(
      db.geofenceEvent.create({
        data: {
          companyId: a,
          employeeId: f.employees.staff,
          locationId: location.id,
          eventType: "CHECK_IN",
          latitude: 12.9,
          longitude: 77.6,
          accuracy: 10,
          inside: true,
          accepted: true,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects cross-tenant attendance, announcement and interview references at the database boundary", async () => {
    const otherAttendance = await db.attendance.create({
      data: {
        companyId: b,
        employeeId: f.employees.other,
        workDate: new Date("2026-03-02"),
        checkIn: new Date("2026-03-02T04:00:00Z"),
      },
    });
    await expect(
      db.attendancePunch.create({
        data: {
          companyId: a,
          employeeId: f.employees.staff,
          attendanceId: otherAttendance.id,
          punchedAt: new Date("2026-03-02T04:00:00Z"),
          direction: "IN",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    const otherBranch = await db.branch.create({
      data: { companyId: b, name: "Other branch" },
    });
    await expect(
      db.announcement.create({
        data: {
          companyId: a,
          title: "Cross-tenant",
          body: "Hidden",
          audience: "BRANCH",
          branchId: otherBranch.id,
          createdBy: f.users.admin,
          createdByName: "Admin",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.onboarding.create({
        data: {
          companyId: a,
          name: "Joiner",
          email: "cross@example.test",
          employeeCode: "CROSS-1",
          joiningDate: new Date("2026-10-01"),
          employeeId: f.employees.other,
          createdBy: f.users.admin,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await db.attendance.delete({ where: { id: otherAttendance.id } });
  });

  it("validates onboarding references and blocks deleting referenced organization records", async () => {
    const otherDepartment = await db.department.create({
      data: { companyId: b, name: "Other onboarding department" },
    });
    const rejected = await call(f, "onboarding", "POST", "admin", {
      name: "New Joiner",
      email: "new.joiner@example.test",
      employeeCode: "JOIN-X",
      joiningDate: "2026-10-01",
      departmentId: otherDepartment.id,
    });
    expect(rejected.status).toBe(404);

    const department = await db.department.create({
      data: { companyId: a, name: "Announced department" },
    });
    const announcement = await db.announcement.create({
      data: {
        companyId: a,
        title: "Team notice",
        body: "Notice",
        audience: "DEPARTMENT",
        departmentId: department.id,
        createdBy: f.users.admin,
        createdByName: "Admin",
      },
    });
    const blocked = await call(
      f,
      `departments/${department.id}`,
      "DELETE",
      "admin",
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("announcements");
    await db.announcement.delete({ where: { id: announcement.id } });
    expect(
      (await call(f, `departments/${department.id}`, "DELETE", "admin")).status,
    ).toBe(200);
  });

  it("reopens an onboarding task when its document is deleted", async () => {
    const onboarding = await db.onboarding.create({
      data: {
        companyId: a,
        name: "Document Joiner",
        email: "doc.joiner@example.test",
        employeeCode: "JOIN-DOC",
        joiningDate: new Date("2026-10-01"),
        createdBy: f.users.admin,
      },
    });
    const document = await db.document.create({
      data: {
        companyId: a,
        onboardingId: onboarding.id,
        title: "ID proof",
        category: "OTHER",
        uploadedBy: f.users.admin,
      },
    });
    const task = await db.onboardingTask.create({
      data: {
        companyId: a,
        onboardingId: onboarding.id,
        title: "ID proof",
        category: "DOCUMENT",
        assignee: "EMPLOYEE",
        status: "DONE",
        documentId: document.id,
        completedBy: f.users.admin,
        completedAt: new Date(),
      },
    });
    const removed = await call(
      f,
      `documents/${document.id}`,
      "DELETE",
      "admin",
    );
    expect(removed.status).toBe(200);
    await expect(
      db.onboardingTask.findUniqueOrThrow({ where: { id: task.id } }),
    ).resolves.toMatchObject({
      documentId: null,
      status: "PENDING",
      completedAt: null,
    });
    await db.onboarding.delete({ where: { id: onboarding.id } });
  });

  it("paginates and searches references beyond the old 100/500 limits without tenant leakage", async () => {
    await db.employee.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        companyId: a,
        employeeCode: `REF-${i}`,
        firstName: `Reference ${String(i).padStart(3, "0")}`,
        lastName: "Test",
        officialEmail: `ref${i}@example.test`,
        joinedAt: new Date("2026-01-01"),
      })),
    });
    const first = await call(
      f,
      "references/employees?page=1&pageSize=100",
      "GET",
      "admin",
    );
    const second = await call(
      f,
      "references/employees?page=2&pageSize=100",
      "GET",
      "admin",
    );
    expect(first.body.data.items).toHaveLength(100);
    expect(second.body.data.items).toHaveLength(7);
    expect(
      new Set(
        [...first.body.data.items, ...second.body.data.items].map(
          (x: { id: string }) => x.id,
        ),
      ).size,
    ).toBe(107);
    const searched = await call(
      f,
      `references/employees?search=REF-104&selectedId=${f.employees.other}`,
      "GET",
      "admin",
    );
    expect(searched.body.data.items).toHaveLength(1);
    expect(searched.body.data.selected).toBeNull();
    expect(Object.keys(searched.body.data.items[0]).sort()).toEqual([
      "id",
      "name",
    ]);
    expect((await call(f, "references/employees", "GET", "staff")).status).toBe(
      403,
    );
    expect((await call(f, "references/users", "GET", "staff")).status).toBe(
      403,
    );
    const user = await call(
      f,
      `references/users?search=admin&selectedId=${f.users.other}`,
      "GET",
      "admin",
    );
    expect(user.body.data.selected).toBeNull();
    expect(
      user.body.data.items.every((x: { id: string }) => x.id !== f.users.other),
    ).toBe(true);
    expect(
      (await call(f, "references/employees?pageSize=101", "GET", "admin"))
        .status,
    ).toBe(422);
    await db.department.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        companyId: a,
        name: `Reference department ${i}`,
      })),
    });
    expect(
      (
        await call(
          f,
          "references/departments?search=Reference%20department%20500",
          "GET",
          "admin",
        )
      ).body.data.items,
    ).toHaveLength(1);
    const org = await call(
      f,
      "departments?page=6&pageSize=100",
      "GET",
      "admin",
    );
    expect(org.body.data.total).toBe(506);
    expect(org.body.data.items).toHaveLength(6);
  });

  it("fails closed for missing subscriptions while keeping account and recovery access", async () => {
    const sub = await db.subscription.findUniqueOrThrow({
      where: { companyId: a },
    });
    await db.subscription.delete({ where: { companyId: a } });
    try {
      for (const path of [
        "time/attendance",
        "payroll/payslips",
        "ai/query",
        "v1/attendance",
        "v1/payslips",
      ]) {
        const response = await call(f, path, "GET", "admin");
        expect(response.status).toBe(402);
        expect(response.body.errorCode).toBe("SUBSCRIPTION_REQUIRED");
      }
      expect((await call(f, "auth/me", "GET", "admin")).status).toBe(200);
      expect((await call(f, "employees", "GET", "admin")).status).toBe(200);
    } finally {
      await db.subscription.create({ data: sub });
    }
  });

  it("rejects missing trial configuration atomically", async () => {
    // Roll back the temporary plan change, including when the assertion fails.
    const rollback = new Error("rollback-test");
    await expect(
      db.$transaction(async (tx) => {
        await tx.subscriptionPlan.update({
          where: { code: "FREE_TRIAL" },
          data: { active: false },
        });
        await expect(provisionSubscription(tx, a)).rejects.toMatchObject({
          code: "TRIAL_PLAN_UNAVAILABLE",
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("does not convert a trial with a missing expiry into unlimited active access", async () => {
    const sub = await db.subscription.findUniqueOrThrow({
      where: { companyId: a },
    });
    await db.subscription.update({
      where: { companyId: a },
      data: { status: "TRIAL", trialEndsAt: null },
    });
    try {
      expect(
        (await call(f, "time/attendance", "GET", "admin")).body.errorCode,
      ).toBe("SUBSCRIPTION_EXPIRED");
    } finally {
      await db.subscription.update({
        where: { companyId: a },
        data: { status: sub.status, trialEndsAt: sub.trialEndsAt },
      });
    }
  });

  it("enforces payroll, attendance and face entitlements on alternative entry points", async () => {
    const plan = await db.subscriptionPlan.create({
      data: {
        code: `${f.prefix}_LIMITED`,
        name: "Limited test",
        features: ["mobile"],
      },
    });
    const sub = await db.subscription.findUniqueOrThrow({
      where: { companyId: a },
    });
    await db.subscription.update({
      where: { companyId: a },
      data: { planId: plan.id },
    });
    await db.employee.update({
      where: { id: f.employees.admin },
      data: { faceRequired: true },
    });
    try {
      expect((await call(f, "employees", "GET", "admin")).status).toBe(200);
      for (const path of ["v1/attendance", "v1/payslips", "time/attendance"]) {
        expect((await call(f, path, "GET", "admin")).body.errorCode).toBe(
          "FEATURE_NOT_IN_PLAN",
        );
      }
      for (const path of ["face/enroll", "v1/face/enroll"]) {
        expect((await call(f, path, "POST", "admin", {})).body.errorCode).toBe(
          "FEATURE_NOT_IN_PLAN",
        );
      }
    } finally {
      await db.employee.update({
        where: { id: f.employees.admin },
        data: { faceRequired: false },
      });
      await db.subscription.update({
        where: { companyId: a },
        data: { planId: sub.planId },
      });
      await db.subscriptionPlan.delete({ where: { id: plan.id } });
    }
  });
});
