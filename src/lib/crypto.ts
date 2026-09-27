import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
function key() {
  const value = process.env.ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("ENCRYPTION_KEY must be 32 random bytes in hex.");
  return Buffer.from(value, "hex");
}
export function encrypt(value: unknown): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    data.toString("hex"),
  ].join(".");
}
export function decrypt(value: string): Record<string, string> {
  const [iv, tag, data] = value.split(".");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "hex")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
