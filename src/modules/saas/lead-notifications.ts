import type { ContactLead, Prisma } from "@prisma/client";
import { db, withSystem } from "@/lib/db";
import { logger } from "@/lib/errors";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import {
  sendWhatsAppTemplate,
  whatsappConfigured,
} from "@/integrations/messaging";
import { salesContact } from "@/config/sales";

type ChannelState = {
  status: "PENDING" | "BLOCKED" | "SENT" | "FAILED";
  attempts: number;
  error?: string;
};
type State = { email: ChannelState; whatsapp: ChannelState };
export const initialLeadNotifications = (): State => ({
  email: { status: "PENDING", attempts: 0 },
  whatsapp: { status: "PENDING", attempts: 0 },
});
export function leadEmail(
  lead: Pick<
    ContactLead,
    "id" | "name" | "email" | "company" | "phone" | "employees" | "message"
  >,
) {
  return `New BlueCoreeHR website enquiry\nReference: ${lead.id}\nName: ${lead.name}\nEmail: ${lead.email}\nCompany: ${lead.company || "Not provided"}\nPhone: ${lead.phone || "Not provided"}\nEmployees: ${lead.employees ?? "Not provided"}\n\n${lead.message}`;
}
// Save before sending. A successful channel is not resent when the other retries.
export async function deliverLeadNotifications(id: string) {
  return withSystem(async () => {
    const now = new Date(),
      lease = new Date(Date.now() + 5 * 60000);
    const claimed = await db.contactLead.updateMany({
      where: {
        id,
        nextNotificationAt: { lte: now },
        OR: [
          { notificationLockedUntil: null },
          { notificationLockedUntil: { lt: now } },
        ],
      },
      data: { notificationLockedUntil: lease },
    });
    if (!claimed.count) return { accepted: 0 };
    const lead = await db.contactLead.findUniqueOrThrow({ where: { id } });
    const state = lead.notificationState as unknown as State;
    let accepted = 0;
    await Promise.all(
      (["email", "whatsapp"] as const).map(async (channel) => {
        const previous = state[channel] ?? { status: "PENDING", attempts: 0 };
        if (previous.status === "SENT" || previous.status === "FAILED") return;
        const configured =
          channel === "email"
            ? emailConfigured()
            : whatsappConfigured() && !!process.env.WHATSAPP_LEAD_TEMPLATE;
        if (!configured) {
          state[channel] = {
            ...previous,
            status: "BLOCKED",
            error:
              channel === "email"
                ? "SMTP is not configured."
                : "WhatsApp credentials or approved lead template are not configured.",
          };
          return;
        }
        const attempts = previous.attempts + 1;
        try {
          if (channel === "email")
            await sendAuthEmail(
              salesContact.email,
              `BlueCoreeHR enquiry — ${lead.name.replace(/[\r\n]/g, " ")}`,
              leadEmail(lead),
            );
          else
            await sendWhatsAppTemplate(
              salesContact.whatsapp,
              process.env.WHATSAPP_LEAD_TEMPLATE!,
              [
                lead.name,
                lead.email,
                lead.phone || "Not provided",
                lead.company || "Not provided",
                String(lead.employees ?? "Not provided"),
                lead.message.replace(/\s+/g, " ").slice(0, 300),
                lead.id,
              ],
            );
          state[channel] = { status: "SENT", attempts };
          accepted++;
        } catch {
          state[channel] = {
            status: attempts >= 10 ? "FAILED" : "PENDING",
            attempts,
            error:
              "Provider did not accept the notification. Check delivery configuration.",
          };
          logger.warn(
            { leadId: id, channel, attempts },
            "Website enquiry notification failed",
          );
        }
      }),
    );
    const pending = Object.values(state).some((s) =>
      ["PENDING", "BLOCKED"].includes(s.status),
    );
    await db.contactLead.updateMany({
      where: { id, notificationLockedUntil: lease },
      data: {
        notificationState: state as unknown as Prisma.InputJsonValue,
        nextNotificationAt: pending ? new Date(Date.now() + 10 * 60000) : null,
        notificationLockedUntil: null,
      },
    });
    return { accepted };
  });
}
export async function deliverPendingLeadNotifications() {
  return withSystem(async () => {
    const leads = await db.contactLead.findMany({
      where: {
        nextNotificationAt: { lte: new Date() },
        OR: [
          { notificationLockedUntil: null },
          { notificationLockedUntil: { lt: new Date() } },
        ],
      },
      select: { id: true },
      orderBy: { nextNotificationAt: "asc" },
      take: 10,
    });
    let accepted = 0;
    for (const lead of leads)
      accepted += (await deliverLeadNotifications(lead.id)).accepted;
    return { checked: leads.length, accepted };
  });
}
