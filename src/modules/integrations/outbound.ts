import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db, jobScope } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt } from "@/lib/crypto";

export const webhookEvents = [
  "employee.created",
  "employee.updated",
  "employee.deleted",
  "attendance.checked_in",
  "attendance.checked_out",
  "leave.created",
  "leave.approved",
  "leave.rejected",
  "payroll.processed",
  "payslip.generated",
  "candidate.created",
  "candidate.selected",
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

// DNS resolution is injectable so tests can resolve example hosts offline.
export const resolver = {
  lookup: async (host: string) =>
    (await lookup(host, { all: true })).map((a) => a.address),
};
function privateAddress(address: string) {
  if (address.includes(":")) {
    const v = address.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return (
      v === "::1" ||
      v === "::" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80")
    );
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
// Outbound calls go only to public HTTPS hosts to prevent SSRF into the
// server's network. Redirects are refused so the check cannot be bypassed.
export async function assertPublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(422, "Enter a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new AppError(422, "Use an HTTPS URL without embedded credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal")
  )
    throw new AppError(422, "Private or local addresses are not allowed.");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolver.lookup(host);
  } catch {
    throw new AppError(422, "The URL host could not be resolved.");
  }
  if (!addresses.length || addresses.some(privateAddress))
    throw new AppError(422, "Private or local addresses are not allowed.");
  return url;
}
export function sign(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}
export async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
) {
  await assertPublicUrl(url);
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  const text = (await response.text()).slice(0, 2000);
  return { ok: response.ok, status: response.status, text };
}

const queued = new Set<string>();
// Outbox: deliveries are written in the caller's transaction and only sent
// after it commits, so rolled-back changes never produce webhooks.
export async function enqueueWebhook(
  tx: Prisma.TransactionClient,
  companyId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
) {
  const hooks = await tx.webhook.findMany({
    where: { companyId, active: true, events: { has: event } },
    select: { id: true },
  });
  if (!hooks.length) return;
  const payload = {
    id: randomUUID(),
    event,
    createdAt: new Date().toISOString(),
    data,
  } as Prisma.InputJsonValue;
  await tx.webhookDelivery.createMany({
    data: hooks.map((h) => ({ companyId, webhookId: h.id, event, payload })),
  });
  queued.add(companyId);
}
// Called by the API handler after the response transaction has committed.
export function flushQueuedWebhooks() {
  for (const companyId of queued) {
    queued.delete(companyId);
    void deliverDue(companyId).catch(() => undefined);
  }
}
const maxAttempts = 6;
async function deliverDueJob(companyId?: string, limit = 50) {
  const due = await db.webhookDelivery.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      status: "PENDING",
      // Tolerates small clock differences between Node and the query engine.
      nextAttemptAt: { lte: new Date(Date.now() + 1000) },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let delivered = 0;
  for (const { id } of due) if (await deliver(id)) delivered++;
  return { attempted: due.length, delivered };
}
export async function deliver(id: string) {
  // Claim the row so concurrent workers never send it twice.
  const claimed = await db.webhookDelivery.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (!claimed.count) return false;
  const d = await db.webhookDelivery.findUniqueOrThrow({
    where: { id },
    include: { webhook: true },
  });
  const body = JSON.stringify(d.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  let result: { ok: boolean; status?: number; error?: string };
  try {
    if (!d.webhook.active) throw new Error("Webhook is disabled.");
    const secret = decrypt(d.webhook.secretEncrypted).secret;
    const r = await post(d.webhook.url, body, {
      "x-hrms-event": d.event,
      "x-hrms-delivery": d.id,
      "x-hrms-timestamp": timestamp,
      "x-hrms-signature": `sha256=${sign(secret, timestamp, body)}`,
    });
    result = r.ok
      ? { ok: true, status: r.status }
      : { ok: false, status: r.status, error: `HTTP ${r.status}` };
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 500) : "Failed",
    };
  }
  const finalFailure = !result.ok && d.attempts >= maxAttempts;
  await db.webhookDelivery.update({
    where: { id },
    data: {
      status: result.ok ? "SUCCESS" : finalFailure ? "FAILED" : "PENDING",
      responseStatus: result.status ?? null,
      errorMessage: result.error ?? null,
      deliveredAt: result.ok ? new Date() : null,
      // Exponential backoff: 2, 4, 8, 16, 32 minutes.
      nextAttemptAt: new Date(Date.now() + 2 ** d.attempts * 60000),
    },
  });
  return result.ok;
}
export function deliverDue(companyId?: string, limit = 50) {
  return jobScope(() => deliverDueJob(companyId, limit));
}
