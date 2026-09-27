import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, withSystem } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";

export const ticketCategories = [
  "TECHNICAL",
  "BILLING",
  "ACCOUNT",
  "FEATURE_REQUEST",
  "OTHER",
] as const;
export const ticketPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const ticketStatuses = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;
const attachment = z
  .object({
    name: z.string().min(1).max(200),
    type: z.string().max(100),
    base64: z.string().max(2_900_000),
  })
  .strict()
  .optional();
const messageSchema = z
  .object({ body: z.string().trim().min(1).max(5000), attachment })
  .strict();
const ticketSchema = z
  .object({
    subject: z.string().trim().min(3).max(150),
    category: z.enum(ticketCategories),
    priority: z.enum(ticketPriorities).default("MEDIUM"),
    body: z.string().trim().min(1).max(5000),
    attachment,
  })
  .strict();
const messageSelect = {
  id: true,
  authorName: true,
  fromSupport: true,
  internal: true,
  body: true,
  attachmentName: true,
  attachmentType: true,
  attachmentSize: true,
  createdAt: true,
} as const;

function fileData(input: z.infer<typeof attachment>) {
  if (!input) return {};
  const file = validateUpload(input);
  return {
    attachmentName: file.name,
    attachmentType: file.type,
    attachmentSize: file.bytes.length,
    attachmentData: file.bytes,
  };
}
async function ticketFor(ctx: Context, id: string, support: boolean) {
  const ticket = await db.supportTicket.findFirst({
    where: { id, ...(support ? {} : { companyId: ctx.companyId }) },
    include: {
      company: { select: { name: true, code: true } },
      messages: {
        where: support ? {} : { internal: false },
        select: messageSelect,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket) throw new AppError(404, "Ticket not found.");
  return ticket;
}
export async function downloadAttachment(ctx: Context, messageId: string) {
  if (!ctx.isSuperAdmin) requirePermission(ctx, "support.use");
  const find = () =>
    db.supportMessage.findFirst({
      where: {
        id: messageId,
        ...(ctx.isSuperAdmin
          ? {}
          : { companyId: ctx.companyId, internal: false }),
      },
    });
  // The Super Admin support desk reads attachments across companies.
  const m = await (ctx.isSuperAdmin ? withSystem(find) : find());
  if (!m?.attachmentData) throw new AppError(404, "Attachment not found.");
  return new NextResponse(new Uint8Array(m.attachmentData), {
    headers: {
      "content-type": m.attachmentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${(m.attachmentName ?? "file").replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "no-store",
    },
  });
}

// Company users with support.use.
export async function supportRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  if (resource === "attachments" && id && req.method === "GET")
    return downloadAttachment(ctx, id);
  requirePermission(ctx, "support.use");
  if (resource !== "tickets") throw new AppError(404, "Endpoint not found.");
  if (!id && req.method === "GET") {
    const status = req.nextUrl.searchParams.get("status");
    return db.supportTicket.findMany({
      where: { companyId: ctx.companyId, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
  }
  if (!id && req.method === "POST") {
    await rateLimit(`support:${ctx.userId}`, 20);
    const b = ticketSchema.parse(await json(req, 3_000_000));
    const file = fileData(b.attachment);
    if (file.attachmentSize)
      await assertStorage(ctx.companyId, file.attachmentSize);
    return db.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdByName: ctx.name,
          subject: b.subject,
          category: b.category,
          priority: b.priority,
          messages: {
            create: {
              authorId: ctx.userId,
              authorName: ctx.name,
              body: b.body,
              ...file,
            },
          },
        },
      });
      await audit(
        tx,
        ctx,
        "CREATE",
        "support_tickets",
        ticket.id,
        undefined,
        { subject: b.subject, category: b.category },
        ip(req),
      );
      return ticket;
    });
  }
  if (id && !action && req.method === "GET") return ticketFor(ctx, id, false);
  if (id && action === "messages" && req.method === "POST") {
    await rateLimit(`support:${ctx.userId}`, 20);
    const b = messageSchema.parse(await json(req, 3_000_000));
    const ticket = await ticketFor(ctx, id, false);
    if (ticket.status === "CLOSED")
      throw new AppError(409, "This ticket is closed. Open a new ticket.");
    const file = fileData(b.attachment);
    if (file.attachmentSize)
      await assertStorage(ctx.companyId, file.attachmentSize);
    await db.$transaction([
      db.supportMessage.create({
        data: {
          ticketId: id,
          companyId: ctx.companyId,
          authorId: ctx.userId,
          authorName: ctx.name,
          body: b.body,
          ...file,
        },
      }),
      db.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          ...(["WAITING_ON_CUSTOMER", "RESOLVED"].includes(ticket.status)
            ? { status: "OPEN" }
            : {}),
        },
      }),
    ]);
    return ticketFor(ctx, id, false);
  }
  if (id && !action && req.method === "PUT") {
    const b = z
      .object({ status: z.enum(["CLOSED", "OPEN"]) })
      .strict()
      .parse(await json(req));
    const ticket = await ticketFor(ctx, id, false);
    await db.supportTicket.update({
      where: { id: ticket.id },
      data: { status: b.status },
    });
    return ticketFor(ctx, id, false);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Super Admin support desk across all companies.
export async function supportDesk(
  req: NextRequest,
  ctx: Context,
  id?: string,
  action?: string,
) {
  if (!id && req.method === "GET") {
    const status = req.nextUrl.searchParams.get("status");
    const companyId = req.nextUrl.searchParams.get("companyId");
    return db.supportTicket.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(companyId ? { companyId } : {}),
      },
      include: { company: { select: { name: true, code: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    });
  }
  if (id && !action && req.method === "GET") return ticketFor(ctx, id, true);
  if (id && action === "messages" && req.method === "POST") {
    const b = messageSchema
      .extend({ internal: z.boolean().default(false) })
      .parse(await json(req, 3_000_000));
    const ticket = await ticketFor(ctx, id, true);
    await db.$transaction([
      db.supportMessage.create({
        data: {
          ticketId: id,
          companyId: ticket.companyId,
          authorId: ctx.userId,
          authorName: `${ctx.name} (Support)`,
          fromSupport: true,
          internal: b.internal,
          body: b.body,
          ...fileData(b.attachment),
        },
      }),
      db.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          ...(!b.internal && ticket.status === "OPEN"
            ? { status: "WAITING_ON_CUSTOMER" }
            : {}),
        },
      }),
    ]);
    return ticketFor(ctx, id, true);
  }
  if (id && !action && req.method === "PUT") {
    const b = z
      .object({
        status: z.enum(ticketStatuses),
        priority: z.enum(ticketPriorities),
        assignedTo: z.string().trim().max(100).nullable(),
      })
      .strict()
      .parse(await json(req));
    await ticketFor(ctx, id, true);
    await db.supportTicket.update({ where: { id }, data: b });
    return ticketFor(ctx, id, true);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
