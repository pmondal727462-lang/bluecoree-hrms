import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";
import { sendAuthEmail } from "../../src/integrations/email";
import { sendWhatsAppTemplate } from "../../src/integrations/messaging";
import {
  deliverLeadNotifications,
  initialLeadNotifications,
} from "../../src/modules/saas/lead-notifications";
vi.mock("../../src/integrations/email", async (original) => ({
  ...(await original<typeof import("../../src/integrations/email")>()),
  sendAuthEmail: vi.fn(),
}));
vi.mock("../../src/integrations/messaging", async (original) => ({
  ...(await original<typeof import("../../src/integrations/messaging")>()),
  sendWhatsAppTemplate: vi.fn(),
}));
const f = new Fixture(),
  prefix = randomUUID();
const payload = (key: string) => ({
  name: "Demo visitor",
  email: `${prefix}-${key}@example.com`,
  company: "Demo company",
  phone: "9999999999",
  employees: 50,
  message: "Request a demo: please arrange a walkthrough.",
});
const email = vi.mocked(sendAuthEmail),
  whatsapp = vi.mocked(sendWhatsAppTemplate);
beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_LEAD_TEMPLATE",
  ])
    vi.stubEnv(key, "test-only");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.contactLead.deleteMany({ where: { email: { startsWith: prefix } } });
  await db.$disconnect();
});
describe("website demo and sales notifications", () => {
  it("saves visitor details and forwards to the fixed owner email and WhatsApp", async () => {
    const b = payload("both");
    const result = await call(f, "public/contact", "POST", "", b);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const lead = await db.contactLead.findFirstOrThrow({
      where: { email: b.email },
    });
    expect(lead.notificationState).toMatchObject({
      email: { status: "SENT" },
      whatsapp: { status: "SENT" },
    });
    expect(email).toHaveBeenCalledWith(
      "info@bluecoree.com",
      expect.stringContaining("Demo visitor"),
      expect.stringContaining(b.message),
    );
    expect(whatsapp).toHaveBeenCalledWith("+917003904693", "test-only", [
      b.name,
      b.email,
      b.phone,
      b.company,
      "50",
      b.message,
      lead.id,
    ]);
  });
  it("retries a failed channel without duplicating a successful email", async () => {
    whatsapp.mockRejectedValueOnce(new Error("Provider temporarily down"));
    const b = payload("retry");
    await call(f, "public/contact", "POST", "", b);
    const lead = await db.contactLead.findFirstOrThrow({
      where: { email: b.email },
    });
    expect(lead.notificationState).toMatchObject({
      email: { status: "SENT" },
      whatsapp: { status: "PENDING", attempts: 1 },
    });
    await db.contactLead.update({
      where: { id: lead.id },
      data: { nextNotificationAt: new Date(0) },
    });
    await deliverLeadNotifications(lead.id);
    await deliverLeadNotifications(lead.id);
    expect(email).toHaveBeenCalledTimes(1);
    expect(whatsapp).toHaveBeenCalledTimes(2);
    expect(
      (await db.contactLead.findUniqueOrThrow({ where: { id: lead.id } }))
        .nextNotificationAt,
    ).toBeNull();
  });
  it("retains enquiries while credentials are missing and forwards after configuration", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("WHATSAPP_TOKEN", "");
    const b = payload("blocked");
    expect((await call(f, "public/contact", "POST", "", b)).status).toBe(200);
    const lead = await db.contactLead.findFirstOrThrow({
      where: { email: b.email },
    });
    expect(lead.notificationState).toMatchObject({
      email: { status: "BLOCKED", attempts: 0 },
      whatsapp: { status: "BLOCKED", attempts: 0 },
    });
    expect(email).not.toHaveBeenCalled();
    expect(whatsapp).not.toHaveBeenCalled();
    vi.stubEnv("SMTP_HOST", "test-only");
    vi.stubEnv("WHATSAPP_TOKEN", "test-only");
    await db.contactLead.update({
      where: { id: lead.id },
      data: { nextNotificationAt: new Date(0) },
    });
    expect((await deliverLeadNotifications(lead.id)).accepted).toBe(2);
  });
  it("ignores honeypot submissions", async () => {
    const b = payload("bot");
    expect(
      (await call(f, "public/contact", "POST", "", { ...b, website: "spam" }))
        .status,
    ).toBe(200);
    expect(await db.contactLead.count({ where: { email: b.email } })).toBe(0);
    expect(email).not.toHaveBeenCalled();
  });
  it("claims one delivery when two workers run simultaneously", async () => {
    const lead = await db.contactLead.create({
      data: {
        ...payload("concurrent"),
        notificationState: initialLeadNotifications(),
        nextNotificationAt: new Date(0),
      },
    });
    await Promise.all([
      deliverLeadNotifications(lead.id),
      deliverLeadNotifications(lead.id),
    ]);
    expect(email).toHaveBeenCalledTimes(1);
    expect(whatsapp).toHaveBeenCalledTimes(1);
  });
});
