import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { requireFeature } from "@/modules/saas/service";
import { assertPayrollOpen } from "@/modules/payroll/compute";
import { dayDate, localDay } from "@/modules/time/rules";
type Tx = Prisma.TransactionClient;
const text = z.string().trim().min(1).max(150);
const optional = z.string().trim().max(1000).nullable().default(null);
const id = z.string().min(1).max(100);
const jobSchema = z
  .object({
    code: text,
    name: text,
    description: optional,
    branchId: id.nullable().default(null),
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  })
  .strict();
const assignmentSchema = z
  .object({
    jobId: id,
    employeeId: id,
    title: text,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    note: optional,
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.endsAt) > Date.parse(v.startsAt) &&
      Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 36 * 3600000,
    "Use a work period of no more than 36 hours, with end after start.",
  );
const progressSchema = z
  .object({
    status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    progress: z.number().int().min(0).max(100),
    note: optional,
  })
  .strict();
const agencySchema = z
  .object({
    name: text,
    contactName: optional,
    email: z.email().nullable().default(null),
    phone: z.string().max(40).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();
const contractSchema = z
  .object({
    employeeId: id,
    agencyId: id,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reference: optional,
    notes: optional,
    status: z.enum(["ACTIVE", "ENDED"]).default("ACTIVE"),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, "End date cannot precede start date.");
const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
};
const missing = () => new AppError(404, "Record not found in this company.");
async function own(tx: Tx, ctx: Context) {
  const e = await tx.employee.findFirst({
    where: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      status: { not: "Inactive" },
    },
  });
  if (!e) throw new AppError(404, "Active employee account required.");
  return e;
}
async function staff(tx: Tx, ctx: Context, employeeId: string) {
  const e = await tx.employee.findFirst({
    where: {
      companyId: ctx.companyId,
      id: employeeId,
      status: { not: "Inactive" },
    },
  });
  if (!e) throw missing();
  return e;
}
async function change<T>(ctx: Context, fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.companyId}))::text`;
      return fn(tx);
    },
    { timeout: 20000 },
  );
}
async function record(
  tx: Tx,
  ctx: Context,
  kind: string,
  saved: { id: string },
  details: unknown,
) {
  await audit(
    tx,
    ctx,
    "UPDATE",
    kind,
    saved.id,
    undefined,
    details as Prisma.InputJsonValue,
  );
  return saved;
}
const range = (req: NextRequest) =>
  z
    .object({ from: z.iso.date(), to: z.iso.date() })
    .refine(
      (v) =>
        v.to >= v.from &&
        Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
      "Choose a date range of up to one year.",
    )
    .parse({
      from:
        req.nextUrl.searchParams.get("from") ??
        new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      to:
        req.nextUrl.searchParams.get("to") ??
        new Date().toISOString().slice(0, 10),
    });

export async function workforceRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const resource = path[1],
    rowId = path[2],
    action = path[3],
    method = req.method,
    companyId = ctx.companyId;
  if (
    path.length > 4 ||
    (action && !(resource === "assignments" && action === "progress"))
  )
    throw missing();
  if (
    ["jobs", "assignments", "agencies", "contracts"].includes(resource) &&
    !action &&
    ((method === "POST" && rowId) || (method === "PUT" && !rowId))
  )
    throw missing();
  if (resource === "sites" && !rowId) return sites(req, ctx);
  if (resource === "breaks") return breaks(req, ctx, rowId);
  const feature =
    resource === "agencies" || resource === "contracts"
      ? "contractors"
      : resource === "assignments"
        ? "workplanning"
        : "jobtracking";
  await requireFeature(companyId, feature);
  const manages = ctx.permissions.includes("attendance.manage");
  if (!manages && !["agencies", "contracts"].includes(resource))
    requirePermission(ctx, "attendance.self");
  if (resource === "jobs") {
    if (method === "GET" && !rowId)
      return db.workJob.findMany({
        where: { companyId, ...(!manages ? { status: "ACTIVE" } : {}) },
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        take: 1000,
      });
    requirePermission(ctx, "attendance.manage");
    if (!["POST", "PUT"].includes(method)) throw missing();
    const b = jobSchema.parse(await json(req));
    return change(ctx, async (tx) => {
      if (
        b.branchId &&
        !(await tx.branch.findFirst({ where: { id: b.branchId, companyId } }))
      )
        throw missing();
      if (
        rowId &&
        !(await tx.workJob.findFirst({ where: { id: rowId, companyId } }))
      )
        throw missing();
      if (
        rowId &&
        b.status !== "ACTIVE" &&
        (await tx.workLog.count({
          where: { companyId, jobId: rowId, endedAt: null },
        }))
      )
        throw new AppError(409, "Stop active timers before closing this job.");
      const saved = rowId
        ? await tx.workJob.update({ where: { id: rowId }, data: b })
        : await tx.workJob.create({ data: { ...b, companyId } });
      await record(tx, ctx, "work_jobs", saved, b);
      return saved;
    });
  }
  if (resource === "assignments") {
    if (method === "GET" && !rowId) {
      const q = range(req);
      const e = !manages
        ? await db.employee.findFirst({
            where: { companyId, userId: ctx.userId },
          })
        : null;
      return db.workAssignment.findMany({
        where: {
          companyId,
          ...(!manages ? { employeeId: e?.id ?? "" } : {}),
          startsAt: { lt: new Date(Date.parse(q.to) + 86400000) },
          endsAt: { gte: dayDate(q.from) },
        },
        include: {
          job: { select: { id: true, name: true } },
          employee: { select: employeeSelect },
        },
        orderBy: { startsAt: "asc" },
        take: 1000,
      });
    }
    if (method === "PUT" && rowId && action === "progress") {
      const b = progressSchema.parse(await json(req));
      return change(ctx, async (tx) => {
        const old = await tx.workAssignment.findFirst({
          where: { id: rowId, companyId },
          include: { employee: { select: { userId: true } } },
        });
        if (!old) throw missing();
        if (!manages && old.employee.userId !== ctx.userId)
          throw new AppError(
            403,
            "You may update only your assigned activities.",
          );
        if (
          !manages &&
          (b.status === "CANCELLED" || old.status === "CANCELLED")
        )
          throw new AppError(403, "HR manages cancellations.");
        const saved = await tx.workAssignment.update({
          where: { id: rowId },
          data: {
            ...b,
            progress:
              b.status === "COMPLETED"
                ? 100
                : b.status === "PLANNED"
                  ? 0
                  : b.progress,
          },
        });
        await record(tx, ctx, "work_assignments", saved, b);
        return saved;
      });
    }
    requirePermission(ctx, "attendance.manage");
    if (!["POST", "PUT"].includes(method) || action) throw missing();
    const b = assignmentSchema.parse(await json(req));
    return change(ctx, async (tx) => {
      const e = await staff(tx, ctx, b.employeeId);
      const job = await tx.workJob.findFirst({
        where: { id: b.jobId, companyId, status: "ACTIVE" },
      });
      if (!job) throw missing();
      const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
        }),
        from = dayDate(localDay(new Date(b.startsAt), company.timezone)),
        to = dayDate(localDay(new Date(b.endsAt), company.timezone));
      if (from < e.joinedAt)
        throw new AppError(422, "Assignment cannot precede joining date.");
      if (
        await tx.leaveRequest.count({
          where: {
            companyId,
            employeeId: e.id,
            status: "Approved",
            startDate: { lte: to },
            endDate: { gte: from },
          },
        })
      )
        throw new AppError(
          409,
          "The employee has approved leave during this assignment.",
        );
      if (
        await tx.workAssignment.count({
          where: {
            companyId,
            employeeId: e.id,
            id: { not: rowId ?? "" },
            status: { not: "CANCELLED" },
            startsAt: { lt: new Date(b.endsAt) },
            endsAt: { gt: new Date(b.startsAt) },
          },
        })
      )
        throw new AppError(
          409,
          "This employee already has an overlapping assignment.",
        );
      if (
        rowId &&
        !(await tx.workAssignment.findFirst({
          where: { id: rowId, companyId },
        }))
      )
        throw missing();
      const data = {
        ...b,
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
      };
      const saved = rowId
        ? await tx.workAssignment.update({ where: { id: rowId }, data })
        : await tx.workAssignment.create({ data: { ...data, companyId } });
      await record(tx, ctx, "work_assignments", saved, b);
      return saved;
    });
  }
  if (resource === "logs") {
    if (method === "GET" && !rowId) {
      const q = range(req);
      const e = !manages
        ? await db.employee.findFirst({
            where: { companyId, userId: ctx.userId },
          })
        : null;
      return db.workLog.findMany({
        where: {
          companyId,
          ...(!manages ? { employeeId: e?.id ?? "" } : {}),
          OR: [
            { endedAt: null },
            {
              startedAt: {
                gte: dayDate(q.from),
                lt: new Date(Date.parse(q.to) + 86400000),
              },
            },
          ],
        },
        include: {
          job: { select: { id: true, name: true } },
          employee: { select: employeeSelect },
        },
        orderBy: { startedAt: "desc" },
        take: 1000,
      });
    }
    requirePermission(ctx, "attendance.self");
    if (method !== "POST" || !["start", "stop"].includes(rowId ?? ""))
      throw missing();
    const b = z
      .object({ jobId: id.optional(), note: optional })
      .strict()
      .parse(await json(req));
    return change(ctx, async (tx) => {
      const e = await own(tx, ctx);
      const now = new Date();
      const open = await tx.attendance.findFirst({
        where: { companyId, employeeId: e.id, checkOut: null },
      });
      if (!open || now.getTime() - open.checkIn.getTime() > 36 * 3600000)
        throw new AppError(409, "Check in for the current workday first.");
      await assertPayrollOpen(tx, companyId, open.workDate);
      const running = await tx.workLog.findFirst({
        where: { companyId, employeeId: e.id, endedAt: null },
      });
      if (rowId === "stop") {
        if (!running) throw new AppError(409, "No job timer is running.");
        const saved = await tx.workLog.update({
          where: { id: running.id },
          data: { endedAt: now, note: b.note ?? running.note },
        });
        await record(tx, ctx, "work_logs", saved, { action: "STOP" });
        return saved;
      }
      if (running)
        throw new AppError(409, "Stop your current job timer first.");
      if (
        await tx.attendanceBreak.count({
          where: { companyId, employeeId: e.id, endedAt: null },
        })
      )
        throw new AppError(409, "End your break before starting a job timer.");
      const job = await tx.workJob.findFirst({
        where: { id: b.jobId ?? "", companyId, status: "ACTIVE" },
      });
      if (!job) throw missing();
      const saved = await tx.workLog.create({
        data: {
          companyId,
          employeeId: e.id,
          jobId: job.id,
          attendanceId: open.id,
          startedAt: now,
          note: b.note,
        },
      });
      await record(tx, ctx, "work_logs", saved, {
        action: "START",
        jobId: job.id,
      });
      return saved;
    });
  }
  if (resource === "agencies" || resource === "contracts") {
    requirePermission(ctx, "employees.write");
    if (method === "GET" && !rowId)
      return resource === "agencies"
        ? db.workAgency.findMany({
            where: { companyId },
            orderBy: { name: "asc" },
            take: 1000,
          })
        : db.workerContract.findMany({
            where: { companyId },
            include: {
              agency: { select: { name: true } },
              employee: { select: employeeSelect },
            },
            orderBy: { endsOn: "asc" },
            take: 1000,
          });
    if (!["POST", "PUT"].includes(method)) throw missing();
    const body = await json(req);
    return change(ctx, async (tx) => {
      if (resource === "agencies") {
        const b = agencySchema.parse(body);
        if (
          rowId &&
          !(await tx.workAgency.findFirst({ where: { id: rowId, companyId } }))
        )
          throw missing();
        const saved = rowId
          ? await tx.workAgency.update({ where: { id: rowId }, data: b })
          : await tx.workAgency.create({ data: { ...b, companyId } });
        await record(tx, ctx, "work_agencies", saved, b);
        return saved;
      }
      const b = contractSchema.parse(body);
      if (b.status === "ACTIVE") await staff(tx, ctx, b.employeeId);
      else if (
        !(await tx.employee.findFirst({
          where: { id: b.employeeId, companyId },
        }))
      )
        throw missing();
      if (
        !(await tx.workAgency.findFirst({
          where: {
            id: b.agencyId,
            companyId,
            ...(b.status === "ACTIVE" ? { active: true } : {}),
          },
        }))
      )
        throw missing();
      if (
        rowId &&
        !(await tx.workerContract.findFirst({
          where: { id: rowId, companyId },
        }))
      )
        throw missing();
      if (
        b.status === "ACTIVE" &&
        (await tx.workerContract.count({
          where: {
            companyId,
            employeeId: b.employeeId,
            id: { not: rowId ?? "" },
            status: "ACTIVE",
            startsOn: { lte: dayDate(b.endsOn) },
            endsOn: { gte: dayDate(b.startsOn) },
          },
        }))
      )
        throw new AppError(
          409,
          "An active agency contract already covers this period.",
        );
      const data = {
        ...b,
        startsOn: dayDate(b.startsOn),
        endsOn: dayDate(b.endsOn),
      };
      const saved = rowId
        ? await tx.workerContract.update({ where: { id: rowId }, data })
        : await tx.workerContract.create({ data: { ...data, companyId } });
      await record(tx, ctx, "worker_contracts", saved, b);
      return saved;
    });
  }
  throw missing();
}

async function breaks(req: NextRequest, ctx: Context, action?: string) {
  await requireFeature(ctx.companyId, "attendance");
  requirePermission(ctx, "attendance.self");
  return change(ctx, async (tx) => {
    const e = await own(tx, ctx),
      companyId = ctx.companyId;
    if (req.method === "GET" && !action)
      return tx.attendanceBreak.findMany({
        where: { companyId, employeeId: e.id },
        orderBy: { startedAt: "desc" },
        take: 100,
      });
    if (req.method !== "POST" || !["start", "stop"].includes(action ?? ""))
      throw missing();
    const open = await tx.attendance.findFirst({
        where: { companyId, employeeId: e.id, checkOut: null },
      }),
      now = new Date();
    if (!open || now.getTime() - open.checkIn.getTime() > 36 * 3600000)
      throw new AppError(409, "Check in for the current workday first.");
    await assertPayrollOpen(tx, companyId, open.workDate);
    const active = await tx.attendanceBreak.findFirst({
      where: { companyId, employeeId: e.id, endedAt: null },
    });
    if (action === "start") {
      if (active) throw new AppError(409, "You are already on a break.");
      await tx.workLog.updateMany({
        where: { companyId, employeeId: e.id, endedAt: null },
        data: { endedAt: now },
      });
      const saved = await tx.attendanceBreak.create({
        data: {
          companyId,
          employeeId: e.id,
          attendanceId: open.id,
          startedAt: now,
        },
      });
      await record(tx, ctx, "attendance_breaks", saved, { action: "START" });
      return saved;
    }
    if (!active) throw new AppError(409, "No break is running.");
    const saved = await tx.attendanceBreak.update({
      where: { id: active.id },
      data: { endedAt: now },
    });
    await record(tx, ctx, "attendance_breaks", saved, { action: "STOP" });
    return saved;
  });
}

async function sites(req: NextRequest, ctx: Context) {
  await requireFeature(ctx.companyId, "reports");
  requirePermission(ctx, "attendance.read");
  if (req.method !== "GET") throw missing();
  const companyId = ctx.companyId,
    company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const date = z.iso
    .date()
    .parse(
      req.nextUrl.searchParams.get("date") ??
        localDay(new Date(), company.timezone),
    );
  const [branches, employees, attendance, leave] = await Promise.all([
    db.branch.findMany({
      where: { companyId },
      select: { id: true, name: true, geofenceEnabled: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: {
        companyId,
        status: { not: "Inactive" },
        joinedAt: { lte: dayDate(date) },
      },
      select: { id: true, branchId: true },
    }),
    db.attendance.findMany({
      where: { companyId, workDate: dayDate(date) },
      select: {
        employeeId: true,
        checkOut: true,
        workedMinutes: true,
        lateMinutes: true,
        overtimeMinutes: true,
      },
    }),
    db.leaveRequest.findMany({
      where: {
        companyId,
        status: "Approved",
        startDate: { lte: dayDate(date) },
        endDate: { gte: dayDate(date) },
      },
      select: { employeeId: true },
    }),
  ]);
  const punches = new Map(attendance.map((a) => [a.employeeId, a])),
    onLeave = new Set(leave.map((l) => l.employeeId));
  return {
    date,
    sites: [
      ...branches,
      { id: null, name: "Unassigned site", geofenceEnabled: false },
    ].map((b) => {
      const team = employees.filter((e) => e.branchId === b.id),
        records = team.flatMap((e) => {
          const a = punches.get(e.id);
          return a ? [a] : [];
        });
      return {
        ...b,
        employees: team.length,
        attended: records.length,
        checkedIn: records.filter((a) => !a.checkOut).length,
        onLeave: team.filter((e) => onLeave.has(e.id)).length,
        noPunch: team.filter((e) => !punches.has(e.id) && !onLeave.has(e.id))
          .length,
        late: records.filter((a) => a.lateMinutes > 0).length,
        workedMinutes: records.reduce((s, a) => s + a.workedMinutes, 0),
        overtimeMinutes: records.reduce((s, a) => s + a.overtimeMinutes, 0),
      };
    }),
  };
}
