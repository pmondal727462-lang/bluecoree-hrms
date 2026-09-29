// SMS and WhatsApp delivery (spec §42). Providers are chosen by deployment
// configuration; a company opts in per event by adding an active SMS or
// WHATSAPP notification template.
//
// SMS: Twilio-compatible (SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, SMS_FROM) or MSG91 (SMS_PROVIDER=msg91, MSG91_AUTH_KEY,
// MSG91_SENDER, MSG91_ROUTE).
// WhatsApp: Meta Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID).
export const smsConfigured = () =>
  (process.env.SMS_PROVIDER === "twilio" &&
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.SMS_FROM) ||
  (process.env.SMS_PROVIDER === "msg91" && !!process.env.MSG91_AUTH_KEY);
export const whatsappConfigured = () =>
  !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

// Normalises Indian and international numbers to E.164; returns null when
// the number cannot be used.
export function e164(raw: string | null | undefined, country = "91") {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+"))
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  const d = digits.replace(/^0+/, "");
  if (d.length === 10) return `+${country}${d}`;
  return /^\d{11,15}$/.test(d) ? `+${d}` : null;
}

export async function sendSms(to: string, text: string) {
  if (!smsConfigured()) throw new Error("SMS is not configured.");
  const body = text.slice(0, 480);
  if (process.env.SMS_PROVIDER === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: process.env.SMS_FROM!,
          Body: body,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) throw new Error(`SMS failed (${res.status})`);
    return;
  }
  const res = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: {
      authkey: process.env.MSG91_AUTH_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: process.env.MSG91_SENDER,
      route: process.env.MSG91_ROUTE ?? "4",
      mobiles: to.replace(/^\+/, ""),
      message: body,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`SMS failed (${res.status})`);
}

export async function sendWhatsApp(to: string, text: string) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { body: text.slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`WhatsApp failed (${res.status})`);
}

// Approved templates support proactive notifications without a prior chat.
export async function sendWhatsAppTemplate(
  to: string,
  name: string,
  parameters: string[],
) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!/^v\d+\.\d+$/.test(version))
    throw new Error("Invalid WhatsApp API version.");
  const response = await fetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: {
          name,
          language: {
            code: process.env.WHATSAPP_LEAD_TEMPLATE_LANGUAGE || "en_US",
          },
          components: [
            {
              type: "body",
              parameters: parameters.map((text) => ({
                type: "text",
                text: text.replace(/\s+/g, " ").trim() || "Not provided",
              })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(`WhatsApp template failed (${response.status})`);
  const result = (await response.json()) as { messages?: { id?: string }[] };
  if (!result.messages?.[0]?.id)
    throw new Error("WhatsApp did not accept the message.");
}
