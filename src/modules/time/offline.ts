import { encrypt, decrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { Context } from "@/modules/auth/service";

const day = 86400000;
export function issueOfflinePermit(
  ctx: Context,
  employeeId: string,
  deviceId: string,
  now = Date.now(),
) {
  const expiresAt = new Date(now + 7 * day).toISOString();
  return {
    permit: encrypt({
      kind: "offline-attendance-v1",
      userId: ctx.userId,
      companyId: ctx.companyId,
      employeeId,
      deviceId,
      issuedAt: String(now),
      expiresAt: String(now + 7 * day),
    }),
    expiresAt,
    serverTime: new Date(now).toISOString(),
  };
}
export function verifyOfflinePermit(
  token: string,
  ctx: Context,
  employeeId: string,
  deviceId: string | undefined,
  capturedAt: string,
  now = Date.now(),
) {
  try {
    const p = decrypt(token),
      captured = Date.parse(capturedAt),
      issued = Number(p.issuedAt),
      expires = Number(p.expiresAt);
    if (
      p.kind !== "offline-attendance-v1" ||
      p.userId !== ctx.userId ||
      p.companyId !== ctx.companyId ||
      p.employeeId !== employeeId ||
      p.deviceId !== deviceId ||
      !Number.isFinite(captured) ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      captured < issued - 60000 ||
      captured > expires ||
      captured > now + 60000 ||
      now - captured > 30 * day
    )
      throw new Error("Invalid permit");
    return new Date(captured);
  } catch {
    throw new AppError(
      422,
      "This offline punch has an invalid device permit or capture time. Keep the record and ask HR to review it.",
      "OFFLINE_PERMIT_INVALID",
    );
  }
}
