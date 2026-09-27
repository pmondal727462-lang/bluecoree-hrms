import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { deviceSchema, paginationSchema } from "@/modules/shared/validators";
import { securityEvent } from "@/modules/auth/security";
import { AppError } from "@/lib/errors";

const tokenSchema = z
  .object({
    token: z.string().trim().min(20).max(4096),
    platform: z.enum(["android", "ios"]),
  })
  .strict();
export async function mobileRoute(
  req: NextRequest,
  ctx: Context,
  resource: string,
) {
  if (resource === "devices") {
    if (req.method === "GET")
      return db.employeeDevice.findMany({
        where: { companyId: ctx.companyId, userId: ctx.userId, active: true },
        orderBy: { lastSeenAt: "desc" },
      });
    if (req.method === "POST") {
      const b = deviceSchema.parse(await json(req));
      await assertDeviceAllowed(ctx.companyId, ctx.userId, b.deviceId);
      return db.employeeDevice.upsert({
        where: {
          companyId_userId_deviceId: {
            companyId: ctx.companyId,
            userId: ctx.userId,
            deviceId: b.deviceId,
          },
        },
        create: { ...b, companyId: ctx.companyId, userId: ctx.userId },
        update: { ...b, active: true, lastSeenAt: new Date() },
      });
    }
  }
  if (resource === "push-token" && req.method === "POST") {
    const b = tokenSchema.parse(await json(req));
    return db.pushToken.upsert({
      where: { companyId_token: { companyId: ctx.companyId, token: b.token } },
      create: { ...b, companyId: ctx.companyId, userId: ctx.userId },
      update: {
        userId: ctx.userId,
        platform: b.platform,
        active: true,
        lastSeenAt: new Date(),
      },
    });
  }
  if (resource === "push-token" && req.method === "DELETE") {
    const b = z
      .object({ token: z.string().min(20) })
      .strict()
      .parse(await json(req));
    await db.pushToken.updateMany({
      where: { companyId: ctx.companyId, userId: ctx.userId, token: b.token },
      data: { active: false },
    });
    return { deactivated: true };
  }
  throw new AppError(405, "Mobile endpoint method not allowed.");
}

// Devices deactivated by an administrator cannot re-register or sign in.
export async function assertDeviceAllowed(
  companyId: string,
  userId: string,
  deviceId: string,
) {
  const device = await db.employeeDevice.findUnique({
    where: { companyId_userId_deviceId: { companyId, userId, deviceId } },
  });
  if (device && !device.active)
    throw new AppError(
      403,
      "This device was deactivated by your administrator.",
      "DEVICE_DEACTIVATED",
    );
}
export async function adminDevices(
  req: NextRequest,
  ctx: Context,
  id?: string,
) {
  requirePermission(ctx, "devices.manage");
  if (req.method === "GET" && !id) {
    const { page, pageSize, search } = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const where = {
      companyId: ctx.companyId,
      ...(search
        ? {
            OR: [
              {
                deviceName: { contains: search, mode: "insensitive" as const },
              },
              {
                user: {
                  name: { contains: search, mode: "insensitive" as const },
                },
              },
              {
                user: {
                  email: { contains: search, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await db.$transaction([
      db.employeeDevice.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
          _count: { select: { mobileSessions: true } },
        },
        orderBy: { lastSeenAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employeeDevice.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...d }) => ({
        ...d,
        activeSessions: _count.mobileSessions,
      })),
      total,
      page,
      pageSize,
    };
  }
  if (!id) throw new AppError(404, "Device not found.");
  const action =
    req.method === "DELETE"
      ? "remove"
      : z
          .object({
            action: z.enum(["deactivate", "activate", "force-logout"]),
          })
          .strict()
          .parse(await json(req)).action;
  return db.$transaction(async (tx) => {
    const device = await tx.employeeDevice.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!device) throw new AppError(404, "Device not found.");
    const linked = await tx.mobileSession.findMany({
      where: { companyId: ctx.companyId, deviceId: device.id },
      select: { sessionId: true },
    });
    const signedOut =
      action === "activate"
        ? 0
        : (
            await tx.session.deleteMany({
              where: { id: { in: linked.map((s) => s.sessionId) } },
            })
          ).count;
    if (action === "remove")
      await tx.employeeDevice.delete({ where: { id: device.id } });
    else if (action !== "force-logout")
      await tx.employeeDevice.update({
        where: { id: device.id },
        data: { active: action === "activate" },
      });
    await audit(
      tx,
      ctx,
      `DEVICE_${action.toUpperCase().replace("-", "_")}`,
      "devices",
      device.id,
      { active: device.active },
      { userId: device.userId, signedOut },
      ip(req),
    );
    await securityEvent(tx, {
      companyId: ctx.companyId,
      userId: device.userId,
      type: `DEVICE_${action.toUpperCase().replace("-", "_")}`,
      severity: action === "activate" ? "INFO" : "WARNING",
      details: { deviceId: device.deviceId, by: ctx.userId, signedOut },
      ip: ip(req),
    });
    return { id: device.id, action, signedOut };
  });
}
