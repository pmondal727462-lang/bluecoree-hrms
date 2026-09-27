import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
function secret(refresh: boolean) {
  const value = process.env[refresh ? "JWT_REFRESH_SECRET" : "JWT_SECRET"];
  if (!value || value.length < 48 || value.includes("generate-with"))
    throw new Error("Configure strong JWT secrets.");
  return new TextEncoder().encode(value);
}
export async function signToken(
  userId: string,
  sessionId: string,
  refresh = false,
) {
  return new SignJWT({ sid: sessionId, kind: refresh ? "refresh" : "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("people-hrms")
    .setAudience("people-hrms")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(refresh ? "7d" : "15m")
    .sign(secret(refresh));
}
export async function verifyToken(token: string, refresh = false) {
  const { payload } = await jwtVerify(token, secret(refresh), {
    algorithms: ["HS256"],
    issuer: "people-hrms",
    audience: "people-hrms",
  });
  if (
    payload.kind !== (refresh ? "refresh" : "access") ||
    !payload.sub ||
    typeof payload.sid !== "string"
  )
    throw new Error("Invalid token");
  return { userId: payload.sub, sessionId: payload.sid };
}
