import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { enrollFace, faceProviderConfigured } from "./service";
import { requireFeature } from "@/modules/saas/service";

export async function faceStatus(userId: string, companyId: string) {
  const employee = await db.employee.findFirst({
    where: { companyId, userId },
    select: {
      id: true,
      faceRequired: true,
      faceProfile: { select: { active: true } },
    },
  });
  const required = !!employee;
  return {
    required,
    providerConfigured: faceProviderConfigured(),
    enrolled: !!employee?.faceProfile?.active,
    enrollmentRequired: required && !employee?.faceProfile?.active,
  };
}

export async function faceRoute(
  req: NextRequest,
  ctx: Context,
  action: string,
) {
  requirePermission(ctx, "attendance.self");
  if (action === "status" && req.method === "GET")
    return faceStatus(ctx.userId, ctx.companyId);
  if (action !== "enroll" || req.method !== "POST")
    throw new AppError(404, "Endpoint not found.");
  await requireFeature(ctx.companyId, "face");
  await rateLimit(`face-enroll:${ctx.userId}`, 5);
  const b = z
    .object({ faceSample: z.string().max(350000), consent: z.literal(true) })
    .strict()
    .parse(await json(req, 400000));
  const employee = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true },
  });
  if (!employee) throw new AppError(403, "No linked employee record.");
  if (await db.faceProfile.findUnique({ where: { employeeId: employee.id } }))
    throw new AppError(
      409,
      "Face is already registered. Contact HR for changes.",
    );
  const templateCiphertext = await enrollFace(b.faceSample);
  await db.$transaction(async (tx) => {
    await tx.faceProfile.create({
      data: {
        companyId: ctx.companyId,
        employeeId: employee.id,
        templateCiphertext,
      },
    });
    await audit(
      tx,
      ctx,
      "FACE_ENROLLED",
      "face",
      employee.id,
      undefined,
      { consent: true },
      ip(req),
    );
  });
  return { enrolled: true };
}

const facePage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).default(""),
  employeeId: z.string().optional(),
  status: z.enum(["SUCCESS", "FAILED", "REVIEW_REQUIRED"]).optional(),
});
// HR view of face enrolment and verification, and profile reset so an
// employee can enrol again. Templates are deleted, never shown.
export async function faceAdminRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  requirePermission(ctx, "attendance.manage");
  const [, resource, id] = path;
  const q = facePage.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (resource === "profiles" && !id && req.method === "GET") {
    const contains = { contains: q.search, mode: "insensitive" as const };
    const where = {
      companyId: ctx.companyId,
      status: { not: "Inactive" },
      ...(q.search
        ? {
            OR: [
              { employeeCode: contains },
              { firstName: contains },
              { lastName: contains },
            ],
          }
        : {}),
    };
    const since = new Date(Date.now() - 86400000);
    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          faceRequired: true,
          faceProfile: { select: { enrolledAt: true, active: true } },
          _count: {
            select: {
              faceVerificationLogs: {
                where: { status: "FAILED", createdAt: { gte: since } },
              },
            },
          },
        },
        orderBy: [{ employeeCode: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.employee.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...e }) => ({
        ...e,
        faceRequired: true,
        failedLast24h: _count.faceVerificationLogs,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  if (resource === "profiles" && id && req.method === "DELETE") {
    const profile = await db.faceProfile.findFirst({
      where: { companyId: ctx.companyId, employeeId: id },
    });
    if (!profile) throw new AppError(404, "No face profile for this employee.");
    await db.$transaction(async (tx) => {
      await tx.faceProfile.delete({ where: { id: profile.id } });
      await audit(
        tx,
        ctx,
        "FACE_PROFILE_RESET",
        "face",
        id,
        undefined,
        undefined,
        ip(req),
      );
    });
    return { reset: true };
  }
  if (resource === "logs" && !id && req.method === "GET") {
    const where = {
      companyId: ctx.companyId,
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      db.faceVerificationLog.findMany({
        where,
        select: {
          id: true,
          status: true,
          confidence: true,
          livenessPassed: true,
          reason: true,
          deviceId: true,
          ip: true,
          createdAt: true,
          attendanceId: true,
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.faceVerificationLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  throw new AppError(404, "Endpoint not found.");
}
