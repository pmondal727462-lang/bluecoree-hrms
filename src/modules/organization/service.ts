import { NextRequest } from "next/server";
import { enforceLimit } from "@/modules/saas/service";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, withSystem } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  provisionCompany,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import {
  companySchema,
  branchSchema,
  password,
  email,
  text,
  paginationSchema,
} from "@/modules/shared/validators";

export async function company(req: NextRequest, ctx: Context) {
  requirePermission(
    ctx,
    req.method === "GET" ? "company.read" : "company.write",
  );
  if (req.method === "GET") {
    // Suspension fields are managed by the provider, careers-page fields by
    // Recruitment and billing fields by Subscription, not these settings.
    const {
      status: _s,
      suspendedAt: _a,
      suspendReason: _r,
      careersEnabled: _c,
      careersIntro: _i,
      billingState: _b,
      billingEmail: _e,
      onboardingDismissedAt: _d,
      legalHold: _h,
      ...company
    } = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    return company;
  }
  const b = companySchema.parse(await json(req));
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.companyId}))::text`;
    const old = await tx.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
    });
    if (
      old.timezone !== b.timezone &&
      (await tx.attendance.count({ where: { companyId: ctx.companyId } }))
    )
      throw new AppError(
        409,
        "The time zone cannot be changed after attendance is recorded.",
      );
    if (
      [...old.workingDays].sort().join() !== [...b.workingDays].sort().join() &&
      (await tx.leaveRequest.count({
        where: {
          companyId: ctx.companyId,
          status: { in: ["Pending", "Approved"] },
        },
      }))
    )
      throw new AppError(
        409,
        "Resolve pending and approved leave before changing working weekdays.",
      );
    const result = await tx.company.update({
      where: { id: ctx.companyId },
      data: b,
    });
    await audit(
      tx,
      ctx,
      "UPDATE",
      "company",
      ctx.companyId,
      { name: old.name, code: old.code },
      { name: result.name, code: result.code, fields: Object.keys(b) },
      ip(req),
    );
    return result;
  });
}
export async function companies(req: NextRequest, ctx: Context) {
  if (!ctx.isSuperAdmin)
    throw new AppError(403, "Super Admin access is required.", "FORBIDDEN");
  // Listing and provisioning companies spans tenants.
  return withSystem(() => allCompanies(req, ctx));
}
async function allCompanies(req: NextRequest, ctx: Context) {
  if (req.method === "GET")
    return db.company.findMany({
      select: { id: true, name: true, code: true, createdAt: true },
      orderBy: { name: "asc" },
      take: 100,
    });
  const b = z
    .object({
      company: companySchema,
      admin: z.object({ name: text, email, password }).strict(),
    })
    .strict()
    .parse(await json(req));
  const passwordHash = await bcrypt.hash(b.admin.password, 12);
  return db.$transaction(
    async (tx) => {
      const c = await provisionCompany(tx, b.company);
      const role = await tx.role.findUniqueOrThrow({
        where: { companyId_name: { companyId: c.id, name: "Company Admin" } },
      });
      await tx.user.create({
        data: {
          companyId: c.id,
          roleId: role.id,
          name: b.admin.name,
          email: b.admin.email,
          passwordHash,
        },
      });
      await audit(
        tx,
        ctx,
        "CREATE",
        "companies",
        c.id,
        undefined,
        { name: c.name, code: c.code },
        ip(req),
      );
      return c;
    },
    { timeout: 20000 },
  );
}
export async function organization(
  req: NextRequest,
  ctx: Context,
  kind: string,
  id?: string,
) {
  requirePermission(
    ctx,
    req.method === "GET" ? "organization.read" : "organization.write",
  );
  if (!["departments", "designations", "branches"].includes(kind))
    throw new AppError(404, "Not found.");
  if (req.method === "GET") {
    const model = (
      kind === "departments"
        ? db.department
        : kind === "designations"
          ? db.designation
          : db.branch
    ) as typeof db.department;
    const q = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const where = {
      companyId: ctx.companyId,
      name: { contains: q.search, mode: "insensitive" as const },
    };
    // Preserve older list consumers; callers requesting pages receive totals.
    const paginated = req.nextUrl.searchParams.has("page");
    const items = await model.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: paginated ? q.pageSize : 500,
      ...(paginated ? { skip: (q.page - 1) * q.pageSize } : {}),
    });
    return paginated
      ? {
          items,
          total: await model.count({ where }),
          page: q.page,
          pageSize: q.pageSize,
        }
      : items;
  }
  const b =
    req.method === "DELETE"
      ? null
      : kind === "branches"
        ? branchSchema.parse(await json(req))
        : z
            .object({ name: text })
            .strict()
            .parse(await json(req));
  return db.$transaction(async (tx) => {
    const model = (
      kind === "departments"
        ? tx.department
        : kind === "designations"
          ? tx.designation
          : tx.branch
    ) as typeof tx.department;
    const old = id
      ? await model.findFirst({ where: { id, companyId: ctx.companyId } })
      : null;
    if (id && !old) throw new AppError(404, "Record not found.", "NOT_FOUND");
    if (req.method === "DELETE") {
      const field =
        kind === "departments"
          ? "departmentId"
          : kind === "designations"
            ? "designationId"
            : "branchId";
      if (
        await tx.employee.count({
          where: { companyId: ctx.companyId, [field]: id },
        })
      )
        throw new AppError(
          409,
          "Reassign employees before deleting this record.",
        );
      const where = { companyId: ctx.companyId, [field]: id };
      const [jobs, joiners, announcements] = await Promise.all([
        kind === "departments" ? tx.jobOpening.count({ where }) : 0,
        kind === "branches" ? 0 : tx.onboarding.count({ where }),
        kind === "designations" ? 0 : tx.announcement.count({ where }),
      ]);
      const inUse = [
        jobs && "job openings",
        joiners && "onboarding records",
        announcements && "announcements",
      ].filter(Boolean);
      if (inUse.length)
        throw new AppError(
          409,
          `Update the ${inUse.join(", ")} that use this record before deleting it.`,
        );
      await model.delete({
        where: { id_companyId: { id: id!, companyId: ctx.companyId } },
      });
      await audit(
        tx,
        ctx,
        "DELETE",
        kind,
        id,
        old ? { name: old.name } : undefined,
        undefined,
        ip(req),
      );
      return { deleted: true };
    }
    if (!id && kind === "branches")
      await enforceLimit(tx, ctx.companyId, "locations");
    const saved = id
      ? await model.update({
          where: { id_companyId: { id, companyId: ctx.companyId } },
          data: b!,
        })
      : await model.create({ data: { ...b!, companyId: ctx.companyId } });
    await audit(
      tx,
      ctx,
      id ? "UPDATE" : "CREATE",
      kind,
      saved.id,
      old ? { name: old.name } : undefined,
      { name: saved.name, fields: Object.keys(b!) },
      ip(req),
    );
    return saved;
  });
}
