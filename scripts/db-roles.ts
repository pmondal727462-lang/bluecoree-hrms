import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Creates or updates the two runtime roles from APP_DATABASE_URL and
// SYSTEM_DATABASE_URL, connecting as the migration owner in DATABASE_URL.
// The application role is subject to row-level security; the system role
// bypasses it and is used only for pre-authentication, platform
// administration and background jobs. Neither role can change the schema.
function role(name: "APP_DATABASE_URL" | "SYSTEM_DATABASE_URL") {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env first.`);
  const url = new URL(value);
  const user = decodeURIComponent(url.username);
  if (!/^[a-z_][a-z0-9_]*$/.test(user))
    throw new Error(`${name} must use a lower-case role name.`);
  const password = decodeURIComponent(url.password);
  if (password.length < 16)
    throw new Error(`${name} needs a password of at least 16 characters.`);
  return { user, password: `'${password.replaceAll("'", "''")}'` };
}
// Platform-managed tables the application role may read but not change.
const readOnly = [
  "permissions",
  "subscription_plans",
  "setup_state",
  "backup_logs",
];

async function main() {
  const app = role("APP_DATABASE_URL");
  const system = role("SYSTEM_DATABASE_URL");
  if (app.user === system.user)
    throw new Error("Use different roles for the application and system.");
  const db = new PrismaClient();
  const [{ owner, database }] = await db.$queryRaw<
    { owner: string; database: string }[]
  >`SELECT current_user AS owner, current_database() AS database`;
  const statements: string[] = [];
  for (const [r, attrs] of [
    [app, "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"],
    [system, "NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE"],
  ] as const) {
    const exists = await db.$queryRaw<unknown[]>`
      SELECT 1 FROM pg_roles WHERE rolname = ${r.user}`;
    statements.push(
      `${exists.length ? "ALTER" : "CREATE"} ROLE "${r.user}" LOGIN ${attrs} PASSWORD ${r.password}`,
      `GRANT CONNECT ON DATABASE "${database}" TO "${r.user}"`,
      `GRANT USAGE ON SCHEMA public TO "${r.user}"`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${r.user}"`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${r.user}"`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${r.user}"`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${r.user}"`,
      `REVOKE ALL ON "_prisma_migrations" FROM "${r.user}"`,
    );
  }
  for (const table of readOnly)
    statements.push(
      `REVOKE INSERT, UPDATE, DELETE ON "${table}" FROM "${app.user}"`,
    );
  await db.$transaction(statements.map((s) => db.$executeRawUnsafe(s)));
  await db.$disconnect();
  console.log(
    `Configured ${app.user} (row-level security enforced) and ${system.user} (bypasses row-level security).`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
