import { NextRequest } from "next/server";
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
import { notify } from "@/modules/notifications/service";

const schema = z
  .object({
    title: z.string().trim().min(2).max(150),
    body: z.string().trim().min(2).max(10000),
    audience: z.enum(["ALL", "DEPARTMENT", "BRANCH"]),
    departmentId: z.string().nullable().default(null),
    branchId: z.string().nullable().default(null),
    pinned: z.boolean().default(false),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();

// Announcements visible to the signed-in user: everyone's, plus those for
// their department or work location.
export async function visibleAnnouncements(ctx: Context, take = 20) {
  const me = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { departmentId: true, branchId: true },
  });
  const all = ctx.permissions.includes("announcements.manage");
  return db.announcement.findMany({
    where: {
      companyId: ctx.companyId,
      publishedAt: { lte: new Date() },
      ...(all
        ? {}
        : {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            AND: [
              {
                OR: [
                  { audience: "ALL" },
                  ...(me?.departmentId
                    ? [
                        {
                          audience: "DEPARTMENT",
                          departmentId: me.departmentId,
                        },
                      ]
                    : []),
                  ...(me?.branchId
                    ? [{ audience: "BRANCH", branchId: me.branchId }]
                    : []),
                ],
              },
            ],
          }),
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take,
  });
}

export async function announcementsRoute(
  req: NextRequest,
  ctx: Context,
  id?: string,
) {
  if (!id && req.method === "GET") return visibleAnnouncements(ctx, 100);
  requirePermission(ctx, "announcements.manage");
  if (id && req.method === "DELETE") {
    const changed = await db.announcement.deleteMany({
      where: { id, companyId: ctx.companyId },
    });
    if (!changed.count) throw new AppError(404, "Announcement not found.");
    return { deleted: true };
  }
  const b = schema.parse(await json(req, 100000));
  if (
    b.audience === "DEPARTMENT" &&
    !(
      b.departmentId &&
      (await db.department.findFirst({
        where: { id: b.departmentId, companyId: ctx.companyId },
      }))
    )
  )
    throw new AppError(422, "Choose the department.");
  if (
    b.audience === "BRANCH" &&
    !(
      b.branchId &&
      (await db.branch.findFirst({
        where: { id: b.branchId, companyId: ctx.companyId },
      }))
    )
  )
    throw new AppError(422, "Choose the work location.");
  const data = { ...b, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null };
  const saved = await db.$transaction(async (tx) => {
    const old = id
      ? await tx.announcement.findFirst({
          where: { id, companyId: ctx.companyId },
        })
      : null;
    if (id && !old) throw new AppError(404, "Announcement not found.");
    const s = old
      ? await tx.announcement.update({ where: { id: old.id }, data })
      : await tx.announcement.create({
          data: {
            ...data,
            companyId: ctx.companyId,
            createdBy: ctx.userId,
            createdByName: ctx.name,
          },
        });
    await audit(
      tx,
      ctx,
      old ? "UPDATE" : "PUBLISH",
      "announcements",
      s.id,
      undefined,
      { title: b.title, audience: b.audience },
      ip(req),
    );
    return s;
  });
  if (!id) {
    const recipients = await db.user.findMany({
      where: {
        companyId: ctx.companyId,
        active: true,
        ...(b.audience === "DEPARTMENT"
          ? { employee: { departmentId: b.departmentId } }
          : {}),
        ...(b.audience === "BRANCH"
          ? { employee: { branchId: b.branchId } }
          : {}),
      },
      select: { id: true },
    });
    await notify(
      ctx.companyId,
      recipients.map((u) => u.id),
      "announcement.published",
      { title: b.title, body: b.body.slice(0, 300) },
      "/home",
    );
  }
  return saved;
}
