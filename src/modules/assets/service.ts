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
import { notify } from "@/modules/notifications/service";
import { dayDate } from "@/modules/time/rules";

type Tx = Prisma.TransactionClient;
export const assetCategories = [
  "LAPTOP",
  "DESKTOP",
  "MONITOR",
  "MOBILE",
  "PRINTER",
  "KEYBOARD",
  "MOUSE",
  "ACCESS_CARD",
  "SIM",
  "OTHER",
] as const;
const conditions = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
const text = (max: number) => z.string().trim().max(max);
const date = z.iso.date();
const assetSchema = z
  .object({
    assetCode: text(40).min(1),
    category: z.enum(assetCategories),
    name: text(150).min(2),
    brand: text(80).nullable().default(null),
    serialNumber: text(120).nullable().default(null),
    cost: z.number().min(0).max(100000000).nullable().default(null),
    purchaseDate: date.nullable().default(null),
    warrantyUntil: date.nullable().default(null),
    vendor: text(120).nullable().default(null),
    condition: z.enum(conditions).default("GOOD"),
    location: text(120).nullable().default(null),
    notes: text(2000).nullable().default(null),
  })
  .strict()
  .refine(
    (a) =>
      !a.purchaseDate || !a.warrantyUntil || a.warrantyUntil >= a.purchaseDate,
    { message: "The warranty must end after the purchase date." },
  );
const assignSchema = z
  .object({
    employeeId: z.string().min(1),
    issuedOn: date,
    expectedReturnOn: date.nullable().default(null),
    condition: z.enum(conditions).optional(),
    notes: text(1000).optional(),
  })
  .strict();
const returnSchema = z
  .object({
    returnedOn: date,
    condition: z.enum(conditions),
    notes: text(1000).optional(),
  })
  .strict();

const manage = (ctx: Context) => requirePermission(ctx, "assets.manage");
const canManage = (ctx: Context) => ctx.permissions.includes("assets.manage");
const holder = {
  where: { returnedOn: null },
  select: {
    id: true,
    issuedOn: true,
    expectedReturnOn: true,
    acknowledgedAt: true,
    employee: {
      select: { id: true, employeeCode: true, firstName: true, lastName: true },
    },
  },
} as const;
const toDates = <T extends Record<string, unknown>>(b: T) => ({
  ...b,
  purchaseDate: b.purchaseDate ? dayDate(b.purchaseDate as string) : null,
  warrantyUntil: b.warrantyUntil ? dayDate(b.warrantyUntil as string) : null,
});
async function findAsset(tx: Tx | typeof db, ctx: Context, id: string) {
  const a = await tx.asset.findFirst({
    where: { id, companyId: ctx.companyId },
  });
  if (!a) throw new AppError(404, "Asset not found.", "NOT_FOUND");
  return a;
}
const lock = (tx: Tx, id: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset:${id}`}))::text`;

// Assets held by an employee and not yet returned.
export const outstandingAssets = (
  tx: Tx | typeof db,
  companyId: string,
  employeeId: string,
) =>
  tx.assetAssignment.count({
    where: { companyId, employeeId, returnedOn: null },
  });

export async function assetsRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, id, action] = path;
  const method = req.method;
  if (!canManage(ctx)) requirePermission(ctx, "assets.self");

  // Assets issued to the signed-in employee.
  if (id === "mine" && method === "GET") {
    const e = await db.employee.findFirst({
      where: { companyId: ctx.companyId, userId: ctx.userId },
      select: { id: true },
    });
    if (!e) return [];
    return db.assetAssignment.findMany({
      where: { companyId: ctx.companyId, employeeId: e.id },
      include: {
        asset: {
          select: {
            assetCode: true,
            category: true,
            name: true,
            brand: true,
            serialNumber: true,
            warrantyUntil: true,
          },
        },
      },
      orderBy: [
        { returnedOn: { sort: "desc", nulls: "first" } },
        { issuedOn: "desc" },
      ],
    });
  }
  if (id === "assignments" && action && method === "POST") {
    // path: assets/assignments/:assignmentId/acknowledge
    const assignmentId = action;
    if (path[3] !== "acknowledge")
      throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
    const a = await db.assetAssignment.findFirst({
      where: {
        id: assignmentId,
        companyId: ctx.companyId,
        employee: { userId: ctx.userId },
        returnedOn: null,
      },
    });
    if (!a) throw new AppError(404, "Assignment not found.", "NOT_FOUND");
    if (a.acknowledgedAt)
      throw new AppError(409, "You have already acknowledged this asset.");
    return db.assetAssignment.update({
      where: { id: a.id },
      data: { acknowledgedAt: new Date() },
    });
  }

  manage(ctx);
  if (!id && method === "GET") {
    const q = req.nextUrl.searchParams;
    const warrantyDays = Number(q.get("warrantyWithin") ?? "");
    const search = q.get("q");
    return db.asset.findMany({
      where: {
        companyId: ctx.companyId,
        ...(q.get("status") ? { status: q.get("status")! } : {}),
        ...(q.get("category") ? { category: q.get("category")! } : {}),
        ...(q.get("employeeId")
          ? {
              assignments: {
                some: { employeeId: q.get("employeeId")!, returnedOn: null },
              },
            }
          : {}),
        ...(warrantyDays > 0
          ? {
              warrantyUntil: {
                gte: dayDate(new Date().toISOString().slice(0, 10)),
                lte: new Date(Date.now() + warrantyDays * 86400000),
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { assetCode: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
                { serialNumber: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { assignments: holder },
      orderBy: { assetCode: "asc" },
      take: 1000,
    });
  }
  if (id === "summary" && method === "GET") {
    const rows = await db.asset.groupBy({
      by: ["category", "status"],
      where: { companyId: ctx.companyId },
      _count: { _all: true },
      _sum: { cost: true },
    });
    return rows.map((r) => ({
      category: r.category,
      status: r.status,
      count: r._count._all,
      cost: r._sum.cost ?? 0,
    }));
  }
  if ((!id && method === "POST") || (id && !action && method === "PUT")) {
    const b = assetSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = id ? await findAsset(tx, ctx, id) : null;
      const clash = await tx.asset.findFirst({
        where: {
          companyId: ctx.companyId,
          assetCode: b.assetCode,
          ...(old ? { NOT: { id: old.id } } : {}),
        },
      });
      if (clash) throw new AppError(409, "Another asset uses this code.");
      const data = toDates(b);
      const saved = old
        ? await tx.asset.update({ where: { id: old.id }, data })
        : await tx.asset.create({
            data: { ...data, companyId: ctx.companyId, createdBy: ctx.userId },
          });
      await audit(
        tx,
        ctx,
        old ? "UPDATE" : "CREATE",
        "assets",
        saved.id,
        old ? { status: old.status, condition: old.condition } : undefined,
        { assetCode: saved.assetCode, condition: saved.condition },
        ip(req),
      );
      return saved;
    });
  }
  if (id && !action && method === "GET") {
    const a = await findAsset(db, ctx, id);
    const history = await db.assetAssignment.findMany({
      where: { assetId: a.id },
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true },
        },
      },
      orderBy: { issuedOn: "desc" },
    });
    return { ...a, history };
  }
  if (id && action === "assign" && method === "POST") {
    const b = assignSchema.parse(await json(req));
    if (b.expectedReturnOn && b.expectedReturnOn < b.issuedOn)
      throw new AppError(422, "The return date must follow the issue date.");
    const saved = await db.$transaction(async (tx) => {
      await lock(tx, id);
      const a = await findAsset(tx, ctx, id);
      if (a.status !== "IN_STOCK")
        throw new AppError(
          409,
          a.status === "ASSIGNED"
            ? "The asset is already issued. Record its return first."
            : `The asset is ${a.status.toLowerCase().replace("_", " ")}.`,
          "ASSET_UNAVAILABLE",
        );
      const e = await tx.employee.findFirst({
        where: {
          id: b.employeeId,
          companyId: ctx.companyId,
          status: { in: ["Active", "Probation", "On notice"] },
        },
        select: { id: true, userId: true },
      });
      if (!e) throw new AppError(404, "Employee not found or inactive.");
      const assignment = await tx.assetAssignment.create({
        data: {
          companyId: ctx.companyId,
          assetId: a.id,
          employeeId: e.id,
          issuedOn: dayDate(b.issuedOn),
          expectedReturnOn: b.expectedReturnOn
            ? dayDate(b.expectedReturnOn)
            : null,
          issueCondition: b.condition ?? a.condition,
          issueNotes: b.notes,
          issuedBy: ctx.userId,
        },
      });
      await tx.asset.update({
        where: { id: a.id },
        data: { status: "ASSIGNED", condition: b.condition ?? a.condition },
      });
      await audit(
        tx,
        ctx,
        "ISSUE",
        "assets",
        a.id,
        { status: a.status },
        { employeeId: e.id, issuedOn: b.issuedOn },
        ip(req),
      );
      return { assignment, userId: e.userId, asset: a };
    });
    await notify(
      ctx.companyId,
      [saved.userId],
      "approval.requested",
      {
        item: `Acknowledge receipt of ${saved.asset.name} (${saved.asset.assetCode})`,
      },
      "/assets",
    ).catch(() => undefined);
    return saved.assignment;
  }
  if (id && action === "return" && method === "POST") {
    const b = returnSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      await lock(tx, id);
      const a = await findAsset(tx, ctx, id);
      const open = await tx.assetAssignment.findFirst({
        where: { assetId: a.id, returnedOn: null },
      });
      if (!open) throw new AppError(409, "The asset is not issued to anyone.");
      if (b.returnedOn < open.issuedOn.toISOString().slice(0, 10))
        throw new AppError(422, "The return date is before the issue date.");
      const assignment = await tx.assetAssignment.update({
        where: { id: open.id },
        data: {
          returnedOn: dayDate(b.returnedOn),
          returnCondition: b.condition,
          returnNotes: b.notes,
          receivedBy: ctx.userId,
        },
      });
      // A damaged return goes for repair before it can be issued again.
      await tx.asset.update({
        where: { id: a.id },
        data: {
          status: b.condition === "DAMAGED" ? "IN_REPAIR" : "IN_STOCK",
          condition: b.condition,
        },
      });
      await audit(
        tx,
        ctx,
        "RETURN",
        "assets",
        a.id,
        { status: a.status },
        { condition: b.condition, returnedOn: b.returnedOn },
        ip(req),
      );
      return assignment;
    });
  }
  if (id && action === "status" && method === "POST") {
    const b = z
      .object({
        status: z.enum(["IN_STOCK", "IN_REPAIR", "RETIRED", "LOST"]),
        note: text(1000).min(3),
      })
      .strict()
      .parse(await json(req));
    return db.$transaction(async (tx) => {
      await lock(tx, id);
      const a = await findAsset(tx, ctx, id);
      const open = await tx.assetAssignment.findFirst({
        where: { assetId: a.id, returnedOn: null },
      });
      // Only a loss may close an open assignment without a return; the
      // employee's record then shows the loss instead of a return.
      if (open && b.status !== "LOST")
        throw new AppError(409, "Record the asset's return first.");
      if (open)
        await tx.assetAssignment.update({
          where: { id: open.id },
          data: {
            returnedOn: dayDate(new Date().toISOString().slice(0, 10)),
            returnCondition: "DAMAGED",
            returnNotes: `Reported lost: ${b.note}`,
            receivedBy: ctx.userId,
          },
        });
      const saved = await tx.asset.update({
        where: { id: a.id },
        data: {
          status: b.status,
          ...(b.status === "LOST" ? { condition: "DAMAGED" } : {}),
        },
      });
      await audit(
        tx,
        ctx,
        "STATUS",
        "assets",
        a.id,
        { status: a.status },
        { status: b.status, note: b.note },
        ip(req),
      );
      return saved;
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
