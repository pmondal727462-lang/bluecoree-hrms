import { NextRequest } from "next/server";
import { protectedRoles } from "@/config/permissions";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { digest } from "@/lib/crypto";
import { permissions } from "@/config/permissions";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import {
  userSchema,
  userUpdateSchema,
  paginationSchema,
  text,
} from "@/modules/shared/validators";

const select = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  active: true,
  isSuperAdmin: true,
  roleId: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} as const;
import { enforceLimit } from "@/modules/saas/service";
export async function users(req: NextRequest, ctx: Context, id?: string) {
  requirePermission(ctx, req.method === "GET" ? "users.read" : "users.write");
  if (req.method === "GET") {
    const { page, pageSize, search } = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const where = {
      companyId: ctx.companyId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await db.$transaction([
      db.user.findMany({
        where,
        select,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      db.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  const b = id
    ? userUpdateSchema.parse(await json(req))
    : userSchema.parse(await json(req));
  const { password, ...rest } = b;
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  return db.$transaction(
    async (tx) => {
      const old = id
        ? await tx.user.findFirst({
            where: { id, companyId: ctx.companyId },
            include: { role: { include: { permissions: true } } },
          })
        : null;
      if (id && !old) throw new AppError(404, "User not found.", "NOT_FOUND");
      if (old?.isSuperAdmin || protectedRoles.includes(old?.role.name ?? ""))
        throw new AppError(
          403,
          "Protected administrator accounts cannot be modified here.",
          "FORBIDDEN",
        );
      if (id === ctx.userId)
        throw new AppError(
          409,
          "Use your own account settings; self role changes are blocked.",
        );
      if (
        old?.role.permissions.some(
          (p) => !ctx.permissions.includes(p.permissionKey),
        )
      )
        throw new AppError(
          403,
          "You cannot modify a user with permissions you do not hold.",
          "FORBIDDEN",
        );
      const role = await tx.role.findFirst({
        where: { id: rest.roleId || old?.roleId, companyId: ctx.companyId },
        include: { permissions: true },
      });
      if (
        !role ||
        role.name === "Super Admin" ||
        role.permissions.some((p) => !ctx.permissions.includes(p.permissionKey))
      )
        throw new AppError(403, "You cannot assign this role.", "FORBIDDEN");
      const saved = id
        ? await tx.user.update({
            where: { id_companyId: { id, companyId: ctx.companyId } },
            data: {
              ...rest,
              ...(passwordHash
                ? {
                    passwordHash,
                    mustSetPassword: false,
                    passwordSetAt: new Date(),
                    passwordChangedAt: new Date(),
                  }
                : {}),
            },
            select,
          })
        : await tx.user.create({
            data: {
              companyId: ctx.companyId,
              roleId: role.id,
              name: rest.name!,
              email: rest.email!,
              mobile: rest.mobile,
              passwordHash: passwordHash!,
              active: rest.active,
            },
            select,
          });
      if (id) await tx.session.deleteMany({ where: { userId: id } });
      if (saved.active) await enforceLimit(tx, ctx.companyId, "admins");
      await audit(
        tx,
        ctx,
        id ? "UPDATE" : "CREATE",
        "users",
        saved.id,
        old ? { roleId: old.roleId, active: old.active } : undefined,
        {
          roleId: saved.roleId,
          active: saved.active,
          passwordChanged: !!password,
        },
        ip(req),
      );
      return saved;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function resetEmployeePassword(
  req: NextRequest,
  ctx: Context,
  id: string,
) {
  requirePermission(ctx, "users.write");
  const user = await db.user.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      role: true,
      employee: {
        select: { employeeCode: true, firstName: true, lastName: true },
      },
    },
  });
  if (!user) throw new AppError(404, "User not found.", "NOT_FOUND");
  if (user.isSuperAdmin || protectedRoles.includes(user.role.name))
    throw new AppError(
      403,
      "Protected administrator accounts cannot be reset here.",
      "FORBIDDEN",
    );
  if (!user.employee)
    throw new AppError(
      422,
      "Only a user linked to an employee can use employee-code login.",
    );
  const employee = user.employee;
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.$transaction(async (tx) => {
    await tx.authChallenge.updateMany({
      where: { userId: id, kind: "employee_setup", usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.authChallenge.create({
      data: {
        companyId: ctx.companyId,
        userId: id,
        kind: "employee_setup",
        tokenHash: digest(`${id}:${token}`),
        expiresAt,
      },
    });
    await tx.user.update({
      where: { id },
      data: { mustSetPassword: true, passwordSetAt: null },
    });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit(
      tx,
      ctx,
      "EMPLOYEE_PASSWORD_RESET",
      "users",
      id,
      undefined,
      {
        employeeCode: employee.employeeCode,
        expiresAt: expiresAt.toISOString(),
      },
      ip(req),
    );
  });
  return { token, expiresAt, employee };
}
export async function roles(req: NextRequest, ctx: Context, id?: string) {
  requirePermission(ctx, req.method === "GET" ? "roles.read" : "roles.write");
  if (req.method === "GET")
    return {
      items: await db.role.findMany({
        where: { companyId: ctx.companyId },
        include: { permissions: true, _count: { select: { users: true } } },
        orderBy: { name: "asc" },
      }),
      permissions,
    };
  const b = z
    .object({
      name: text,
      permissions: z
        .array(z.enum(Object.keys(permissions) as [string, ...string[]]))
        .max(500),
    })
    .strict()
    .parse(await json(req));
  if ([...protectedRoles, "SaaS Admin"].includes(b.name))
    throw new AppError(403, "Administrator roles are protected.", "FORBIDDEN");
  if (b.permissions.some((p) => !ctx.permissions.includes(p)))
    throw new AppError(
      403,
      "You can only grant permissions you hold.",
      "FORBIDDEN",
    );
  return db.$transaction(
    async (tx) => {
      const old = id
        ? await tx.role.findFirst({
            where: { id, companyId: ctx.companyId },
            include: { permissions: true },
          })
        : null;
      if (id && !old) throw new AppError(404, "Role not found.", "NOT_FOUND");
      if (
        old &&
        ([...protectedRoles, "SaaS Admin"].includes(old.name) ||
          old.id === ctx.roleId ||
          old.permissions.some(
            (p) => !ctx.permissions.includes(p.permissionKey),
          ))
      )
        throw new AppError(
          403,
          "This role cannot be edited by your account.",
          "FORBIDDEN",
        );
      const saved = id
        ? await tx.role.update({
            where: { id_companyId: { id, companyId: ctx.companyId } },
            data: {
              name: b.name,
              permissions: {
                deleteMany: {},
                create: [...new Set(b.permissions)].map((permissionKey) => ({
                  permissionKey,
                })),
              },
            },
            include: { permissions: true },
          })
        : await tx.role.create({
            data: {
              companyId: ctx.companyId,
              name: b.name,
              permissions: {
                create: [...new Set(b.permissions)].map((permissionKey) => ({
                  permissionKey,
                })),
              },
            },
            include: { permissions: true },
          });
      if (id)
        await tx.session.deleteMany({
          where: { user: { roleId: id, companyId: ctx.companyId } },
        });
      await audit(
        tx,
        ctx,
        id ? "UPDATE" : "CREATE",
        "roles",
        saved.id,
        old
          ? {
              name: old.name,
              permissions: old.permissions.map((p) => p.permissionKey),
            }
          : undefined,
        b,
        ip(req),
      );
      return saved;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function sessions(req: NextRequest, ctx: Context, id?: string) {
  if (req.method === "GET")
    return db.session.findMany({
      where: { userId: ctx.userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        ip: true,
        userAgent: true,
      },
      orderBy: { createdAt: "desc" },
    });
  if (!id) throw new AppError(400, "Session ID required.");
  await db.$transaction(async (tx) => {
    const changed = await tx.session.deleteMany({
      where: { id, userId: ctx.userId },
    });
    if (!changed.count) throw new AppError(404, "Session not found.");
    await audit(
      tx,
      ctx,
      "REVOKE_SESSION",
      "auth",
      id,
      undefined,
      undefined,
      ip(req),
    );
  });
  return { revoked: true };
}
