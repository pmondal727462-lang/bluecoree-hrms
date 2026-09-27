import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i < bits.length; i += 5)
    result += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return result;
}
function decode(secret: string) {
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw new Error("Invalid TOTP secret");
    bits += i.toString(2).padStart(5, "0");
  }
  return Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
}
export function codeForStep(secret: string, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String(
    (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: bigint | null = null,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (lastStep !== null && BigInt(candidate) <= lastStep) continue;
    if (
      timingSafeEqual(
        Buffer.from(codeForStep(secret, candidate)),
        Buffer.from(code),
      )
    )
      return candidate;
  }
  return null;
}
