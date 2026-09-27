import { createSign } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/errors";

// Push notifications to the mobile app (spec §41). Expo push tokens go to
// the Expo push service; other tokens go to Firebase Cloud Messaging
// (HTTP v1), which also delivers to iOS through APNs. Credentials come from
// deployment configuration only.
export const pushEvents = new Set([
  "leave.approved",
  "leave.rejected",
  "leave.submitted",
  "attendance.reminder",
  "attendance.late",
  "attendance.regularization_approved",
  "attendance.regularization_rejected",
  "payslip.generated",
  "announcement.published",
  "training.reminder",
  "certification.expiring",
  "document.expiring",
  "approval.requested",
  "expense.submitted",
  "expense.reviewed",
  "ticket.updated",
]);
export const pushConfigured = () =>
  fcmConfigured() || !!process.env.EXPO_PUSH_ENABLED;
const fcmConfigured = () =>
  !!(
    process.env.FCM_PROJECT_ID &&
    process.env.FCM_CLIENT_EMAIL &&
    process.env.FCM_PRIVATE_KEY
  );
const isExpo = (token: string) => /^Expo(nent)?PushToken\[.+\]$/.test(token);

let cached: { token: string; expires: number } | null = null;
async function fcmAccessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: process.env.FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(process.env.FCM_PRIVATE_KEY!.replace(/\\n/g, "\n"))
    .toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    token: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
  };
  return cached.token;
}

type Message = { title: string; body: string; link?: string; event: string };
// Returns the tokens the provider reported as no longer valid.
async function sendFcm(tokens: string[], m: Message) {
  const access = await fcmAccessToken();
  const dead: string[] = [];
  for (const token of tokens) {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: m.title, body: m.body },
            data: { event: m.event, link: m.link ?? "" },
          },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (res.status === 404 || res.status === 400) {
      const text = await res.text();
      if (/UNREGISTERED|INVALID_ARGUMENT/.test(text)) dead.push(token);
    }
  }
  return dead;
}
async function sendExpo(tokens: string[], m: Message) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        title: m.title,
        body: m.body,
        data: { event: m.event, link: m.link ?? "" },
      })),
    ),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Expo push failed (${res.status})`);
  const out = (await res.json()) as {
    data?: { status: string; details?: { error?: string } }[];
  };
  return tokens.filter(
    (_, i) => out.data?.[i]?.details?.error === "DeviceNotRegistered",
  );
}

// Sends to every active token of the users; failures never reach callers.
export async function sendPush(
  companyId: string,
  userIds: string[],
  m: Message,
) {
  if (!pushConfigured() || !pushEvents.has(m.event) || !userIds.length)
    return { sent: 0 };
  const tokens = await db.pushToken.findMany({
    where: { companyId, userId: { in: userIds }, active: true },
    select: { token: true },
  });
  const expo = tokens.map((t) => t.token).filter(isExpo);
  const fcm = tokens.map((t) => t.token).filter((t) => !isExpo(t));
  const dead: string[] = [];
  try {
    if (expo.length && process.env.EXPO_PUSH_ENABLED)
      dead.push(...(await sendExpo(expo, m)));
    if (fcm.length && fcmConfigured()) dead.push(...(await sendFcm(fcm, m)));
  } catch (error) {
    logger.warn({ event: m.event, error: String(error) }, "Push failed");
  }
  if (dead.length)
    await db.pushToken.updateMany({
      where: { companyId, token: { in: dead } },
      data: { active: false },
    });
  return {
    sent: expo.length + fcm.length - dead.length,
    deactivated: dead.length,
  };
}
