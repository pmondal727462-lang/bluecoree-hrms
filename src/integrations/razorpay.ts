import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay payment provider (spec §50). Cards are entered in Razorpay's
// checkout; this server only creates orders, verifies signatures and issues
// refunds. Configured with RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
// RAZORPAY_WEBHOOK_SECRET.
export const razorpayConfigured = () =>
  !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;
const api = "https://api.razorpay.com/v1";
const auth = () =>
  `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;

function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { description?: string };
  };
  if (!res.ok)
    throw new Error(data.error?.description ?? `Razorpay error ${res.status}`);
  return data;
}

export async function createOrder(amountPaise: number, receipt: string) {
  return call<{ id: string; amount: number; currency: string }>("/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    payment_capture: 1,
  });
}
// Checkout returns order id, payment id and signature; the signature is
// HMAC-SHA256 of "order_id|payment_id" with the key secret.
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
) {
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET ?? "")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return !!process.env.RAZORPAY_KEY_SECRET && equal(expected, signature);
}
// Webhooks are signed over the raw request body with the webhook secret.
export function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return equal(expected, signature);
}
export async function refundPayment(
  paymentId: string,
  amountPaise: number,
  note: string,
) {
  return call<{ id: string; status: string }>(
    `/payments/${encodeURIComponent(paymentId)}/refund`,
    { amount: amountPaise, notes: { reason: note.slice(0, 200) } },
  );
}
