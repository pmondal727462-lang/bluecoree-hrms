import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 10: courses, trainers, sessions, enrollment, attendance,
// certification with expiry, skills, compliance and reminders.
const f = new Fixture();
let a = "";
let course = "";
let session = "";
const hours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("peer", a, "Employee");
  await f.user("late", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  const where = { companyId: { in: f.companies } };
  await db.trainingEnrollment.deleteMany({ where });
  await db.trainingSession.deleteMany({ where });
  await db.trainer.deleteMany({ where });
  await db.course.deleteMany({ where });
  await db.employeeSkill.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 10 training", () => {
  it("sets up courses, trainers and sessions for HR only", async () => {
    const body = {
      code: "FA-101",
      title: "First aid",
      mode: "CLASSROOM",
      durationHours: 4,
      certificationValidMonths: 12,
      passScore: 70,
      skills: ["First aid", "CPR"],
      skillLevel: 3,
      mandatory: true,
    };
    expect(
      (await call(f, "training/courses", "POST", "staff", body)).status,
    ).toBe(403);
    course = (await call(f, "training/courses", "POST", "admin", body)).body
      .data.id;
    expect(
      (await call(f, "training/courses", "POST", "admin", body)).status,
    ).toBe(409);
    const trainer = await call(f, "training/trainers", "POST", "admin", {
      name: "Dr Mehta",
      organization: "Red Cross",
    });
    expect((await call(f, "training/trainers", "GET", "staff")).status).toBe(
      403,
    );
    expect(
      (
        await call(f, "training/sessions", "POST", "admin", {
          courseId: course,
          startsAt: hours(48),
          endsAt: hours(47),
        })
      ).status,
    ).toBe(422);
    const s = await call(f, "training/sessions", "POST", "admin", {
      courseId: course,
      trainerId: trainer.body.data.id,
      startsAt: hours(48),
      endsAt: hours(52),
      location: "Room 2",
      capacity: 2,
      openEnrollment: true,
    });
    session = s.body.data.id;
    expect(
      (
        await call(f, "training/sessions", "POST", "other", {
          courseId: course,
          startsAt: hours(48),
          endsAt: hours(52),
        })
      ).status,
    ).toBe(404);
  });

  it("enrolls within capacity and lets employees join open sessions", async () => {
    const open = (await call(f, "training/sessions", "GET", "staff")).body.data;
    expect(open.map((s: { id: string }) => s.id)).toEqual([session]);
    expect(
      (await call(f, `training/sessions/${session}/join`, "POST", "staff")).body
        .data.enrolled,
    ).toBe(1);
    expect(
      (await call(f, `training/sessions/${session}/join`, "POST", "staff"))
        .status,
    ).toBe(409);
    expect(
      (
        await call(
          f,
          `training/sessions/${session}/enrollments`,
          "POST",
          "admin",
          {
            employeeIds: [f.employees.other],
          },
        )
      ).status,
    ).toBe(404);
    await call(f, `training/sessions/${session}/enrollments`, "POST", "admin", {
      employeeIds: [f.employees.peer],
    });
    const full = await call(
      f,
      `training/sessions/${session}/join`,
      "POST",
      "late",
    );
    expect(full.body.errorCode).toBe("SESSION_FULL");
    // Attendance is marked once the session has started.
    const list = (
      await call(f, `training/sessions/${session}/enrollments`, "GET", "admin")
    ).body.data;
    expect(
      (
        await call(f, `training/enrollments/${list[0].id}`, "PUT", "admin", {
          status: "ATTENDED",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(f, `training/sessions/${session}`, "GET", "other")).status,
    ).toBe(404);
  });

  it("records attendance and results, issuing certificates and skills", async () => {
    // Move the session into the past.
    await db.trainingSession.update({
      where: { id: session },
      data: {
        startsAt: new Date("2026-09-01T04:00:00Z"),
        endsAt: new Date("2026-09-01T08:00:00Z"),
      },
    });
    const list = (
      await call(f, `training/sessions/${session}/enrollments`, "GET", "admin")
    ).body.data as { id: string; employeeId: string }[];
    const staff = list.find((e) => e.employeeId === f.employees.staff)!;
    const peer = list.find((e) => e.employeeId === f.employees.peer)!;
    expect(
      (await call(f, `training/sessions/${session}/complete`, "POST", "admin"))
        .status,
    ).toBe(409);
    for (const e of [staff, peer])
      await call(f, `training/enrollments/${e.id}`, "PUT", "admin", {
        status: "ATTENDED",
      });
    expect(
      (
        await call(
          f,
          `training/enrollments/${staff.id}/result`,
          "POST",
          "admin",
          {
            score: null,
          },
        )
      ).status,
    ).toBe(422);
    const passed = (
      await call(
        f,
        `training/enrollments/${staff.id}/result`,
        "POST",
        "admin",
        {
          score: 85,
        },
      )
    ).body.data;
    expect(passed).toMatchObject({ status: "COMPLETED", passed: true });
    expect(passed.certificateNo).toMatch(/^FA-101-2026-/);
    expect(passed.certifiedOn.slice(0, 10)).toBe("2026-09-01");
    expect(passed.expiresOn.slice(0, 10)).toBe("2027-09-01");
    const failed = (
      await call(f, `training/enrollments/${peer.id}/result`, "POST", "admin", {
        score: 60,
      })
    ).body.data;
    expect(failed).toMatchObject({ status: "FAILED", passed: false });
    expect(failed.certificateNo).toBeNull();
    expect(
      (await call(f, `training/sessions/${session}/complete`, "POST", "admin"))
        .body.data.status,
    ).toBe("COMPLETED");

    const skills = await db.employeeSkill.findMany({
      where: { employeeId: f.employees.staff },
      orderBy: { skill: "asc" },
    });
    expect(skills.map((s) => [s.skill, s.level, s.source])).toEqual([
      ["CPR", 3, "TRAINING"],
      ["First aid", 3, "TRAINING"],
    ]);
    expect(
      await db.employeeSkill.count({ where: { employeeId: f.employees.peer } }),
    ).toBe(0);

    const pdf = await call(
      f,
      `training/enrollments/${staff.id}/certificate`,
      "GET",
      "staff",
    );
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    for (const who of ["peer", "other"])
      expect(
        (
          await call(
            f,
            `training/enrollments/${staff.id}/certificate`,
            "GET",
            who,
          )
        ).status,
      ).toBe(404);

    const mine = (await call(f, "training/mine", "GET", "staff")).body.data;
    expect(mine.completed).toBe(1);
    expect(mine.certifications[0]).toMatchObject({ state: "VALID" });
    const home = (await call(f, "home", "GET", "staff")).body.data;
    expect(home.training).toMatchObject({ completed: 1, expiring: 0 });
  });

  it("reports mandatory-course compliance and expiring certificates", async () => {
    const compliance = (await call(f, "training/compliance", "GET", "admin"))
      .body.data[0];
    expect(compliance.compliant).toBe(1);
    expect(
      compliance.missing.map((e: { firstName: string }) => e.firstName).sort(),
    ).toEqual(["admin", "late", "peer"]);
    expect(
      (
        await call(
          f,
          "training/certifications?expiringWithin=30",
          "GET",
          "admin",
        )
      ).body.data,
    ).toHaveLength(0);
    await db.trainingEnrollment.updateMany({
      where: { employeeId: f.employees.staff, status: "COMPLETED" },
      data: { expiresOn: new Date(Date.now() + 10 * 86400000) },
    });
    expect(
      (
        await call(
          f,
          "training/certifications?expiringWithin=30",
          "GET",
          "admin",
        )
      ).body.data,
    ).toHaveLength(1);
    // Staff see only their own certificates.
    expect(
      (await call(f, "training/certifications", "GET", "peer")).body.data,
    ).toHaveLength(0);
  });

  it("sends session and expiry reminders once", async () => {
    const soon = await call(f, "training/sessions", "POST", "admin", {
      courseId: course,
      startsAt: hours(12),
      endsAt: hours(14),
      capacity: 5,
    });
    await call(
      f,
      `training/sessions/${soon.body.data.id}/enrollments`,
      "POST",
      "admin",
      { employeeIds: [f.employees.late] },
    );
    const first = (await call(f, "training/reminders", "POST", "admin")).body
      .data;
    expect(first).toEqual({ sessionReminders: 1, expiryNotices: 1 });
    expect(
      (await call(f, "training/reminders", "POST", "admin")).body.data,
    ).toEqual({ sessionReminders: 0, expiryNotices: 0 });
    const notes = await db.notification.findMany({
      where: { userId: f.users.late },
      orderBy: { createdAt: "asc" },
    });
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });
});
