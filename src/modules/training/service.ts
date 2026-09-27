import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { pdfText } from "@/lib/export";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { notify } from "@/modules/notifications/service";
import { dayDate } from "@/modules/time/rules";

type Tx = Prisma.TransactionClient;
const text = (max: number) => z.string().trim().max(max);
const courseSchema = z
  .object({
    code: text(40).min(1),
    title: text(200).min(2),
    category: text(80).nullable().default(null),
    description: text(5000).nullable().default(null),
    mode: z.enum(["CLASSROOM", "ONLINE", "ON_THE_JOB", "EXTERNAL"]),
    durationHours: z.number().positive().max(1000),
    provider: text(120).nullable().default(null),
    certificationValidMonths: z
      .number()
      .int()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    passScore: z.number().int().min(0).max(100).nullable().default(null),
    skills: z.array(text(60).min(1)).max(20).default([]),
    skillLevel: z.number().int().min(1).max(5).default(3),
    mandatory: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
const trainerSchema = z
  .object({
    name: text(120).min(2),
    email: z.email().max(200).nullable().default(null),
    employeeId: z.string().nullable().default(null),
    organization: text(120).nullable().default(null),
    expertise: text(500).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();
const sessionSchema = z
  .object({
    courseId: z.string().min(1),
    trainerId: z.string().nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    location: text(300).nullable().default(null),
    capacity: z.number().int().min(1).max(1000).default(30),
    openEnrollment: z.boolean().default(false),
  })
  .strict()
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: "The session must end after it starts.",
  });
const resultSchema = z
  .object({
    score: z.number().int().min(0).max(100).nullable().default(null),
    passed: z.boolean().optional(),
  })
  .strict();

const manage = (ctx: Context) => requirePermission(ctx, "training.manage");
const self = (ctx: Context) => requirePermission(ctx, "training.self");
const canManage = (ctx: Context) => ctx.permissions.includes("training.manage");
async function me(ctx: Context) {
  const e = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true },
  });
  if (!e)
    throw new AppError(403, "Your account needs a linked employee record.");
  return e;
}
const lockSession = (tx: Tx, id: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`training:${id}`}))::text`;
async function findSession(tx: Tx | typeof db, ctx: Context, id: string) {
  const s = await tx.trainingSession.findFirst({
    where: { id, companyId: ctx.companyId },
    include: { course: true },
  });
  if (!s) throw new AppError(404, "Training session not found.", "NOT_FOUND");
  return s;
}
const courseSummary = {
  select: {
    id: true,
    code: true,
    title: true,
    mode: true,
    durationHours: true,
    certificationValidMonths: true,
  },
} as const;
const addMonths = (d: Date, n: number) => {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};
const today = () => dayDate(new Date().toISOString().slice(0, 10));

async function upsertSkills(
  tx: Tx,
  companyId: string,
  employeeId: string,
  course: { id: string; skills: string[]; skillLevel: number },
  userId: string,
) {
  for (const skill of course.skills) {
    const old = await tx.employeeSkill.findUnique({
      where: { employeeId_skill: { employeeId, skill } },
    });
    // Training raises a skill to the course level; it never lowers it.
    if (old && old.level >= course.skillLevel) continue;
    await tx.employeeSkill.upsert({
      where: { employeeId_skill: { employeeId, skill } },
      create: {
        companyId,
        employeeId,
        skill,
        level: course.skillLevel,
        source: "TRAINING",
        courseId: course.id,
        verifiedBy: userId,
      },
      update: {
        level: course.skillLevel,
        source: "TRAINING",
        courseId: course.id,
        verifiedBy: userId,
      },
    });
  }
}

export async function trainingRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  const method = req.method;
  if (!canManage(ctx)) self(ctx);

  if (resource === "courses") {
    if (!id && method === "GET")
      return db.course.findMany({
        where: {
          companyId: ctx.companyId,
          ...(canManage(ctx) ? {} : { active: true }),
        },
        include: { _count: { select: { sessions: true } } },
        orderBy: [{ active: "desc" }, { title: "asc" }],
      });
    manage(ctx);
    if ((!id && method === "POST") || (id && method === "PUT")) {
      const b = courseSchema.parse(await json(req));
      return db.$transaction(async (tx) => {
        const old = id
          ? await tx.course.findFirst({
              where: { id, companyId: ctx.companyId },
            })
          : null;
        if (id && !old) throw new AppError(404, "Course not found.");
        const clash = await tx.course.findFirst({
          where: {
            companyId: ctx.companyId,
            code: b.code,
            ...(old ? { NOT: { id: old.id } } : {}),
          },
        });
        if (clash) throw new AppError(409, "Another course uses this code.");
        const saved = old
          ? await tx.course.update({ where: { id: old.id }, data: b })
          : await tx.course.create({
              data: { ...b, companyId: ctx.companyId, createdBy: ctx.userId },
            });
        await audit(
          tx,
          ctx,
          old ? "UPDATE" : "CREATE",
          "courses",
          saved.id,
          undefined,
          { code: b.code },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "trainers") {
    manage(ctx);
    if (!id && method === "GET")
      return db.trainer.findMany({
        where: { companyId: ctx.companyId },
        include: {
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
        },
        orderBy: { name: "asc" },
      });
    manage(ctx);
    if ((!id && method === "POST") || (id && method === "PUT")) {
      const b = trainerSchema.parse(await json(req));
      if (
        b.employeeId &&
        !(await db.employee.findFirst({
          where: { id: b.employeeId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Employee not found.");
      return db.$transaction(async (tx) => {
        const old = id
          ? await tx.trainer.findFirst({
              where: { id, companyId: ctx.companyId },
            })
          : null;
        if (id && !old) throw new AppError(404, "Trainer not found.");
        const saved = old
          ? await tx.trainer.update({ where: { id: old.id }, data: b })
          : await tx.trainer.create({
              data: { ...b, companyId: ctx.companyId },
            });
        await audit(
          tx,
          ctx,
          old ? "UPDATE" : "CREATE",
          "trainers",
          saved.id,
          undefined,
          { name: b.name },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "sessions") {
    if (!id && method === "GET") {
      const upcoming = req.nextUrl.searchParams.get("upcoming") === "true";
      if (!canManage(ctx)) {
        // Employees see open sessions they can join and sessions they are in.
        const e = await me(ctx);
        return db.trainingSession.findMany({
          where: {
            companyId: ctx.companyId,
            status: "SCHEDULED",
            startsAt: { gt: new Date() },
            OR: [
              { openEnrollment: true, course: { active: true } },
              { enrollments: { some: { employeeId: e.id } } },
            ],
          },
          include: {
            course: courseSummary,
            trainer: { select: { name: true } },
            _count: {
              select: {
                enrollments: { where: { status: { not: "CANCELLED" } } },
              },
            },
            enrollments: {
              where: { employeeId: e.id },
              select: { id: true, status: true },
            },
          },
          orderBy: { startsAt: "asc" },
          take: 100,
        });
      }
      return db.trainingSession.findMany({
        where: {
          companyId: ctx.companyId,
          ...(upcoming ? { startsAt: { gt: new Date() } } : {}),
          ...(req.nextUrl.searchParams.get("courseId")
            ? { courseId: req.nextUrl.searchParams.get("courseId")! }
            : {}),
        },
        include: {
          course: courseSummary,
          trainer: { select: { name: true } },
          _count: {
            select: {
              enrollments: { where: { status: { not: "CANCELLED" } } },
            },
          },
        },
        orderBy: { startsAt: "desc" },
        take: 300,
      });
    }
    if (id && action === "join" && method === "POST") {
      const e = await me(ctx);
      return db.$transaction(async (tx) => {
        await lockSession(tx, id);
        const s = await findSession(tx, ctx, id);
        if (!s.openEnrollment || !s.course.active)
          throw new AppError(403, "HR enrolls employees in this session.");
        if (s.status !== "SCHEDULED" || s.startsAt <= new Date())
          throw new AppError(409, "This session is no longer open.");
        return enroll(tx, ctx, s, [e.id], true);
      });
    }
    if (id && action === "leave" && method === "POST") {
      const e = await me(ctx);
      return db.$transaction(async (tx) => {
        const s = await findSession(tx, ctx, id);
        if (s.startsAt <= new Date())
          throw new AppError(409, "The session has already started.");
        const done = await tx.trainingEnrollment.updateMany({
          where: { sessionId: s.id, employeeId: e.id, status: "ENROLLED" },
          data: { status: "CANCELLED" },
        });
        if (!done.count) throw new AppError(404, "You are not enrolled.");
        return { cancelled: true };
      });
    }
    manage(ctx);
    if ((!id && method === "POST") || (id && !action && method === "PUT")) {
      const b = sessionSchema.parse(await json(req));
      return db.$transaction(async (tx) => {
        const course = await tx.course.findFirst({
          where: { id: b.courseId, companyId: ctx.companyId },
        });
        if (!course) throw new AppError(404, "Course not found.");
        if (
          b.trainerId &&
          !(await tx.trainer.findFirst({
            where: { id: b.trainerId, companyId: ctx.companyId, active: true },
          }))
        )
          throw new AppError(404, "Trainer not found.");
        const data = {
          ...b,
          startsAt: new Date(b.startsAt),
          endsAt: new Date(b.endsAt),
        };
        let saved;
        if (id) {
          await lockSession(tx, id);
          const old = await findSession(tx, ctx, id);
          if (old.status !== "SCHEDULED")
            throw new AppError(409, "Only scheduled sessions can be changed.");
          const taken = await tx.trainingEnrollment.count({
            where: { sessionId: old.id, status: { not: "CANCELLED" } },
          });
          if (b.capacity < taken)
            throw new AppError(409, `${taken} people are already enrolled.`);
          saved = await tx.trainingSession.update({
            where: { id: old.id },
            data,
          });
        } else {
          if (!course.active)
            throw new AppError(409, "The course is inactive.");
          saved = await tx.trainingSession.create({
            data: { ...data, companyId: ctx.companyId, createdBy: ctx.userId },
          });
        }
        await audit(
          tx,
          ctx,
          id ? "UPDATE" : "CREATE",
          "training_sessions",
          saved.id,
          undefined,
          { courseId: course.id },
          ip(req),
        );
        return saved;
      });
    }
    if (id && action === "enrollments" && method === "GET") {
      const s = await findSession(db, ctx, id);
      return db.trainingEnrollment.findMany({
        where: { sessionId: s.id },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    }
    if (id && action === "enrollments" && method === "POST") {
      const b = z
        .object({ employeeIds: z.array(z.string().min(1)).min(1).max(500) })
        .strict()
        .parse(await json(req));
      const result = await db.$transaction(async (tx) => {
        await lockSession(tx, id);
        const s = await findSession(tx, ctx, id);
        if (s.status !== "SCHEDULED")
          throw new AppError(409, "Only scheduled sessions take enrollments.");
        return enroll(tx, ctx, s, [...new Set(b.employeeIds)], false);
      });
      return result;
    }
    if (
      id &&
      (action === "cancel" || action === "complete") &&
      method === "POST"
    ) {
      return db.$transaction(async (tx) => {
        const s = await findSession(tx, ctx, id);
        if (s.status !== "SCHEDULED")
          throw new AppError(409, "This session is already closed.");
        if (action === "complete" && s.startsAt > new Date())
          throw new AppError(
            409,
            "A session can be completed after it starts.",
          );
        if (action === "complete") {
          const open = await tx.trainingEnrollment.count({
            where: { sessionId: s.id, status: "ENROLLED" },
          });
          if (open)
            throw new AppError(
              409,
              `Mark attendance for ${open} enrolled people first.`,
            );
        } else
          await tx.trainingEnrollment.updateMany({
            where: { sessionId: s.id, status: "ENROLLED" },
            data: { status: "CANCELLED" },
          });
        const saved = await tx.trainingSession.update({
          where: { id: s.id },
          data: { status: action === "cancel" ? "CANCELLED" : "COMPLETED" },
        });
        await audit(
          tx,
          ctx,
          action.toUpperCase(),
          "training_sessions",
          s.id,
          { status: s.status },
          { status: saved.status },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "enrollments" && id) {
    if (action === "certificate" && method === "GET") {
      const en = await db.trainingEnrollment.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          employee: {
            select: {
              userId: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
          session: {
            include: { course: true, trainer: { select: { name: true } } },
          },
        },
      });
      if (!en || (!canManage(ctx) && en.employee.userId !== ctx.userId))
        throw new AppError(404, "Enrollment not found.", "NOT_FOUND");
      if (en.status !== "COMPLETED" || !en.certificateNo)
        throw new AppError(409, "No certificate has been issued.");
      return certificate(en, ctx.companyId);
    }
    manage(ctx);
    const en = await db.trainingEnrollment.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { session: { include: { course: true } } },
    });
    if (!en) throw new AppError(404, "Enrollment not found.", "NOT_FOUND");
    if (!action && method === "PUT") {
      const b = z
        .object({ status: z.enum(["ATTENDED", "ABSENT", "CANCELLED"]) })
        .strict()
        .parse(await json(req));
      if (["COMPLETED", "FAILED"].includes(en.status))
        throw new AppError(409, "The result is already recorded.");
      if (b.status !== "CANCELLED" && en.session.startsAt > new Date())
        throw new AppError(
          409,
          "Attendance is marked once the session starts.",
        );
      if (en.session.status === "CANCELLED")
        throw new AppError(409, "The session was cancelled.");
      return db.trainingEnrollment.update({
        where: { id: en.id },
        data: {
          status: b.status,
          attendedAt: b.status === "ATTENDED" ? new Date() : null,
        },
      });
    }
    if (action === "result" && method === "POST") {
      const b = resultSchema.parse(await json(req));
      if (en.status !== "ATTENDED")
        throw new AppError(409, "Record results for people who attended.");
      const course = en.session.course;
      const passed =
        b.passed ??
        (course.passScore === null
          ? true
          : (b.score ?? -1) >= course.passScore);
      if (course.passScore !== null && b.score === null)
        throw new AppError(422, "This course needs a score.");
      return db.$transaction(async (tx) => {
        const certifiedOn = dayDate(
          en.session.endsAt.toISOString().slice(0, 10),
        );
        const certified = passed && course.certificationValidMonths !== null;
        const saved = await tx.trainingEnrollment.update({
          where: { id: en.id },
          data: {
            status: passed ? "COMPLETED" : "FAILED",
            score: b.score,
            passed,
            completedAt: new Date(),
            remindedAt: null,
            ...(passed
              ? {
                  certificateNo: `${course.code}-${certifiedOn.getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`,
                  certifiedOn,
                  expiresOn: certified
                    ? addMonths(certifiedOn, course.certificationValidMonths!)
                    : null,
                }
              : {}),
          },
        });
        if (passed)
          await upsertSkills(
            tx,
            ctx.companyId,
            en.employeeId,
            course,
            ctx.userId,
          );
        await audit(
          tx,
          ctx,
          "RESULT",
          "training_enrollments",
          en.id,
          undefined,
          { passed, score: b.score },
          ip(req),
        );
        return saved;
      });
    }
  }

  // Certificates: valid, expiring and expired.
  if (resource === "certifications" && method === "GET") {
    const q = req.nextUrl.searchParams;
    const within = Number(q.get("expiringWithin") ?? "");
    const employeeId = canManage(ctx)
      ? q.get("employeeId")
      : (await me(ctx)).id;
    return db.trainingEnrollment.findMany({
      where: {
        companyId: ctx.companyId,
        status: "COMPLETED",
        expiresOn: {
          not: null,
          ...(within > 0
            ? { lte: new Date(Date.now() + within * 86400000) }
            : {}),
        },
        ...(employeeId ? { employeeId } : {}),
      },
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true },
        },
        session: {
          select: { course: { select: { code: true, title: true } } },
        },
      },
      orderBy: { expiresOn: "asc" },
      take: 500,
    });
  }

  // Mandatory courses without a valid completion, per active employee.
  if (resource === "compliance" && method === "GET") {
    manage(ctx);
    const [courses, employees] = await Promise.all([
      db.course.findMany({
        where: { companyId: ctx.companyId, mandatory: true, active: true },
        select: { id: true, code: true, title: true },
      }),
      db.employee.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ["Active", "Probation", "On notice"] },
        },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
        },
      }),
    ]);
    const done = await db.trainingEnrollment.findMany({
      where: {
        companyId: ctx.companyId,
        status: "COMPLETED",
        session: { courseId: { in: courses.map((c) => c.id) } },
        OR: [{ expiresOn: null }, { expiresOn: { gte: today() } }],
      },
      select: { employeeId: true, session: { select: { courseId: true } } },
    });
    const have = new Set(
      done.map((d) => `${d.employeeId}:${d.session.courseId}`),
    );
    return courses.map((c) => ({
      course: c,
      missing: employees.filter((e) => !have.has(`${e.id}:${c.id}`)),
      compliant: employees.filter((e) => have.has(`${e.id}:${c.id}`)).length,
      total: employees.length,
    }));
  }

  if (resource === "skills") {
    if (method === "GET") {
      const q = req.nextUrl.searchParams;
      const employeeId = canManage(ctx)
        ? q.get("employeeId")
        : (await me(ctx)).id;
      return db.employeeSkill.findMany({
        where: {
          companyId: ctx.companyId,
          ...(employeeId ? { employeeId } : {}),
          ...(q.get("skill")
            ? { skill: { contains: q.get("skill")!, mode: "insensitive" } }
            : {}),
        },
        include: {
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ skill: "asc" }, { level: "desc" }],
        take: 1000,
      });
    }
    manage(ctx);
    if (!id && method === "PUT") {
      const b = z
        .object({
          employeeId: z.string().min(1),
          skill: text(60).min(1),
          level: z.number().int().min(1).max(5),
        })
        .strict()
        .parse(await json(req));
      const e = await db.employee.findFirst({
        where: { id: b.employeeId, companyId: ctx.companyId },
      });
      if (!e) throw new AppError(404, "Employee not found.");
      return db.employeeSkill.upsert({
        where: { employeeId_skill: { employeeId: e.id, skill: b.skill } },
        create: {
          companyId: ctx.companyId,
          employeeId: e.id,
          skill: b.skill,
          level: b.level,
          verifiedBy: ctx.userId,
        },
        update: { level: b.level, source: "MANUAL", verifiedBy: ctx.userId },
      });
    }
    if (id && method === "DELETE") {
      const done = await db.employeeSkill.deleteMany({
        where: { id, companyId: ctx.companyId },
      });
      if (!done.count) throw new AppError(404, "Skill not found.");
      return { deleted: true };
    }
  }

  // Self-service summary for the ESS dashboard.
  if (resource === "mine" && method === "GET") return myTraining(ctx);

  if (resource === "reminders" && method === "POST") {
    manage(ctx);
    return trainingReminders(ctx.companyId);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

async function enroll(
  tx: Tx,
  ctx: Context,
  s: {
    id: string;
    capacity: number;
    startsAt: Date;
    course: { title: string };
  },
  employeeIds: string[],
  selfEnrolled: boolean,
) {
  const people = await tx.employee.findMany({
    where: {
      id: { in: employeeIds },
      companyId: ctx.companyId,
      status: { in: ["Active", "Probation", "On notice"] },
    },
    select: { id: true, userId: true },
  });
  if (people.length !== employeeIds.length)
    throw new AppError(
      404,
      "One of the employees was not found or is inactive.",
    );
  const existing = await tx.trainingEnrollment.findMany({
    where: { sessionId: s.id, employeeId: { in: employeeIds } },
  });
  const active = existing
    .filter((e) => e.status !== "CANCELLED")
    .map((e) => e.employeeId);
  const adding = employeeIds.filter((e) => !active.includes(e));
  if (selfEnrolled && !adding.length)
    throw new AppError(409, "You are already enrolled.");
  const taken = await tx.trainingEnrollment.count({
    where: { sessionId: s.id, status: { not: "CANCELLED" } },
  });
  if (taken + adding.length > s.capacity)
    throw new AppError(
      409,
      `Only ${Math.max(0, s.capacity - taken)} places are left.`,
      "SESSION_FULL",
    );
  for (const employeeId of adding)
    await tx.trainingEnrollment.upsert({
      where: { sessionId_employeeId: { sessionId: s.id, employeeId } },
      create: {
        companyId: ctx.companyId,
        sessionId: s.id,
        employeeId,
        selfEnrolled,
        enrolledBy: ctx.userId,
      },
      update: { status: "ENROLLED", selfEnrolled, enrolledBy: ctx.userId },
    });
  await notify(
    ctx.companyId,
    people.filter((p) => adding.includes(p.id)).map((p) => p.userId),
    "training.reminder",
    {
      course: s.course.title,
      when: s.startsAt.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    },
    "/training",
  ).catch(() => undefined);
  return {
    enrolled: adding.length,
    alreadyEnrolled: employeeIds.length - adding.length,
  };
}

export async function myTraining(ctx: Context) {
  const e = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true },
  });
  if (!e) return null;
  const [enrollments, skills] = await Promise.all([
    db.trainingEnrollment.findMany({
      where: {
        companyId: ctx.companyId,
        employeeId: e.id,
        status: { not: "CANCELLED" },
      },
      include: {
        session: {
          select: {
            startsAt: true,
            endsAt: true,
            location: true,
            status: true,
            course: courseSummary,
          },
        },
      },
      orderBy: { session: { startsAt: "desc" } },
      take: 100,
    }),
    db.employeeSkill.findMany({
      where: { companyId: ctx.companyId, employeeId: e.id },
      select: { skill: true, level: true, source: true },
      orderBy: { level: "desc" },
    }),
  ]);
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 86400000);
  return {
    upcoming: enrollments.filter(
      (x) =>
        x.status === "ENROLLED" &&
        x.session.status === "SCHEDULED" &&
        x.session.startsAt > now,
    ),
    completed: enrollments.filter((x) => x.status === "COMPLETED").length,
    certifications: enrollments
      .filter((x) => x.status === "COMPLETED" && x.certificateNo)
      .map((x) => ({
        id: x.id,
        course: x.session.course.title,
        certificateNo: x.certificateNo,
        certifiedOn: x.certifiedOn,
        expiresOn: x.expiresOn,
        state: !x.expiresOn
          ? "VALID"
          : x.expiresOn < now
            ? "EXPIRED"
            : x.expiresOn < soon
              ? "EXPIRING"
              : "VALID",
      })),
    skills,
  };
}

// Session reminders a day ahead and certificate expiry notices 30 days
// ahead, each sent once. Run by the scheduled worker or on demand by HR.
export async function trainingReminders(companyId: string) {
  const now = new Date();
  const [sessions, expiring] = await Promise.all([
    db.trainingEnrollment.findMany({
      where: {
        companyId,
        status: "ENROLLED",
        remindedAt: null,
        session: {
          status: "SCHEDULED",
          startsAt: { gt: now, lte: new Date(now.getTime() + 86400000) },
        },
      },
      include: {
        employee: { select: { userId: true } },
        session: {
          select: { startsAt: true, course: { select: { title: true } } },
        },
      },
    }),
    db.trainingEnrollment.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        remindedAt: null,
        expiresOn: { not: null, lte: new Date(now.getTime() + 30 * 86400000) },
      },
      include: {
        employee: { select: { userId: true } },
        session: { select: { course: { select: { title: true } } } },
      },
    }),
  ]);
  for (const x of sessions) {
    await notify(
      companyId,
      [x.employee.userId],
      "training.reminder",
      {
        course: x.session.course.title,
        when:
          x.session.startsAt.toISOString().replace("T", " ").slice(0, 16) +
          " UTC",
      },
      "/training",
    );
    await db.trainingEnrollment.update({
      where: { id: x.id },
      data: { remindedAt: now },
    });
  }
  for (const x of expiring) {
    await notify(
      companyId,
      [x.employee.userId],
      "certification.expiring",
      {
        course: x.session.course.title,
        expiresOn: x.expiresOn!.toISOString().slice(0, 10),
      },
      "/training",
    );
    await db.trainingEnrollment.update({
      where: { id: x.id },
      data: { remindedAt: now },
    });
  }
  return { sessionReminders: sessions.length, expiryNotices: expiring.length };
}

async function certificate(
  en: {
    certificateNo: string | null;
    certifiedOn: Date | null;
    expiresOn: Date | null;
    score: number | null;
    employee: { firstName: string; lastName: string; employeeCode: string };
    session: {
      course: { title: string; durationHours: number };
      trainer: { name: string } | null;
    };
  },
  companyId: string,
) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, branding: { select: { brandName: true } } },
  });
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const center = (s: string, y: number, size: number, f = font) => {
    const t = pdfText(s);
    page.drawText(t, {
      x: (842 - f.widthOfTextAtSize(t, size)) / 2,
      y,
      size,
      font: f,
      color: rgb(0.1, 0.1, 0.1),
    });
  };
  page.drawRectangle({
    x: 24,
    y: 24,
    width: 794,
    height: 547,
    borderColor: rgb(0.15, 0.3, 0.6),
    borderWidth: 3,
  });
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "-");
  center(company.branding?.brandName || company.name, 500, 16, bold);
  center("Certificate of completion", 440, 30, bold);
  center("This certifies that", 390, 13);
  center(
    `${en.employee.firstName} ${en.employee.lastName} (${en.employee.employeeCode})`,
    355,
    22,
    bold,
  );
  center(
    `has completed ${en.session.course.title} (${en.session.course.durationHours} hours)`,
    315,
    14,
  );
  if (en.score !== null) center(`Score: ${en.score}%`, 290, 12);
  center(
    `Certified on ${d(en.certifiedOn)}${en.expiresOn ? ` · valid until ${d(en.expiresOn)}` : ""}`,
    250,
    12,
  );
  if (en.session.trainer)
    center(`Trainer: ${en.session.trainer.name}`, 225, 12);
  center(`Certificate no. ${en.certificateNo}`, 80, 10);
  return new NextResponse(new Uint8Array(await doc.save()), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="certificate-${en.certificateNo}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
