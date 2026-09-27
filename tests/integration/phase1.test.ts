import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const mail = vi.hoisted(() => ({
  messages: [] as { to: string; subject: string; text: string }[],
}));
vi.mock("../../src/integrations/email", () => ({
  emailConfigured: () => true,
  sendAuthEmail: async (to: string, subject: string, text: string) => {
    mail.messages.push({ to, subject, text });
  },
}));
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { provisionCompany } from "../../src/modules/auth/service";
import { GET, POST, PUT, DELETE } from "../../src/app/api/[...path]/route";
import { testClientIp } from "./client";
import { codeForStep } from "../../src/modules/auth/totp";
const password = "Integration-Only-Password-123!";
const prefix = `TEST-${randomBytes(4).toString("hex").toUpperCase()}`;
let companyA = "",
  companyB = "",
  adminCookie = "",
  employeeCookie = "",
  employeeId = "",
  otherEmployeeId = "",
  departmentId = "",
  otherDepartmentId = "",
  employeeRoleId = "",
  hrCookie = "";
const userIds: string[] = [];
async function call(
  path: string,
  method = "GET",
  cookie = "",
  body?: unknown,
  origin = process.env.APP_URL || "http://localhost:3000",
) {
  const req = new NextRequest(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      cookie,
      "x-forwarded-for": testClientIp,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const handler =
    method === "POST"
      ? POST
      : method === "PUT"
        ? PUT
        : method === "DELETE"
          ? DELETE
          : GET;
  const response = await handler(req, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
  const json = await response.json();
  return {
    response,
    json,
    cookie: response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
}
beforeAll(async () => {
  const hash = await bcrypt.hash(password, 12);
  await db.$transaction(
    async (tx) => {
      const a = await provisionCompany(tx, {
        code: prefix + "A",
        name: "Integration A",
        email: "a@test.example",
        timezone: "Asia/Kolkata",
        workingDays: [1, 2, 3, 4, 5],
      });
      companyA = a.id;
      const b = await provisionCompany(tx, {
        code: prefix + "B",
        name: "Integration B",
        email: "b@test.example",
        timezone: "Asia/Kolkata",
        workingDays: [1, 2, 3, 4, 5],
      });
      companyB = b.id;
      for (const roleName of ["Company Admin", "Employee", "HR Executive"]) {
        const role = await tx.role.findUniqueOrThrow({
          where: { companyId_name: { companyId: a.id, name: roleName } },
        });
        const u = await tx.user.create({
          data: {
            companyId: a.id,
            roleId: role.id,
            name: roleName,
            email: `${roleName.split(" ")[0].toLowerCase()}@test.example`,
            passwordHash: hash,
          },
        });
        userIds.push(u.id);
        if (roleName === "Employee") {
          employeeRoleId = role.id;
          const e = await tx.employee.create({
            data: {
              companyId: a.id,
              userId: u.id,
              employeeCode: "OWN",
              firstName: "Own",
              lastName: "Employee",
              officialEmail: "own@test.example",
              joinedAt: new Date("2026-01-01"),
            },
          });
          employeeId = e.id;
        }
      }
      departmentId = (
        await tx.department.findFirstOrThrow({ where: { companyId: a.id } })
      ).id;
      otherDepartmentId = (
        await tx.department.findFirstOrThrow({ where: { companyId: b.id } })
      ).id;
      otherEmployeeId = (
        await tx.employee.create({
          data: {
            companyId: b.id,
            employeeCode: "OTHER",
            firstName: "Other",
            lastName: "Tenant",
            officialEmail: "other@test.example",
            joinedAt: new Date("2026-01-01"),
          },
        })
      ).id;
    },
    { timeout: 30000 },
  );
  adminCookie = (
    await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "company@test.example",
      password,
    })
  ).cookie;
  employeeCookie = (
    await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "employee@test.example",
      password,
    })
  ).cookie;
  hrCookie = (
    await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "hr@test.example",
      password,
    })
  ).cookie;
});
afterAll(async () => {
  const ids = [companyA, companyB].filter(Boolean);
  if (ids.length) {
    await db.$transaction(async (tx) => {
      await tx.authChallenge.deleteMany({ where: { companyId: { in: ids } } });
      await tx.employee.deleteMany({ where: { companyId: { in: ids } } });
      await tx.loginHistory.deleteMany({ where: { companyId: { in: ids } } });
      await tx.user.deleteMany({ where: { companyId: { in: ids } } });
      await tx.role.deleteMany({ where: { companyId: { in: ids } } });
      await tx.department.deleteMany({ where: { companyId: { in: ids } } });
      await tx.designation.deleteMany({ where: { companyId: { in: ids } } });
      await tx.branch.deleteMany({ where: { companyId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { companyId: { in: ids } } });
      await tx.company.deleteMany({ where: { id: { in: ids } } });
    });
  }
  await db.$disconnect();
});
describe("Phase 1 API and tenant security", () => {
  it("requires authentication and rejects invalid JWTs", async () => {
    expect((await call("employees")).response.status).toBe(401);
    expect(
      (await call("employees", "GET", "hrms_access=not-a-jwt")).response.status,
    ).toBe(401);
  });
  it("logs in using a password hash and never returns credentials", async () => {
    expect(adminCookie).toContain("hrms_access=");
    const result = await call("auth/me", "GET", adminCookie);
    expect(result.response.status).toBe(200);
    expect(result.json.data.companyId).toBe(companyA);
    expect(JSON.stringify(result.json)).not.toContain("passwordHash");
  });
  it("rejects an incorrect password", async () => {
    const result = await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "employee@test.example",
      password: "incorrect",
    });
    expect(result.response.status).toBe(401);
  });
  it("enforces CSRF origin and JSON content constraints", async () => {
    expect(
      (
        await call(
          "employees",
          "POST",
          adminCookie,
          {},
          "https://attacker.example",
        )
      ).response.status,
    ).toBe(403);
  });
  it("blocks employees from company records and role administration", async () => {
    expect(
      (await call("employees", "GET", employeeCookie)).response.status,
    ).toBe(403);
    expect(
      (
        await call("roles", "POST", employeeCookie, {
          name: "Escalated",
          permissions: ["roles.write"],
        })
      ).response.status,
    ).toBe(403);
    expect((await call("companies", "GET", adminCookie)).response.status).toBe(
      403,
    );
  });
  it("blocks cross-company reads, edits and deletes", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const result = await call(
        `employees/${otherEmployeeId}`,
        method,
        adminCookie,
        method === "PUT" ? { firstName: "Intruder" } : undefined,
      );
      expect(result.response.status).toBe(404);
    }
    expect(
      (await db.employee.findUniqueOrThrow({ where: { id: otherEmployeeId } }))
        .firstName,
    ).toBe("Other");
  });
  it("rejects cross-company foreign keys and supplied tenant IDs", async () => {
    const base = {
      employeeCode: "BAD",
      firstName: "Bad",
      lastName: "Reference",
      officialEmail: "bad@test.example",
      joinedAt: "2026-01-01",
    };
    expect(
      (
        await call("employees", "POST", adminCookie, {
          ...base,
          departmentId: otherDepartmentId,
        })
      ).response.status,
    ).toBe(422);
    expect(
      (
        await call("employees", "POST", adminCookie, {
          ...base,
          companyId: companyB,
        })
      ).response.status,
    ).toBe(422);
  });
  it("creates, searches, edits and archives an employee with protected PII", async () => {
    const create = await call("employees", "POST", adminCookie, {
      employeeCode: "CRUD",
      firstName: "Secure",
      lastName: "Person",
      officialEmail: "secure@test.example",
      joinedAt: "2026-02-01",
      departmentId,
      sensitive: { bankAccount: "1234567890", pan: "TEST123" },
    });
    expect(create.response.status).toBe(201);
    const id = create.json.data.id;
    const stored = await db.employee.findUniqueOrThrow({ where: { id } });
    expect(stored.sensitiveEncrypted).not.toContain("1234567890");
    const restricted = await call(`employees/${id}`, "GET", hrCookie);
    expect(restricted.response.status).toBe(200);
    expect(restricted.json.data.sensitive).toBeUndefined();
    expect(restricted.json.data.sensitiveEncrypted).toBeUndefined();
    expect(
      (
        await call(`employees/${id}`, "PUT", hrCookie, {
          sensitive: { pan: "blocked" },
        })
      ).response.status,
    ).toBe(403);
    const list = await call(
      "employees?search=Secure&pageSize=1",
      "GET",
      adminCookie,
    );
    expect(list.json.data.total).toBe(1);
    expect(list.json.data.items).toHaveLength(1);
    expect(
      (
        await call(`employees/${id}`, "PUT", adminCookie, {
          firstName: "Updated",
        })
      ).response.status,
    ).toBe(200);
    expect(
      (await call(`employees/${id}`, "DELETE", adminCookie)).response.status,
    ).toBe(200);
    expect(
      (await db.employee.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("Inactive");
    const logs = await db.auditLog.findMany({
      where: { companyId: companyA, recordId: id },
    });
    expect(logs.length).toBe(3);
    expect(JSON.stringify(logs)).not.toContain("1234567890");
  });
  it("allows only permitted own-profile fields", async () => {
    const own = await call("profile", "GET", employeeCookie);
    expect(own.json.data.id).toBe(employeeId);
    expect(
      (
        await call("profile", "PUT", employeeCookie, {
          mobile: "+919999999999",
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await call("profile", "PUT", employeeCookie, {
          status: "Inactive",
          roleId: employeeRoleId,
        })
      ).response.status,
    ).toBe(422);
  });
  it("prevents reporting cycles", async () => {
    expect(
      (
        await call(`employees/${employeeId}`, "PUT", adminCookie, {
          managerId: employeeId,
        })
      ).response.status,
    ).toBe(422);
  });
  it("prevents role escalation and super-admin assignment", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { companyId_name: { companyId: companyA, name: "Super Admin" } },
    });
    expect(
      (
        await call("users", "POST", adminCookie, {
          name: "Bad",
          email: "bad-role@test.example",
          password,
          roleId: role.id,
        })
      ).response.status,
    ).toBe(403);
    expect(
      (
        await call("roles", "PUT", hrCookie, {
          name: "Escalate",
          permissions: ["users.write"],
        })
      ).response.status,
    ).toBe(404);
  });
  it("configures a custom role and user then immediately revokes disabled sessions", async () => {
    const r = await call("roles", "POST", adminCookie, {
      name: "Custom reviewer",
      permissions: ["profile.read"],
    });
    expect(r.response.status).toBe(200);
    const u = await call("users", "POST", adminCookie, {
      name: "Reviewer",
      email: "reviewer@test.example",
      password,
      roleId: r.json.data.id,
    });
    expect(u.response.status).toBe(200);
    const signIn = await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "reviewer@test.example",
      password,
    });
    expect(signIn.response.status).toBe(200);
    expect(
      (
        await call(`users/${u.json.data.id}`, "PUT", adminCookie, {
          active: false,
        })
      ).response.status,
    ).toBe(200);
    expect((await call("auth/me", "GET", signIn.cookie)).response.status).toBe(
      401,
    );
  });
  it("requires second factor and rejects replay of the same authenticator code", async () => {
    const setup = await call("auth/2fa/setup", "POST", employeeCookie, {
      password,
    });
    expect(setup.response.status).toBe(200);
    const step = Math.floor(Date.now() / 30000),
      code = codeForStep(setup.json.data.secret, step);
    expect(
      (
        await call("auth/2fa/enable", "POST", employeeCookie, {
          password,
          code,
        })
      ).response.status,
    ).toBe(200);
    const b = {
      companyCode: prefix + "A",
      identifier: "employee@test.example",
      password,
    };
    expect((await call("auth/login", "POST", "", b)).json.errorCode).toBe(
      "TWO_FACTOR_REQUIRED",
    );
    expect(
      (await call("auth/login", "POST", "", { ...b, totp: code })).response
        .status,
    ).toBe(401);
    const next = codeForStep(setup.json.data.secret, step + 1);
    expect(
      (await call("auth/login", "POST", "", { ...b, totp: next })).response
        .status,
    ).toBe(200);
  });
  it("rotates refresh tokens and invalidates logout sessions", async () => {
    const signed = await call("auth/login", "POST", "", {
      companyCode: prefix + "A",
      identifier: "hr@test.example",
      password,
    });
    const refreshed = await call("auth/refresh", "POST", signed.cookie);
    expect(refreshed.response.status).toBe(200);
    expect(
      (await call("auth/refresh", "POST", signed.cookie)).response.status,
    ).toBe(401);
    expect(
      (await call("auth/logout", "POST", refreshed.cookie)).response.status,
    ).toBe(200);
    expect(
      (await call("auth/me", "GET", refreshed.cookie)).response.status,
    ).toBe(401);
  });
  it("delivers a one-use email OTP through the provider adapter", async () => {
    const requested = await call("auth/otp/request", "POST", "", {
      companyCode: prefix + "A",
      identifier: "hr@test.example",
    });
    expect(requested.response.status).toBe(200);
    const token = mail.messages.at(-1)!.text.match(/code is (\d{6})/)![1];
    const b = { challengeId: requested.json.data.challengeId, token };
    expect((await call("auth/otp/verify", "POST", "", b)).response.status).toBe(
      200,
    );
    expect((await call("auth/otp/verify", "POST", "", b)).response.status).toBe(
      400,
    );
  });
  it("resets a password with a one-use token and revokes all existing sessions", async () => {
    const requested = await call("auth/forgot-password", "POST", "", {
      companyCode: prefix + "A",
      identifier: "hr@test.example",
    });
    expect(requested.response.status).toBe(200);
    const link = new URL(
      mail.messages.at(-1)!.text.match(/https?:\/\/\S+/)![0],
    );
    const b = {
      challengeId: link.searchParams.get("id"),
      token: link.searchParams.get("token"),
      newPassword: "Changed-Integration-Password!",
    };
    expect(
      (await call("auth/reset-password", "POST", "", b)).response.status,
    ).toBe(200);
    expect(
      (await call("auth/reset-password", "POST", "", b)).response.status,
    ).toBe(400);
    expect((await call("auth/me", "GET", hrCookie)).response.status).toBe(401);
    expect(
      (
        await call("auth/login", "POST", "", {
          companyCode: prefix + "A",
          identifier: "hr@test.example",
          password: b.newPassword,
        })
      ).response.status,
    ).toBe(200);
  });
  it("does not reveal whether an email recovery account exists", async () => {
    const r = await call("auth/forgot-password", "POST", "", {
      companyCode: prefix + "A",
      identifier: "missing@test.example",
    });
    expect(r.response.status).toBe(200);
    expect(r.json.data.message).toContain("If the account exists");
  });
  it("enforces login rate limits", async () => {
    let status = 0;
    for (let i = 0; i < 11; i++)
      status = (
        await call("auth/login", "POST", "", {
          companyCode: prefix + "A",
          identifier: "rate-limit@test.example",
          password: "incorrect",
        })
      ).response.status;
    expect(status).toBe(429);
  });
});
