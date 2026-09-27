import { AppError } from "@/lib/errors";
import { decrypt, encrypt } from "@/lib/crypto";
import { z } from "zod";
import { randomUUID } from "node:crypto";
const resultSchema = z.object({ requestId: z.string(), template: z.string().min(1).max(100000).optional(), confidence: z.number().finite().min(0).max(1), livenessPassed: z.boolean(), status: z.enum(["SUCCESS", "FAILED", "SUSPICIOUS", "REVIEW_REQUIRED"]) });

type ProviderResult = { template?: string; confidence: number; livenessPassed: boolean; status: "SUCCESS" | "FAILED" | "SUSPICIOUS" | "REVIEW_REQUIRED"; reason?: string };
function endpoint() {
  return process.env.FACE_PROVIDER_URL;
}
async function provider(path: string, body: Record<string, unknown>): Promise<ProviderResult & { template?: string }> {
  const url = endpoint();
  if (!url || !process.env.FACE_PROVIDER_KEY)
    throw new AppError(503, "Face attendance provider is not configured.", "FACE_PROVIDER_UNAVAILABLE");
  const sample = z.string().max(350000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).parse(body.sample);
  try {
    const target = new URL(`${url.replace(/\/$/, "")}/${path}`);
    if (target.protocol !== "https:") throw new Error("HTTPS required");
    const requestId = randomUUID();
    const response = await fetch(target, { method: "POST", redirect: "error", cache: "no-store", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.FACE_PROVIDER_KEY}` }, body: JSON.stringify({ ...body, sample, requestId, livenessRequired: true }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Provider unavailable");
    const result = resultSchema.parse(await response.json());
    if (result.requestId !== requestId) throw new Error("Mismatched response");
    return result;
  } catch {
    throw new AppError(503, "Face attendance provider is unavailable or returned an invalid result.", "FACE_PROVIDER_UNAVAILABLE");
  }
}
export async function enrollFace(sample: string) {
  if (!sample.startsWith("data:image/")) throw new AppError(422, "A camera face sample is required.");
  const result = await provider("enroll", { sample });
  if (!result.template || result.status !== "SUCCESS" || !result.livenessPassed)
    throw new AppError(422, result.reason || "Face enrollment failed.", "FACE_ENROLLMENT_FAILED");
  return encrypt({ template: result.template });
}
export async function verifyFace(templateCiphertext: string, sample: string, threshold: number, livenessRequired: boolean) {
  const stored = decrypt(templateCiphertext) as { template: string };
  const result = await provider("verify", { template: stored.template, sample, livenessRequired });
  if (result.status !== "SUCCESS" || !result.livenessPassed || result.confidence < threshold)
    throw new AppError(403, result.reason || "Face verification failed.", "FACE_VERIFICATION_FAILED");
  return result;
}
