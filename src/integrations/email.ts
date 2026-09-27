import nodemailer from "nodemailer";
import { AppError } from "@/lib/errors";
export function emailConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.SMTP_FROM
  );
}
const senderAddress = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from;
export async function sendAuthEmail(
  to: string,
  subject: string,
  text: string,
  brand?: { name?: string | null; footer?: string | null } | null,
) {
  if (!emailConfigured())
    throw new AppError(
      503,
      "Email delivery is not configured. Contact your administrator.",
      "EMAIL_UNAVAILABLE",
    );
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: process.env.SMTP_PORT !== "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  await transport.sendMail({
    // White-label mail keeps the configured address but shows the brand.
    from: brand?.name
      ? { name: brand.name, address: senderAddress(process.env.SMTP_FROM!) }
      : process.env.SMTP_FROM,
    to,
    subject: brand?.name ? subject.replace("People", brand.name) : subject,
    text: brand?.footer ? `${text}\n\n--\n${brand.footer}` : text,
  });
}
