import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import { putFile, signedUrl } from "@/lib/storage";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";
import { linkedEmployee } from "@/modules/shared/team";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { paginationSchema } from "@/modules/shared/validators";

// Employees raise requests with their own HR/IT team (distinct from the
// provider support desk used by company administrators).
export const helpdeskCategories = [
  "ATTENDANCE",
  "PAYROLL",
  "LEAVE",
  "DOCUMENT",
  "HR",
  "IT",
  "OTHER",
] as const;
const statuses = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;
const attachment = z
  .object({
    name: z.string().min(1).max(200),
    type: z.string().max(120),
    base64: z.string().max(2_900_000),
  })
  .strict()
  .optional();
const ticketSchema = z
  .object({
    category: z.enum(helpdeskCategories),
    subject: z.string().trim().min(3).max(150),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    body: z.string().trim().min(3).max(5000),
    attachment,
  })
  .strict();
const messageSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    internal: z.boolean().default(false),
    attachment,
  })
  .strict();

async function fileFields(
  companyId: string,
  input: z.infer<typeof attachment>,
) {
  if (!input) return {};
  const upload = validateUpload(input);
  await assertStorage(companyId, upload.bytes.length);
  const stored = await putFile(companyId, upload.bytes, upload.type);
  return {
    fileName: upload.name,
    contentType: upload.type,
    size: upload.bytes.length,
    storageKey: stored.key,
  };
}

export async function helpdeskRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const agent = ctx.permissions.includes("helpdesk.manage");
  if (!agent) requirePermission(ctx, "helpdesk.self");
  const me = await linkedEmployee(ctx);
  const [, id, action, sub] = path;
  const method = req.method;

  if (id === "agents" && method === "GET") {
    requirePermission(ctx, "helpdesk.manage");
    return db.user.findMany({
      where: {
        companyId: ctx.companyId,
        active: true,
        role: { permissions: { some: { permissionKey: "helpdesk.manage" } } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  if (!id && method === "GET") {
    const q = req.nextUrl.searchParams;
    const scope = q.get("scope") === "all" && agent ? "all" : "own";
    if (scope === "own" && !me)
      throw new AppError(403, "Your account needs a linked employee record.");
    // Callers requesting pages get totals and subject/employee search; older
    // consumers keep the plain capped list.
    const paged = q.has("page");
    const p = paginationSchema.parse(Object.fromEntries(q));
    const contains = { contains: p.search, mode: "insensitive" as const };
    const where: Prisma.HelpdeskTicketWhereInput = {
      companyId: ctx.companyId,
      ...(scope === "own" ? { employeeId: me!.id } : {}),
      ...(q.get("status") ? { status: q.get("status")! } : {}),
      ...(q.get("mine") === "1" ? { assigneeUserId: ctx.userId } : {}),
      ...(paged && p.search
        ? {
            OR: [
              { subject: contains },
              { employee: { employeeCode: contains } },
              { employee: { firstName: contains } },
              { employee: { lastName: contains } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.helpdeskTicket.findMany({
        where,
        include: {
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
        skip: paged ? (p.page - 1) * p.pageSize : 0,
        take: paged ? p.pageSize : 200,
      }),
      paged ? db.helpdeskTicket.count({ where }) : 0,
    ]);
    return paged ? { items, total, page: p.page, pageSize: p.pageSize } : items;
  }
  if (!id && method === "POST") {
    if (!me)
      throw new AppError(403, "Your account needs a linked employee record.");
    await rateLimit(`helpdesk:${ctx.userId}`, 30);
    const b = ticketSchema.parse(await json(req, 3_000_000));
    const files = await fileFields(ctx.companyId, b.attachment);
    const ticket = await db.helpdeskTicket.create({
      data: {
        companyId: ctx.companyId,
        employeeId: me.id,
        category: b.category,
        subject: b.subject,
        priority: b.priority,
        messages: {
          create: {
            authorId: ctx.userId,
            authorName: ctx.name,
            body: b.body,
            ...files,
          },
        },
      },
    });
    await notify(
      ctx.companyId,
      await usersWithPermission(ctx.companyId, "helpdesk.manage"),
      "ticket.created",
      {
        number: ticket.number,
        employee: ctx.name,
        subject: b.subject,
        category: b.category.toLowerCase(),
      },
      "/helpdesk",
    );
    return ticket;
  }
  const ticket = await db.helpdeskTicket.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      employee: {
        select: {
          employeeCode: true,
          firstName: true,
          lastName: true,
          userId: true,
        },
      },
    },
  });
  if (!ticket || (!agent && ticket.employeeId !== me?.id))
    throw new AppError(404, "Ticket not found.");
  const owner = ticket.employeeId === me?.id;

  if (!action && method === "GET") {
    const messages = await db.helpdeskMessage.findMany({
      where: { ticketId: ticket.id, ...(agent ? {} : { internal: false }) },
      select: {
        id: true,
        authorName: true,
        fromAgent: true,
        internal: true,
        body: true,
        fileName: true,
        size: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return { ...ticket, messages };
  }
  if (action === "attachments" && sub && method === "GET") {
    const m = await db.helpdeskMessage.findFirst({
      where: {
        id: sub,
        ticketId: ticket.id,
        ...(agent ? {} : { internal: false }),
      },
    });
    if (!m?.storageKey) throw new AppError(404, "Attachment not found.");
    return {
      url: await signedUrl(m.storageKey, {
        fileName: m.fileName ?? "attachment",
        contentType: m.contentType ?? "application/octet-stream",
      }),
    };
  }
  if (action === "messages" && method === "POST") {
    const b = messageSchema.parse(await json(req, 3_000_000));
    if (ticket.status === "CLOSED")
      throw new AppError(409, "This ticket is closed. Raise a new one.");
    if (b.internal && !agent)
      throw new AppError(403, "Only helpdesk agents can add internal notes.");
    const files = await fileFields(ctx.companyId, b.attachment);
    const fromAgent = agent && !owner;
    await db.$transaction([
      db.helpdeskMessage.create({
        data: {
          companyId: ctx.companyId,
          ticketId: ticket.id,
          authorId: ctx.userId,
          authorName: ctx.name,
          fromAgent,
          internal: b.internal,
          body: b.body,
          ...files,
        },
      }),
      db.helpdeskTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: new Date(),
          ...(fromAgent &&
          !b.internal &&
          ["OPEN", "ASSIGNED"].includes(ticket.status)
            ? { status: "IN_PROGRESS" }
            : {}),
          ...(!fromAgent && ticket.status === "RESOLVED"
            ? { status: "OPEN", resolvedAt: null }
            : {}),
        },
      }),
    ]);
    if (fromAgent && !b.internal)
      await notify(
        ctx.companyId,
        [ticket.employee.userId],
        "ticket.updated",
        { number: ticket.number, subject: ticket.subject, status: "new reply" },
        "/helpdesk",
      );
    return { ok: true };
  }
  if (!action && method === "PUT") {
    const b = z
      .object({
        status: z.enum(statuses),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        assigneeUserId: z.string().nullable().optional(),
      })
      .strict()
      .parse(await json(req));
    // Employees may only close or reopen their own ticket.
    if (
      !agent &&
      !(
        owner &&
        ["CLOSED", "OPEN"].includes(b.status) &&
        b.assigneeUserId === undefined &&
        b.priority === undefined
      )
    )
      throw new AppError(403, "You cannot change this ticket.");
    let assignee: { id: string; name: string } | null | undefined;
    if (b.assigneeUserId) {
      assignee = await db.user.findFirst({
        where: {
          id: b.assigneeUserId,
          companyId: ctx.companyId,
          active: true,
          role: { permissions: { some: { permissionKey: "helpdesk.manage" } } },
        },
        select: { id: true, name: true },
      });
      if (!assignee)
        throw new AppError(404, "Choose an active helpdesk agent.");
    }
    const data: Prisma.HelpdeskTicketUpdateInput = {
      status: b.assigneeUserId && b.status === "OPEN" ? "ASSIGNED" : b.status,
      ...(b.priority ? { priority: b.priority } : {}),
      ...(b.assigneeUserId !== undefined
        ? {
            assigneeUserId: assignee?.id ?? null,
            assigneeName: assignee?.name ?? null,
          }
        : {}),
      resolvedAt:
        b.status === "RESOLVED"
          ? new Date()
          : b.status === "OPEN"
            ? null
            : ticket.resolvedAt,
    };
    const saved = await db.$transaction(async (tx) => {
      const s = await tx.helpdeskTicket.update({
        where: { id: ticket.id },
        data,
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "helpdesk",
        ticket.id,
        { status: ticket.status },
        { status: s.status, assignee: s.assigneeUserId },
        ip(req),
      );
      return s;
    });
    if (!owner)
      await notify(
        ctx.companyId,
        [ticket.employee.userId],
        "ticket.updated",
        {
          number: ticket.number,
          subject: ticket.subject,
          status: saved.status.toLowerCase().replace("_", " "),
        },
        "/helpdesk",
      );
    if (assignee)
      await notify(
        ctx.companyId,
        [assignee.id],
        "approval.requested",
        { item: `Helpdesk ticket #${ticket.number}` },
        "/helpdesk",
      );
    return saved;
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
