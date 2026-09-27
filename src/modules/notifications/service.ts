import { NextRequest } from "next/server";
import { companyAppUrl, emailBrand } from "@/modules/saas/branding";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, logger } from "@/lib/errors";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import { pushConfigured, pushEvents, sendPush } from "@/integrations/push";
import {
  e164,
  sendSms,
  sendWhatsApp,
  smsConfigured,
  whatsappConfigured,
} from "@/integrations/messaging";
import { json, requirePermission, type Context } from "@/modules/auth/service";

// Default templates. Companies can override subject and body per event and
// channel; {{placeholders}} are filled from the event data.
export const defaultTemplates: Record<
  string,
  { subject: string; body: string; email: boolean }
> = {
  welcome: {
    subject: "Welcome to {{company}}",
    body: "Hello {{name}}, your {{company}} HR account is ready. Sign in at {{appUrl}}.",
    email: true,
  },
  "leave.submitted": {
    subject: "Leave request from {{employee}}",
    body: "{{employee}} requested {{days}} day(s) of {{leaveType}} from {{startDate}} to {{endDate}}. Review it in Leave.",
    email: true,
  },
  "leave.approved": {
    subject: "Leave approved",
    body: "Your {{leaveType}} leave from {{startDate}} to {{endDate}} was approved.",
    email: true,
  },
  "leave.rejected": {
    subject: "Leave not approved",
    body: "Your {{leaveType}} leave from {{startDate}} to {{endDate}} was not approved. {{note}}",
    email: true,
  },
  "attendance.regularization_submitted": {
    subject: "Missed punch request from {{employee}}",
    body: "{{employee}} requested attendance for {{workDate}}: check-in {{checkIn}}, check-out {{checkOut}}. Reason: {{reason}}. Review it in Attendance.",
    email: true,
  },
  "attendance.regularization_approved": {
    subject: "Missed punch approved",
    body: "Your attendance for {{workDate}} was updated to check-in {{checkIn}} and check-out {{checkOut}}.",
    email: true,
  },
  "attendance.regularization_rejected": {
    subject: "Missed punch not approved",
    body: "Your missed punch request for {{workDate}} was not approved, so the day is marked absent. {{note}}",
    email: true,
  },
  "payslip.generated": {
    subject: "Your payslip for {{period}}",
    body: "Your payslip for {{period}} is available in Payslips.",
    email: true,
  },
  "expense.submitted": {
    subject: "Expense claim from {{employee}}",
    body: "{{employee}} submitted a {{category}} claim for {{amount}}. Review it in Expenses.",
    email: false,
  },
  "expense.reviewed": {
    subject: "Expense claim {{status}}",
    body: "Your {{category}} claim for {{amount}} was {{status}}. {{note}}",
    email: true,
  },
  "ticket.updated": {
    subject: "Helpdesk ticket #{{number}} updated",
    body: 'Your ticket "{{subject}}" has a new update: {{status}}.',
    email: true,
  },
  "ticket.created": {
    subject: "New helpdesk ticket #{{number}}",
    body: '{{employee}} raised "{{subject}}" ({{category}}).',
    email: false,
  },
  "document.expiring": {
    subject: "Document expiring: {{title}}",
    body: "{{title}} for {{employee}} expires on {{expiresOn}}. Upload a renewed copy.",
    email: true,
  },
  "document.reviewed": {
    subject: "Document {{status}}: {{title}}",
    body: "Your document {{title}} was {{status}}. {{note}}",
    email: false,
  },
  "document.review": {
    subject: "Document awaiting review",
    body: "{{employee}} uploaded {{title}} for review.",
    email: false,
  },
  "announcement.published": {
    subject: "{{title}}",
    body: "{{body}}",
    email: false,
  },
  "interview.scheduled": {
    subject: "Interview scheduled: {{candidate}}",
    body: "You are interviewing {{candidate}} for {{job}} on {{when}}.",
    email: true,
  },
  "candidate.applied": {
    subject: "New application: {{candidate}}",
    body: "{{candidate}} applied for {{job}} through the careers page.",
    email: false,
  },
  "offer.responded": {
    subject: "Offer {{decision}}: {{candidate}}",
    body: "{{candidate}} {{decision}} the offer for {{job}}. {{note}}",
    email: true,
  },
  "onboarding.invited": {
    subject: "Complete your joining formalities at {{company}}",
    body: "Hello {{name}}, please complete your pre-joining checklist before {{joiningDate}}: {{link}}",
    email: true,
  },
  "training.reminder": {
    subject: "Training reminder: {{course}}",
    body: "Your {{course}} session starts on {{when}}.",
    email: true,
  },
  "certification.expiring": {
    subject: "Certification expiring: {{course}}",
    body: "Your {{course}} certification expires on {{expiresOn}}.",
    email: true,
  },
  "attendance.reminder": {
    subject: "Attendance reminder",
    body: "You have not checked in today.",
    email: false,
  },
  "attendance.late": {
    subject: "Late check-in recorded",
    body: "Your check-in today was {{minutes}} minutes after your shift start.",
    email: false,
  },
  "approval.requested": {
    subject: "Approval needed: {{item}}",
    body: "{{item}} is waiting for your approval.",
    email: false,
  },
  birthday: {
    subject: "Happy birthday, {{name}}!",
    body: "Everyone at {{company}} wishes you a wonderful birthday.",
    email: true,
  },
  anniversary: {
    subject: "Happy work anniversary, {{name}}!",
    body: "Thank you for {{years}} year(s) at {{company}}.",
    email: true,
  },
  "subscription.trial_ending": {
    subject: "Your {{company}} trial ends on {{date}}",
    body: "Choose a plan in Subscription to keep paid modules running after {{date}}.",
    email: true,
  },
  "subscription.renewal_due": {
    subject: "Your {{company}} subscription renews on {{date}}",
    body: "Renew in Subscription before {{date}} to keep paid modules running.",
    email: true,
  },
  "invoice.issued": {
    subject: "Invoice {{number}} from {{provider}}",
    body: "Invoice {{number}} for {{amount}} is due on {{dueDate}}.",
    email: true,
  },
  "payment.received": {
    subject: "Payment received for invoice {{number}}",
    body: "We received {{amount}} for invoice {{number}}. Thank you.",
    email: true,
  },
};
const fill = (text: string, data: Record<string, unknown>) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    data[k] === undefined || data[k] === null ? "" : String(data[k]),
  );

// Sends in-app notifications, plus email where the template allows and SMTP
// is configured. Failures are logged and never fail the calling action.
export async function notify(
  companyId: string,
  userIds: (string | null | undefined)[],
  event: string,
  data: Record<string, unknown> = {},
  link?: string,
) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  try {
    const [templates, company, users] = await Promise.all([
      db.notificationTemplate.findMany({
        where: { companyId, event, active: true },
      }),
      db.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      }),
      db.user.findMany({
        where: { id: { in: ids }, companyId, active: true },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const base = defaultTemplates[event] ?? {
      subject: event,
      body: "",
      email: false,
    };
    const inApp = templates.find((t) => t.channel === "IN_APP") ?? base;
    const email = templates.find((t) => t.channel === "EMAIL");
    const vars = {
      company: company.name,
      appUrl: await companyAppUrl(companyId),
      ...data,
    };
    await db.notification.createMany({
      data: users.map((u) => ({
        companyId,
        userId: u.id,
        event,
        title: fill(inApp.subject, { name: u.name, ...vars }).slice(0, 200),
        body: fill(inApp.body, { name: u.name, ...vars }).slice(0, 2000),
        link,
      })),
    });
    // Mobile push for the events the app surfaces (spec §41).
    if (pushConfigured() && pushEvents.has(event))
      for (const u of users)
        await sendPush(companyId, [u.id], {
          event,
          title: fill(inApp.subject, { name: u.name, ...vars }).slice(0, 200),
          body: fill(inApp.body, { name: u.name, ...vars }).slice(0, 500),
          link,
        });
    // SMS and WhatsApp only when the company added a template for the channel.
    const texts = (
      [
        ["SMS", smsConfigured, sendSms],
        ["WHATSAPP", whatsappConfigured, sendWhatsApp],
      ] as const
    ).filter(([c, ok]) => ok() && templates.some((t) => t.channel === c));
    if (texts.length) {
      const phones = await db.employee.findMany({
        where: { companyId, userId: { in: users.map((u) => u.id) } },
        select: { userId: true, mobile: true },
      });
      for (const [channel, , send] of texts) {
        const t = templates.find((x) => x.channel === channel)!;
        for (const u of users) {
          const to = e164(phones.find((p) => p.userId === u.id)?.mobile);
          if (!to) continue;
          await send(to, fill(t.body, { name: u.name, ...vars })).catch(
            (error) =>
              logger.warn(
                { event, channel, error: String(error) },
                "Notification message failed",
              ),
          );
        }
      }
    }
    const brand =
      (email || base.email) && emailConfigured()
        ? await emailBrand(companyId)
        : null;
    if ((email || base.email) && emailConfigured())
      for (const u of users)
        await sendAuthEmail(
          u.email,
          fill((email ?? base).subject, { name: u.name, ...vars }),
          fill((email ?? base).body, { name: u.name, ...vars }),
          brand,
        ).catch((error) =>
          logger.warn(
            { event, error: String(error) },
            "Notification email failed",
          ),
        );
  } catch (error) {
    logger.error({ event, error: String(error) }, "Notification failed");
  }
}
// Users holding a permission, e.g. to tell every HR reviewer about a request.
export async function usersWithPermission(
  companyId: string,
  permission: string,
) {
  return (
    await db.user.findMany({
      where: {
        companyId,
        active: true,
        role: { permissions: { some: { permissionKey: permission } } },
      },
      select: { id: true },
    })
  ).map((u) => u.id);
}

const templateSchema = z
  .object({
    event: z.string().refine((e) => e in defaultTemplates, "Unknown event"),
    channel: z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    active: z.boolean(),
  })
  .strict();

export async function notificationsRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id] = path;
  if (!resource && req.method === "GET") {
    const unread = req.nextUrl.searchParams.get("unread") === "1";
    const [items, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId: ctx.userId, ...(unread ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }
  if (resource === "read" && req.method === "POST") {
    const changed = await db.notification.updateMany({
      where: { userId: ctx.userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
    return { read: changed.count };
  }
  if (resource === "templates") {
    requirePermission(ctx, "notifications.manage");
    if (req.method === "GET") {
      const overrides = await db.notificationTemplate.findMany({
        where: { companyId: ctx.companyId },
      });
      return Object.entries(defaultTemplates).map(([event, d]) => ({
        event,
        defaults: d,
        inApp:
          overrides.find((o) => o.event === event && o.channel === "IN_APP") ??
          null,
        email:
          overrides.find((o) => o.event === event && o.channel === "EMAIL") ??
          null,
        sms:
          overrides.find((o) => o.event === event && o.channel === "SMS") ??
          null,
        whatsapp:
          overrides.find(
            (o) => o.event === event && o.channel === "WHATSAPP",
          ) ?? null,
      }));
    }
    if (req.method === "PUT") {
      const b = templateSchema.parse(await json(req));
      return db.notificationTemplate.upsert({
        where: {
          companyId_event_channel: {
            companyId: ctx.companyId,
            event: b.event,
            channel: b.channel,
          },
        },
        create: { ...b, companyId: ctx.companyId },
        update: b,
      });
    }
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
