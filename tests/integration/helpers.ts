import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { provisionCompany } from "../../src/modules/auth/service";
import { GET, POST, PUT, DELETE } from "../../src/app/api/[...path]/route";
import { deleteAttendance } from "./cleanup";
import { testClientIp } from "./client";

export const password = "Integration-Password-123!";
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Result = { status: number; body: any; headers: Headers };

// A test tenant with named users; every user gets an employee record and a
// signed-in session cookie. Clean up with cleanup().
export class Fixture {
  readonly prefix = `T${randomBytes(4).toString("hex").toUpperCase()}`;
  readonly companies: string[] = [];
  readonly codes: string[] = [];
  readonly cookies: Record<string, string> = {};
  readonly users: Record<string, string> = {};
  readonly employees: Record<string, string> = {};
  private hash = bcrypt.hash(password, 12);

  async company(suffix: string) {
    const c = await db.$transaction(
      (tx) =>
        provisionCompany(tx, {
          code: this.prefix + suffix,
          name: `Test ${suffix}`,
          email: "tenant@example.com",
          timezone: "UTC",
          workingDays: [1, 2, 3, 4, 5],
        }),
      { timeout: 20000 },
    );
    this.companies.push(c.id);
    this.codes.push(c.code);
    return c;
  }
  async user(
    who: string,
    companyId: string,
    roleName: string,
    extra: {
      managerOf?: string;
      joinedAt?: string;
      superAdmin?: boolean;
      login?: boolean;
    } = {},
  ) {
    const role = await db.role.findUniqueOrThrow({
      where: { companyId_name: { companyId, name: roleName } },
    });
    const email = `${who}@${this.prefix.toLowerCase()}.example.com`;
    const user = await db.user.create({
      data: {
        companyId,
        roleId: role.id,
        name: `${who} user`,
        email,
        passwordHash: await this.hash,
        isSuperAdmin: !!extra.superAdmin,
      },
    });
    const e = await db.employee.create({
      data: {
        companyId,
        userId: user.id,
        firstName: who,
        lastName: "Tester",
        employeeCode: who.toUpperCase(),
        officialEmail: email,
        joinedAt: new Date(extra.joinedAt ?? "2024-01-01"),
        managerId: extra.managerOf ? this.employees[extra.managerOf] : null,
      },
    });
    this.users[who] = user.id;
    this.employees[who] = e.id;
    if (extra.login !== false) {
      const login = await this.login(who, companyId, email);
      if (login.status !== 200)
        throw new Error(`Fixture login failed (${login.status}).`);
    }
    return { user, employee: e, email };
  }
  async login(who: string, companyId: string, email: string, pass = password) {
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    const r = await call(this, "auth/login", "POST", "", {
      companyCode: company.code,
      identifier: email,
      password: pass,
    });
    this.cookies[who] = r.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    return r;
  }
  async cleanup() {
    if (!this.companies.length) return;
    const where = { companyId: { in: this.companies } };
    await db.$transaction(
      async (tx) => {
        // Tables without cascading company deletes are cleared first.
        await tx.payrollRunItem.updateMany({
          where,
          data: { payslipId: null },
        });
        await tx.onboardingTask.updateMany({
          where,
          data: { documentId: null },
        });
        await tx.onboarding.updateMany({
          where,
          data: { candidateId: null, employeeId: null },
        });
        await tx.performanceReview.updateMany({
          where,
          data: { reviewerEmployeeId: null },
        });
        await tx.jobOpening.updateMany({
          where,
          data: { hiringManagerId: null },
        });
        await tx.devicePunch.deleteMany({ where });
        await tx.payslip.deleteMany({ where });
        await tx.leaveRequest.deleteMany({ where });
        await tx.leaveLedger.deleteMany({ where });
        await tx.holidaySelection.deleteMany({ where });
        await tx.compOffRequest.deleteMany({ where });
        await tx.leaveType.deleteMany({ where });
        await deleteAttendance(tx, where);
        await tx.candidate.deleteMany({ where });
        await tx.expenseClaim.deleteMany({ where });
        await tx.expenseCategory.deleteMany({ where });
        await tx.holiday.deleteMany({ where });
        await tx.employee.updateMany({ where, data: { managerId: null } });
        await tx.employee.deleteMany({ where });
        await tx.workJob.deleteMany({ where });
        await tx.workAgency.deleteMany({ where });
        await tx.shift.deleteMany({ where });
        await tx.session.deleteMany({ where: { user: where } });
        await tx.loginHistory.deleteMany({ where });
        await tx.authChallenge.deleteMany({ where });
        await tx.user.deleteMany({ where });
        await tx.rolePermission.deleteMany({ where: { role: where } });
        await tx.role.deleteMany({ where });
        await tx.department.deleteMany({ where });
        await tx.designation.deleteMany({ where });
        await tx.branch.deleteMany({ where });
        await tx.auditLog.deleteMany({ where });
        await tx.company.deleteMany({ where: { id: { in: this.companies } } });
      },
      { timeout: 60000 },
    );
  }
}

export async function call(
  f: Fixture,
  path: string,
  method = "GET",
  who = "",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Result> {
  const req = new NextRequest(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      "x-forwarded-for": testClientIp,
      origin: process.env.APP_URL || "http://localhost:3000",
      "content-type": "application/json",
      ...(who && f.cookies[who] ? { cookie: f.cookies[who] } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await { GET, POST, PUT, DELETE }[method as "GET"](req, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
export const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
