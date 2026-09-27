import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const secret = (bytes: number) => randomBytes(bytes).toString("hex");
if (existsSync(".env")) {
  console.log(".env already exists; no values changed.");
} else {
  writeFileSync(
    ".env",
    [
      `DATABASE_URL="postgresql://hrms:CHANGE_ME@localhost:5432/hrms?schema=public"`,
      `APP_DATABASE_URL="postgresql://hrms_app:${secret(24)}@localhost:5432/hrms?schema=public"`,
      `SYSTEM_DATABASE_URL="postgresql://hrms_system:${secret(24)}@localhost:5432/hrms?schema=public"`,
      `JWT_SECRET="${secret(48)}"`,
      `JWT_REFRESH_SECRET="${secret(48)}"`,
      `ENCRYPTION_KEY="${secret(32)}"`,
      `BACKUP_ENCRYPTION_KEY="${secret(32)}"`,
      `SETUP_TOKEN="${secret(24)}"`,
      `APP_URL="http://localhost:3000"`,
      `SMTP_HOST=""`,
      `SMTP_PORT="587"`,
      `SMTP_USER=""`,
      `SMTP_PASSWORD=""`,
      `SMTP_FROM=""`,
      `TRUST_PROXY="false"`,
      `STORAGE_ENDPOINT=""`,
      `STORAGE_BUCKET=""`,
      `STORAGE_ACCESS_KEY=""`,
      `STORAGE_SECRET_KEY=""`,
      `RAZORPAY_KEY_ID=""`,
      `RAZORPAY_KEY_SECRET=""`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(
    "Created .env with random secrets. Set DATABASE_URL (and the host/database in APP_DATABASE_URL and SYSTEM_DATABASE_URL) before migrating, then run npm run db:roles.",
  );
}
