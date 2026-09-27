import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { dayDate } from "@/modules/time/rules";
import { directReportIds, linkedEmployee } from "@/modules/shared/team";
import { notify } from "@/modules/notifications/service";

const text = (max: number) => z.string().trim().max(max);
const cycleSchema = z
  .object({
    name: text(120).min(2),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    selfReview: z.boolean(),
    ratingScale: z.number().int().min(3).max(10).default(5),
    ratingLabels: z.array(text(40).min(1)).max(10).default([]),
    peerReview: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => v.periodEnd >= v.periodStart,
    "End date must follow start date",
  )
  .refine(
    (v) => !v.ratingLabels.length || v.ratingLabels.length === v.ratingScale,
    "Give one label per rating point, or none.",
  );
const goalSchema = z
  .object({
    employeeId: z.string().optional(),
    cycleId: z.string().nullable().default(null),
    type: z.enum(["KPI", "OKR", "KEY_RESULT", "GOAL", "DEVELOPMENT"]),
    // A key result belongs to one of the employee's OKR objectives.
    parentId: z.string().nullable().default(null),
    title: text(200).min(2),
    description: text(2000).nullable().default(null),
    metric: text(200).nullable().default(null),
    target: text(100).nullable().default(null),
    unit: text(40).nullable().default(null),
    weight: z.number().int().min(0).max(100).default(0),
    dueDate: z.iso.date().nullable().default(null),
    source: z.enum(["MANUAL", "AI"]).default("MANUAL"),
  })
  .strict();
const rating = (scale: number) => z.number().int().min(1).max(scale);
const peerSchema = z
  .object({ employeeIds: z.array(z.string().min(1)).min(1).max(10) })
  .strict();

// Checks a key result's objective and recalculates objective progress.
async function checkParent(
  companyId: string,
  employeeId: string,
  type: string,
  parentId: string | null,
) {
  if (type === "KEY_RESULT" && !parentId)
    throw new AppError(422, "Choose the objective this key result belongs to.");
  if (!parentId) return;
  if (type !== "KEY_RESULT")
    throw new AppError(422, "Only key results belong to an objective.");
  const parent = await db.goal.findFirst({
    where: { id: parentId, companyId, employeeId, type: "OKR" },
  });
  if (!parent)
    throw new AppError(404, "Objective not found for this employee.");
}
async function rollUp(tx: Prisma.TransactionClient, parentId: string | null) {
  if (!parentId) return;
  const krs = await tx.goal.findMany({
    where: { parentId, status: { not: "CANCELLED" } },
    select: { progress: true, weight: true },
  });
  if (!krs.length) return;
  const weights = krs.reduce((a, k) => a + (k.weight || 1), 0);
  const progress = Math.round(
    krs.reduce((a, k) => a + k.progress * (k.weight || 1), 0) / weights,
  );
  await tx.goal.update({ where: { id: parentId }, data: { progress } });
}

// Employees whose performance records the user may see: everyone for HR,
// direct reports for managers, and always themselves.
async function scope(ctx: Context) {
  const me = await linkedEmployee(ctx);
  if (ctx.permissions.includes("performance.manage"))
    return { all: true, me, ids: [] as string[], team: [] as string[] };
  const team = ctx.permissions.includes("performance.team")
    ? await directReportIds(ctx)
    : [];
  return {
    all: false,
    me,
    team,
    ids: [
      ...team,
      ...(me && ctx.permissions.includes("performance.self") ? [me.id] : []),
    ],
  };
}
type Scope = Awaited<ReturnType<typeof scope>>;
const visible = (s: Scope, employeeId: string) =>
  s.all || s.ids.includes(employeeId);
const canManageFor = (s: Scope, employeeId: string) =>
  s.all || s.team.includes(employeeId);
const where = (s: Scope, q: URLSearchParams) => {
  const requested = q.get("employeeId");
  const which = q.get("scope") ?? "own";
  if (requested) {
    if (!visible(s, requested)) throw new AppError(404, "Employee not found.");
    return { employeeId: requested };
  }
  if (which === "company" && s.all) return {};
  if (which === "team")
    return { employeeId: { in: s.all ? undefined : s.team } };
  if (!s.me)
    throw new AppError(403, "Your account needs a linked employee record.");
  return { employeeId: s.me.id };
};
const employeeSelect = {
  select: {
    id: true,
    employeeCode: true,
    firstName: true,
    lastName: true,
    managerId: true,
  },
};

export async function performanceRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  if (
    !["performance.self", "performance.team", "performance.manage"].some((p) =>
      ctx.permissions.includes(p),
    )
  )
    throw new AppError(
      403,
      "You do not have access to performance.",
      "FORBIDDEN",
    );
  const [, resource, id, action] = path;
  const method = req.method;
  const s = await scope(ctx);

  if (resource === "cycles") {
    if (!id && method === "GET")
      return db.reviewCycle.findMany({
        where: { companyId: ctx.companyId },
        include: { _count: { select: { reviews: true } } },
        orderBy: { periodStart: "desc" },
      });
    requirePermission(ctx, "performance.manage");
    if ((!id && method === "POST") || (id && !action && method === "PUT")) {
      const b = cycleSchema.parse(await json(req));
      const data = {
        ...b,
        periodStart: dayDate(b.periodStart),
        periodEnd: dayDate(b.periodEnd),
      };
      return db.$transaction(async (tx) => {
        const old = id
          ? await tx.reviewCycle.findFirst({
              where: { id, companyId: ctx.companyId },
            })
          : null;
        if (id && !old) throw new AppError(404, "Review cycle not found.");
        if (old && old.status !== "DRAFT")
          throw new AppError(409, "Only draft cycles can be edited.");
        const saved = old
          ? await tx.reviewCycle.update({ where: { id: old.id }, data })
          : await tx.reviewCycle.create({
              data: { ...data, companyId: ctx.companyId },
            });
        await audit(
          tx,
          ctx,
          old ? "UPDATE" : "CREATE",
          "review_cycles",
          saved.id,
          undefined,
          b,
          ip(req),
        );
        return saved;
      });
    }
    if (id && ["launch", "close"].includes(action) && method === "POST")
      return db.$transaction(async (tx) => {
        const cycle = await tx.reviewCycle.findFirst({
          where: { id, companyId: ctx.companyId },
        });
        if (!cycle) throw new AppError(404, "Review cycle not found.");
        if (action === "launch") {
          if (cycle.status !== "DRAFT")
            throw new AppError(409, "This cycle is already launched.");
          const employees = await tx.employee.findMany({
            where: {
              companyId: ctx.companyId,
              status: { in: ["Active", "Probation", "On notice"] },
              joinedAt: { lte: cycle.periodEnd },
            },
            select: { id: true, managerId: true },
          });
          await tx.performanceReview.createMany({
            data: employees.map((e) => ({
              companyId: ctx.companyId,
              cycleId: cycle.id,
              employeeId: e.id,
              reviewerEmployeeId: e.managerId,
              status: cycle.selfReview ? "PENDING_SELF" : "PENDING_MANAGER",
            })),
            skipDuplicates: true,
          });
        } else if (cycle.status !== "ACTIVE")
          throw new AppError(409, "Only active cycles can be closed.");
        const saved = await tx.reviewCycle.update({
          where: { id: cycle.id },
          data: { status: action === "launch" ? "ACTIVE" : "CLOSED" },
        });
        await audit(
          tx,
          ctx,
          action.toUpperCase(),
          "review_cycles",
          cycle.id,
          { status: cycle.status },
          { status: saved.status },
          ip(req),
        );
        return saved;
      });
  }

  if (resource === "goals") {
    if (!id && method === "GET")
      return db.goal.findMany({
        where: {
          companyId: ctx.companyId,
          ...where(s, req.nextUrl.searchParams),
          ...(req.nextUrl.searchParams.get("cycleId")
            ? { cycleId: req.nextUrl.searchParams.get("cycleId")! }
            : {}),
        },
        include: {
          employee: employeeSelect,
          cycle: { select: { id: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 500,
      });
    if (!id && method === "POST") {
      const b = goalSchema.parse(await json(req));
      const employeeId = b.employeeId ?? s.me?.id;
      if (!employeeId)
        throw new AppError(403, "Your account needs a linked employee record.");
      const own = employeeId === s.me?.id;
      if (
        own
          ? !ctx.permissions.includes("performance.self") && !s.all
          : !canManageFor(s, employeeId)
      )
        throw new AppError(404, "Employee not found.");
      if (
        b.cycleId &&
        !(await db.reviewCycle.findFirst({
          where: { id: b.cycleId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Review cycle not found.");
      await checkParent(ctx.companyId, employeeId, b.type, b.parentId);
      const { employeeId: _e, ...data } = b;
      return db.goal.create({
        data: {
          ...data,
          dueDate: b.dueDate ? dayDate(b.dueDate) : null,
          companyId: ctx.companyId,
          employeeId,
          createdBy: ctx.userId,
          // Every goal, including AI suggestions, starts as an editable draft.
          status: "DRAFT",
        },
      });
    }
    if (id) {
      const goal = await db.goal.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!goal || !visible(s, goal.employeeId))
        throw new AppError(404, "Goal not found.");
      const own = goal.employeeId === s.me?.id;
      const manager = canManageFor(s, goal.employeeId) && !own;
      if (!action && method === "PUT") {
        const b = goalSchema
          .omit({ employeeId: true, source: true })
          .parse(await json(req));
        await checkParent(ctx.companyId, goal.employeeId, b.type, b.parentId);
        if (["COMPLETED", "CANCELLED"].includes(goal.status))
          throw new AppError(409, "Closed goals cannot be edited.");
        if (
          !manager &&
          !(own && ["DRAFT", "PENDING_APPROVAL"].includes(goal.status))
        )
          throw new AppError(403, "Approved goals are changed by the manager.");
        return db.goal.update({
          where: { id: goal.id },
          data: { ...b, dueDate: b.dueDate ? dayDate(b.dueDate) : null },
        });
      }
      if (action === "progress" && method === "PUT") {
        const b = z
          .object({
            progress: z.number().int().min(0).max(100),
            actual: text(100).nullable(),
          })
          .strict()
          .parse(await json(req));
        if (goal.status !== "APPROVED")
          throw new AppError(409, "Progress is tracked on approved goals.");
        if (!own && !manager)
          throw new AppError(403, "You cannot update this goal.");
        if (goal.type === "OKR")
          throw new AppError(
            409,
            "An objective's progress comes from its key results.",
          );
        return db.$transaction(async (tx) => {
          const saved = await tx.goal.update({
            where: { id: goal.id },
            data: b,
          });
          await rollUp(tx, goal.parentId);
          return saved;
        });
      }
      if (action === "status" && method === "POST") {
        const b = z
          .object({
            status: z.enum([
              "PENDING_APPROVAL",
              "APPROVED",
              "DRAFT",
              "COMPLETED",
              "CANCELLED",
            ]),
          })
          .strict()
          .parse(await json(req));
        const allowed =
          (b.status === "PENDING_APPROVAL" && own && goal.status === "DRAFT") ||
          (b.status === "APPROVED" &&
            manager &&
            ["DRAFT", "PENDING_APPROVAL"].includes(goal.status)) ||
          (b.status === "DRAFT" &&
            manager &&
            goal.status === "PENDING_APPROVAL") ||
          (b.status === "COMPLETED" && manager && goal.status === "APPROVED") ||
          (b.status === "CANCELLED" &&
            (manager || (own && goal.status === "DRAFT")));
        if (!allowed)
          throw new AppError(403, "This status change is not allowed.");
        return db.$transaction(async (tx) => {
          const saved = await tx.goal.update({
            where: { id: goal.id },
            data: {
              status: b.status,
              ...(b.status === "APPROVED"
                ? { approvedBy: ctx.userId, approvedAt: new Date() }
                : {}),
            },
          });
          await audit(
            tx,
            ctx,
            b.status,
            "goals",
            goal.id,
            { status: goal.status },
            { status: b.status },
            ip(req),
          );
          return saved;
        });
      }
    }
  }

  if (resource === "reviews") {
    if (!id && method === "GET")
      return db.performanceReview.findMany({
        where: {
          companyId: ctx.companyId,
          ...where(s, req.nextUrl.searchParams),
          ...(req.nextUrl.searchParams.get("cycleId")
            ? { cycleId: req.nextUrl.searchParams.get("cycleId")! }
            : {}),
        },
        include: {
          employee: employeeSelect,
          cycle: {
            select: {
              id: true,
              name: true,
              status: true,
              selfReview: true,
              peerReview: true,
              ratingScale: true,
              ratingLabels: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
    if (id) {
      const review = await db.performanceReview.findFirst({
        where: { id, companyId: ctx.companyId },
        include: { cycle: true, employee: employeeSelect },
      });
      if (!review || !visible(s, review.employeeId))
        throw new AppError(404, "Review not found.");
      const own = review.employeeId === s.me?.id;
      const reviewer =
        !own &&
        (s.all ||
          (s.me &&
            review.reviewerEmployeeId === s.me.id &&
            s.team.includes(review.employeeId)));
      // Employees do not see the manager's assessment until it is completed,
      // and see peer input only as an unnamed summary after that.
      if (!action && method === "GET") {
        const peers = await db.peerReview.findMany({
          where: { reviewId: review.id },
          include: {
            reviewer: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        const done = ["COMPLETED", "ACKNOWLEDGED"].includes(review.status);
        const submitted = peers.filter((p) => p.status === "SUBMITTED");
        const summary = {
          requested: peers.length,
          submitted: submitted.length,
          averageRating: submitted.length
            ? Math.round(
                (submitted.reduce((a, p) => a + (p.rating ?? 0), 0) /
                  submitted.length) *
                  10,
              ) / 10
            : null,
        };
        if (own && !s.all)
          return {
            ...review,
            ...(done
              ? {}
              : {
                  managerRating: null,
                  managerComments: null,
                  strengths: null,
                  improvements: null,
                  developmentPlan: null,
                  finalRating: null,
                }),
            calibrationNote: null,
            peers: done
              ? {
                  ...summary,
                  comments: submitted.map((p) => p.comments).filter(Boolean),
                }
              : null,
          };
        return { ...review, peers: { ...summary, items: peers } };
      }
      if (review.cycle.status !== "ACTIVE")
        throw new AppError(409, "The review cycle is not active.");
      const scale = review.cycle.ratingScale;
      if (action === "peers" && method === "POST") {
        if (!reviewer)
          throw new AppError(
            403,
            "Only the employee's manager or HR requests peer reviews.",
          );
        if (!review.cycle.peerReview)
          throw new AppError(409, "This cycle does not use peer reviews.");
        if (["COMPLETED", "ACKNOWLEDGED"].includes(review.status))
          throw new AppError(409, "The review is already completed.");
        const b = peerSchema.parse(await json(req));
        const ids = [...new Set(b.employeeIds)];
        if (ids.includes(review.employeeId))
          throw new AppError(
            422,
            "Peers are colleagues other than the employee.",
          );
        const found = await db.employee.findMany({
          where: {
            id: { in: ids },
            companyId: ctx.companyId,
            status: { in: ["Active", "Probation", "On notice"] },
          },
          select: { id: true, userId: true },
        });
        if (found.length !== ids.length)
          throw new AppError(404, "One of the colleagues was not found.");
        await db.$transaction(async (tx) => {
          await tx.peerReview.createMany({
            data: ids.map((reviewerEmployeeId) => ({
              companyId: ctx.companyId,
              reviewId: review.id,
              reviewerEmployeeId,
              requestedBy: ctx.userId,
            })),
            skipDuplicates: true,
          });
          await audit(
            tx,
            ctx,
            "REQUEST_PEERS",
            "performance_reviews",
            review.id,
            undefined,
            { peers: ids.length },
            ip(req),
          );
        });
        await notify(
          ctx.companyId,
          found.map((f) => f.userId),
          "approval.requested",
          {
            item: `Peer review for ${review.employee.firstName} ${review.employee.lastName}`,
          },
          "/performance",
        );
        return db.peerReview.findMany({ where: { reviewId: review.id } });
      }
      if (action === "calibrate" && method === "POST") {
        requirePermission(ctx, "performance.manage");
        if (!["COMPLETED", "ACKNOWLEDGED"].includes(review.status))
          throw new AppError(
            409,
            "Calibrate after the manager completes the review.",
          );
        const b = z
          .object({ finalRating: rating(scale), note: text(2000).min(3) })
          .strict()
          .parse(await json(req));
        return db.$transaction(async (tx) => {
          const saved = await tx.performanceReview.update({
            where: { id: review.id },
            data: {
              finalRating: b.finalRating,
              calibrationNote: b.note,
              calibratedBy: ctx.userId,
              calibratedAt: new Date(),
            },
          });
          await audit(
            tx,
            ctx,
            "CALIBRATE",
            "performance_reviews",
            review.id,
            { finalRating: review.finalRating },
            { finalRating: b.finalRating, note: b.note },
            ip(req),
          );
          return saved;
        });
      }
      let data: Prisma.PerformanceReviewUpdateInput;
      if (action === "self" && method === "PUT") {
        if (!own)
          throw new AppError(
            403,
            "Only the employee completes the self review.",
          );
        if (review.status !== "PENDING_SELF")
          throw new AppError(409, "The self review is already submitted.");
        const b = z
          .object({
            selfRating: rating(scale),
            selfComments: text(5000).min(3),
          })
          .strict()
          .parse(await json(req));
        data = { ...b, status: "PENDING_MANAGER", selfSubmittedAt: new Date() };
      } else if (action === "manager" && method === "PUT") {
        if (!reviewer)
          throw new AppError(
            403,
            "Only the employee's manager or HR completes this review.",
          );
        if (review.status !== "PENDING_MANAGER")
          throw new AppError(
            409,
            "This review is not waiting for the manager.",
          );
        const b = z
          .object({
            managerRating: rating(scale),
            managerComments: text(5000).min(3),
            strengths: text(3000).nullable().default(null),
            improvements: text(3000).nullable().default(null),
            developmentPlan: text(3000).nullable().default(null),
          })
          .strict()
          .parse(await json(req));
        // The manager's rating is final unless HR calibrates it.
        data = {
          ...b,
          finalRating: b.managerRating,
          status: "COMPLETED",
          managerSubmittedAt: new Date(),
        };
      } else if (action === "acknowledge" && method === "POST") {
        if (!own || review.status !== "COMPLETED")
          throw new AppError(
            409,
            "Only completed reviews can be acknowledged by the employee.",
          );
        data = { status: "ACKNOWLEDGED", acknowledgedAt: new Date() };
      } else throw new AppError(404, "Endpoint not found.");
      return db.$transaction(async (tx) => {
        const saved = await tx.performanceReview.update({
          where: { id: review.id },
          data,
        });
        await audit(
          tx,
          ctx,
          action.toUpperCase(),
          "performance_reviews",
          review.id,
          { status: review.status },
          { status: saved.status },
          ip(req),
        );
        return saved;
      });
    }
  }

  // Peer reviews requested from the signed-in employee.
  if (resource === "peer-reviews") {
    if (!s.me)
      throw new AppError(403, "Your account needs a linked employee record.");
    if (!id && method === "GET")
      return db.peerReview.findMany({
        where: { companyId: ctx.companyId, reviewerEmployeeId: s.me.id },
        include: {
          review: {
            select: {
              employee: {
                select: { firstName: true, lastName: true, employeeCode: true },
              },
              cycle: {
                select: {
                  name: true,
                  status: true,
                  ratingScale: true,
                  ratingLabels: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    if (id && method === "PUT") {
      const peer = await db.peerReview.findFirst({
        where: {
          id,
          companyId: ctx.companyId,
          reviewerEmployeeId: s.me.id,
        },
        include: { review: { include: { cycle: true } } },
      });
      if (!peer) throw new AppError(404, "Peer review not found.");
      if (peer.status !== "REQUESTED")
        throw new AppError(409, "You have already responded.");
      if (
        peer.review.cycle.status !== "ACTIVE" ||
        ["COMPLETED", "ACKNOWLEDGED"].includes(peer.review.status)
      )
        throw new AppError(409, "This review is closed.");
      const b = z
        .union([
          z
            .object({
              rating: rating(peer.review.cycle.ratingScale),
              comments: text(3000).min(3),
            })
            .strict(),
          z.object({ decline: z.literal(true) }).strict(),
        ])
        .parse(await json(req));
      return db.peerReview.update({
        where: { id: peer.id },
        data:
          "decline" in b
            ? { status: "DECLINED", submittedAt: new Date() }
            : {
                status: "SUBMITTED",
                rating: b.rating,
                comments: b.comments,
                submittedAt: new Date(),
              },
      });
    }
  }
  // Performance history across cycles for one employee.
  if (resource === "history" && method === "GET") {
    const employeeId =
      req.nextUrl.searchParams.get("employeeId") ?? s.me?.id ?? "";
    if (
      !employeeId ||
      !visible(s, employeeId) ||
      !(await db.employee.findFirst({
        where: { id: employeeId, companyId: ctx.companyId },
        select: { id: true },
      }))
    )
      throw new AppError(404, "Employee not found.");
    const own = employeeId === s.me?.id && !s.all;
    const [reviews, goals] = await Promise.all([
      db.performanceReview.findMany({
        where: { companyId: ctx.companyId, employeeId },
        include: {
          cycle: {
            select: {
              id: true,
              name: true,
              periodStart: true,
              periodEnd: true,
              ratingScale: true,
              ratingLabels: true,
            },
          },
          peerReviews: {
            where: { status: "SUBMITTED" },
            select: { rating: true },
          },
        },
        orderBy: { cycle: { periodStart: "desc" } },
      }),
      db.goal.groupBy({
        by: ["cycleId", "status"],
        where: { companyId: ctx.companyId, employeeId },
        _count: { _all: true },
        _avg: { progress: true },
      }),
    ]);
    return reviews.map((r) => {
      const done = ["COMPLETED", "ACKNOWLEDGED"].includes(r.status);
      const cycleGoals = goals.filter((g) => g.cycleId === r.cycleId);
      const peers = r.peerReviews.map((p) => p.rating ?? 0);
      return {
        cycle: r.cycle,
        status: r.status,
        selfRating: r.selfRating,
        managerRating: own && !done ? null : r.managerRating,
        finalRating: own && !done ? null : r.finalRating,
        calibrated: !!r.calibratedAt,
        peerAverage:
          (!own || done) && peers.length
            ? Math.round(
                (peers.reduce((a, b) => a + b, 0) / peers.length) * 10,
              ) / 10
            : null,
        goals: {
          total: cycleGoals.reduce((a, g) => a + g._count._all, 0),
          completed: cycleGoals
            .filter((g) => g.status === "COMPLETED")
            .reduce((a, g) => a + g._count._all, 0),
        },
      };
    });
  }
  // Names only, so colleagues can address feedback to each other.
  if (resource === "people" && method === "GET")
    return db.employee.findMany({
      where: {
        companyId: ctx.companyId,
        status: { in: ["Active", "Probation", "On notice"] },
      },
      select: { id: true, employeeCode: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
      take: 1000,
    });
  if (resource === "feedback") {
    if (method === "GET") {
      const w = where(s, req.nextUrl.searchParams);
      const onlyOwn =
        s.me &&
        (w as { employeeId?: unknown }).employeeId === s.me.id &&
        !s.all;
      return db.feedback.findMany({
        where: {
          companyId: ctx.companyId,
          ...w,
          ...(onlyOwn ? { visibleToEmployee: true } : {}),
        },
        include: { employee: employeeSelect },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    }
    if (method === "POST") {
      const b = z
        .object({
          employeeId: z.string().min(1),
          kind: z.enum(["PRAISE", "SUGGESTION", "NOTE"]),
          text: text(3000).min(3),
          visibleToEmployee: z.boolean().default(true),
        })
        .strict()
        .parse(await json(req));
      if (b.employeeId === s.me?.id)
        throw new AppError(422, "Feedback is given to someone else.");
      const colleague = await db.employee.findFirst({
        where: { id: b.employeeId, companyId: ctx.companyId },
      });
      if (!colleague) throw new AppError(404, "Employee not found.");
      // Private notes are for managers and HR; colleagues can give visible praise.
      if (
        !canManageFor(s, b.employeeId) &&
        (!b.visibleToEmployee || b.kind === "NOTE")
      )
        throw new AppError(
          403,
          "Private notes are limited to the employee's manager and HR.",
        );
      return db.feedback.create({
        data: {
          ...b,
          companyId: ctx.companyId,
          authorId: ctx.userId,
          authorName: ctx.name,
        },
      });
    }
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
