import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Context } from "@/modules/auth/service";
import { paginationSchema } from "@/modules/shared/validators";

const querySchema = paginationSchema.extend({
  selectedId: z.string().max(150).optional(),
  excludeId: z.string().max(150).optional(),
});

// Small, permission-checked choices. Never return encrypted identity data or
// entire employee/user records simply to populate a form.
export async function references(
  req: NextRequest,
  ctx: Context,
  resource: string,
) {
  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const pagination = { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
  const scope = {
    companyId: ctx.companyId,
    ...(q.excludeId ? { id: { not: q.excludeId } } : {}),
  };
  const selected =
    q.selectedId && q.selectedId !== q.excludeId
      ? { companyId: ctx.companyId, id: q.selectedId }
      : null;
  if (resource === "employees") {
    requirePermission(ctx, "employees.read");
    const where = {
      ...scope,
      OR: ["firstName", "lastName", "employeeCode", "officialEmail"].map(
        (key) => ({
          [key]: { contains: q.search, mode: "insensitive" as const },
        }),
      ),
    };
    const select = {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
    } as const;
    const [rows, total, current] = await db.$transaction([
      db.employee.findMany({
        where,
        select,
        ...pagination,
        orderBy: [{ firstName: "asc" }, { id: "asc" }],
      }),
      db.employee.count({ where }),
      db.employee.findFirst({
        where: selected ?? { id: "", companyId: ctx.companyId },
        select,
      }),
    ]);
    const option = (e: (typeof rows)[number]) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName} (${e.employeeCode})`,
    });
    return {
      items: rows.map(option),
      total,
      page: q.page,
      pageSize: q.pageSize,
      selected: current ? option(current) : null,
    };
  }
  if (resource === "users") {
    requirePermission(ctx, "users.read");
    const where = {
      ...scope,
      OR: ["name", "email"].map((key) => ({
        [key]: { contains: q.search, mode: "insensitive" as const },
      })),
    };
    const select = { id: true, name: true, email: true } as const;
    const [rows, total, current] = await db.$transaction([
      db.user.findMany({
        where,
        select,
        ...pagination,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      db.user.count({ where }),
      db.user.findFirst({
        where: selected ?? { id: "", companyId: ctx.companyId },
        select,
      }),
    ]);
    const option = (u: (typeof rows)[number]) => ({
      id: u.id,
      name: `${u.name} (${u.email})`,
    });
    return {
      items: rows.map(option),
      total,
      page: q.page,
      pageSize: q.pageSize,
      selected: current ? option(current) : null,
    };
  }
  if (!["departments", "designations", "branches"].includes(resource))
    throw new AppError(404, "Unknown reference resource.");
  requirePermission(ctx, "organization.read");
  const model = (
    resource === "departments"
      ? db.department
      : resource === "designations"
        ? db.designation
        : db.branch
  ) as typeof db.department;
  const where = {
    ...scope,
    name: { contains: q.search, mode: "insensitive" as const },
  };
  const select = { id: true, name: true } as const;
  const [items, total, current] = await db.$transaction([
    model.findMany({
      where,
      select,
      ...pagination,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    model.count({ where }),
    model.findFirst({
      where: selected ?? { id: "", companyId: ctx.companyId },
      select,
    }),
  ]);
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    selected: current,
  };
}
