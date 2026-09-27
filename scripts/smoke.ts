import "dotenv/config";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
async function main() {
  const base = process.env.APP_URL || "http://localhost:3000";
  const credentials = readFileSync("data/demo-credentials.txt", "utf8");
  const password = /Password for demo accounts: (.+)/.exec(credentials)?.[1];
  assert(password, "Run npm run db:seed first.");
  for (const path of [
    "/login",
    "/setup",
    "/forgot-password",
    "/otp",
    "/api/health",
    "/api/docs",
    "/attendance",
    "/leave",
    "/time-settings",
  ]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, `${path} status`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert(
      r.headers.get("permissions-policy")?.includes("camera=(self)"),
      `${path} must allow same-origin camera use`,
    );
  }
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      companyCode: "DEMO",
      identifier: "super.admin@demo.example",
      password,
    }),
  });
  assert.equal(login.status, 200, "Admin sign in");
  const cookies = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  for (const path of [
    "/api/auth/me",
    "/api/employees?pageSize=5",
    "/api/dashboard",
    "/api/company",
    "/api/roles",
    "/api/references/employees?page=1&pageSize=5",
    "/api/references/users?page=1&pageSize=5",
    "/api/references/departments?page=1&pageSize=5",
    "/api/departments?page=1&pageSize=5",
    "/api/time/summary",
    "/api/time/attendance?scope=own",
    "/api/time/attendance?scope=company",
    "/api/time/roster",
    "/api/time/leave?scope=company",
    "/api/time/balances",
  ]) {
    const r = await fetch(base + path, { headers: { cookie: cookies } });
    assert.equal(r.status, 200, path);
    const body = await r.json();
    assert.equal(body.success, true, path);
    assert(!JSON.stringify(body).includes("passwordHash"));
  }
  const logout = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: cookies, origin: base },
  });
  assert.equal(logout.status, 200);
  assert.equal(
    (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookies } }))
      .status,
    401,
  );
  console.log(
    "HTTP smoke passed: pages, camera/security headers, readiness, docs, login, paginated references, employee API, dashboard, company, roles, attendance/leave APIs and logout.",
  );
}
main().catch(() => {
  console.error("HTTP smoke failed. Check the running app and demo data.");
  process.exitCode = 1;
});
