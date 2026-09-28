import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { systemDb as db, withTenant } from "../src/lib/db";
import { provisionCompany, type Context } from "../src/modules/auth/service";
import { permissions } from "../src/config/permissions";
import { payrollAdmin } from "../src/modules/payroll/runs";
import { statutoryConfig } from "../src/modules/payroll/rules";
import { planFeatures } from "../src/modules/saas/service";

// Deterministic fictional data. Never deletes or modifies existing real tenants.
const period = "2026-08";
const names = [
  "Aarav",
  "Ananya",
  "Ishaan",
  "Diya",
  "Kabir",
  "Meera",
  "Rohan",
  "Priya",
  "Arjun",
  "Sneha",
  "Vikram",
  "Nisha",
  "Dev",
  "Riya",
  "Kunal",
];
const surnames = [
  "Sharma",
  "Das",
  "Roy",
  "Patel",
  "Nair",
  "Singh",
  "Mehta",
  "Shah",
  "Rao",
  "Kapoor",
  "Sen",
  "Bose",
  "Verma",
  "Gupta",
  "Kumar",
];
const companies = [
  "Aurora Software",
  "Cedar Retail",
  "Lotus Healthcare",
  "Summit Manufacturing",
  "Harbor Logistics",
  "Maple Design",
];
const planNames = [
  "Trial",
  "Basic",
  "Professional",
  "Enterprise",
  "Annual Professional",
  "Expired Trial",
];
let state = 20260928;
const random = () => {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 4294967296;
};
type Login = {
  company: string;
  code: string;
  email: string;
  role: string;
  password: string;
};
type Expected = {
  code: string;
  employeeCode: string;
  name: string;
  absent: number;
  half: number;
  single: number;
  expectedLop: number;
  basic: number;
  hra: number;
  special: number;
};

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Checking data is disabled in production.");
  const dbUrl = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname))
    throw new Error(
      "This checking seed only runs against the local development database.",
    );
  mkdirSync("data", { recursive: true });
  const loginPath = "data/checking-logins.json",
    expectedPath = "data/checking-expected.json";
  const logins: Login[] = existsSync(loginPath)
    ? JSON.parse(readFileSync(loginPath, "utf8"))
    : [];
  const expected: Expected[] = existsSync(expectedPath)
    ? JSON.parse(readFileSync(expectedPath, "utf8"))
    : [];
  const monthDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const checks: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    const code = `CHECK${i + 1}`,
      count = 10 + i;
    let company = await db.company.findUnique({ where: { code } });
    if (company && !company.name.startsWith("[Demo]"))
      throw new Error(
        `${code} belongs to a real company; no changes made to it.`,
      );
    if (!company) {
      const password = randomBytes(18).toString("base64url");
      const hash = await bcrypt.hash(password, 12);
      const generatedLogins: Login[] = [],
        generatedExpected: Expected[] = [];
      company = await db.$transaction(
        async (tx) => {
          const c = await provisionCompany(tx, {
            code,
            name: `[Demo] ${companies[i]}`,
            email: `contact@${code.toLowerCase()}.example.com`,
            timezone: "Asia/Kolkata",
            workingDays: [1, 2, 3, 4, 5],
          });
          const plan = await tx.subscriptionPlan.create({
            data: {
              code: `DEMO_CHECK_${i + 1}`,
              name: `[Demo] ${planNames[i]}`,
              description: "Private test plan; fictional data only.",
              priceMonthly: [0, 999, 2499, 4999, 2499, 0][i],
              priceAnnual: i === 4 ? 24990 : null,
              employeeLimit: [25, 50, 100, 500, 100, 25][i],
              adminLimit: 5,
              features:
                i === 3
                  ? [...planFeatures]
                  : [
                      "attendance",
                      "payroll",
                      "reports",
                      "training",
                      ...(i > 1 ? ["performance", "expenses"] : []),
                    ],
              trialDays: i === 0 || i === 5 ? 14 : null,
              active: true,
              public: false,
              sortOrder: 900 + i,
            },
          });
          const now = Date.now();
          await tx.subscription.update({
            where: { companyId: c.id },
            data: {
              planId: plan.id,
              status: i === 0 || i === 5 ? "TRIAL" : "ACTIVE",
              billingCycle: i === 4 ? "ANNUAL" : "MONTHLY",
              trialEndsAt:
                i === 0
                  ? new Date(now + 14 * 86400000)
                  : i === 5
                    ? new Date(now - 30 * 86400000)
                    : null,
              currentPeriodEnd:
                i > 0 && i < 5
                  ? new Date(now + (i === 4 ? 365 : 30) * 86400000)
                  : null,
              graceDays: 7,
              notes:
                "Fictional payroll/attendance checking tenant. Do not invoice or contact these users.",
            },
          });
          const singlePunchStatus = ["ABSENT", "PRESENT", "HALF_DAY"][i % 3];
          await tx.attendancePolicy.upsert({
            where: { companyId: c.id },
            create: {
              companyId: c.id,
              singlePunchStatus,
              faceAttendanceEnabled: false,
            },
            update: { singlePunchStatus, faceAttendanceEnabled: false },
          });
          const shift = await tx.shift.create({
            data: {
              companyId: c.id,
              name: "General 09:00–18:00",
              startMinute: 540,
              endMinute: 1080,
              breakMinutes: 60,
              minimumMinutes: 480,
              halfDayMinutes: 240,
              graceMinutes: 10,
            },
          });
          const roles = await tx.role.findMany({ where: { companyId: c.id } });
          const branch = await tx.branch.findFirstOrThrow({
            where: { companyId: c.id },
          });
          const departments = await tx.department.findMany({
            where: { companyId: c.id },
            orderBy: { name: "asc" },
          });
          for (let j = 0; j < count; j++) {
            const roleName =
              j === 0
                ? "Company Admin"
                : j === 1
                  ? "HR Manager"
                  : j === 2
                    ? "Finance Manager"
                    : "Employee";
            const email = `${j === 0 ? "admin" : `employee${String(j + 1).padStart(2, "0")}`}@${code.toLowerCase()}.example.com`;
            const employeeCode = `EMP${String(j + 1).padStart(3, "0")}`;
            const name = `${names[j]} ${surnames[(j + i) % surnames.length]}`;
            const u = await tx.user.create({
              data: {
                companyId: c.id,
                roleId: roles.find((r) => r.name === roleName)!.id,
                name,
                email,
                passwordHash: hash,
              },
            });
            const e = await tx.employee.create({
              data: {
                companyId: c.id,
                userId: u.id,
                employeeCode,
                firstName: names[j],
                lastName: surnames[(j + i) % surnames.length],
                officialEmail: email,
                joinedAt: new Date(
                  j === 3 ? `2023-${monthDay.slice(5)}` : "2024-01-01",
                ),
                dateOfBirth: new Date(
                  j === 4
                    ? `1995-${monthDay.slice(5)}`
                    : `199${j % 10}-01-${String(j + 1).padStart(2, "0")}`,
                ),
                shiftId: shift.id,
                departmentId: departments[j % departments.length].id,
                branchId: branch.id,
                faceRequired: false,
              },
            });
            const basic =
              j === 0 ? 10000 : (100 + Math.floor(random() * 350)) * 100;
            const hra = Math.round(basic * 0.4),
              special = (5 + Math.floor(random() * 40)) * 100;
            await tx.salaryStructure.create({
              data: {
                companyId: c.id,
                employeeId: e.id,
                basic,
                hra,
                specialAllowance: special,
                effectiveFrom: new Date("2024-01-01"),
                pfApplicable: i !== 0,
                esiApplicable: i !== 0,
                ptApplicable: false,
              },
            });
            let absent = 0,
              half = 0,
              single = 0;
            for (let d = 1; d <= 31; d++) {
              const date = `${period}-${String(d).padStart(2, "0")}`,
                workDate = new Date(date);
              if ([0, 6].includes(workDate.getUTCDay())) continue;
              const roll = random();
              const kind =
                d === 5
                  ? "ABSENT"
                  : d === 6
                    ? "HALF_DAY"
                    : d === 7
                      ? "SINGLE"
                      : roll < 0.06
                        ? "ABSENT"
                        : roll < 0.14
                          ? "HALF_DAY"
                          : "PRESENT";
              if (kind === "ABSENT") {
                absent++;
                continue;
              }
              if (kind === "HALF_DAY") half++;
              if (kind === "SINGLE") single++;
              const late = kind === "PRESENT" && roll > 0.85 ? 20 : 0;
              const checkIn = new Date(
                `${date}T09:${late ? "20" : "00"}:00+05:30`,
              );
              const checkOut =
                kind === "SINGLE"
                  ? null
                  : new Date(
                      `${date}T${kind === "HALF_DAY" ? "14:00" : late ? "18:20" : "18:00"}:00+05:30`,
                    );
              const row = await tx.attendance.create({
                data: {
                  companyId: c.id,
                  employeeId: e.id,
                  workDate,
                  checkIn,
                  checkOut,
                  workedMinutes:
                    kind === "SINGLE" ? 0 : kind === "HALF_DAY" ? 240 : 480,
                  expectedMinutes: 480,
                  breakMinutes: 60,
                  shiftName: shift.name,
                  scheduledEnd: new Date(`${date}T18:00:00+05:30`),
                  status: kind === "HALF_DAY" ? "HALF_DAY" : "PRESENT",
                  lateMinutes: late ? 10 : 0,
                  source: "Manual",
                  correctionReason: "Fictional checking data",
                },
              });
              await tx.attendancePunch.createMany({
                data: [
                  {
                    companyId: c.id,
                    employeeId: e.id,
                    attendanceId: row.id,
                    direction: "IN",
                    punchedAt: checkIn,
                    source: "Manual",
                  },
                  ...(checkOut
                    ? [
                        {
                          companyId: c.id,
                          employeeId: e.id,
                          attendanceId: row.id,
                          direction: "OUT",
                          punchedAt: checkOut,
                          source: "Manual",
                        },
                      ]
                    : []),
                ],
              });
            }
            generatedLogins.push({
              company: c.name,
              code,
              email,
              role: roleName,
              password,
            });
            generatedExpected.push({
              code,
              employeeCode,
              name,
              absent,
              half,
              single,
              expectedLop:
                absent +
                half * 0.5 +
                single *
                  (singlePunchStatus === "ABSENT"
                    ? 1
                    : singlePunchStatus === "HALF_DAY"
                      ? 0.5
                      : 0),
              basic,
              hra,
              special,
            });
          }
          const admin = await tx.user.findFirstOrThrow({
            where: { companyId: c.id, role: { name: "Company Admin" } },
          });
          await tx.statutorySetting.upsert({
            where: { companyId: c.id },
            create: {
              companyId: c.id,
              updatedBy: admin.id,
              config: {
                lopFromAttendance: true,
                pfEnabled: i !== 0,
                esiEnabled: i !== 0,
                ptEnabled: false,
                tdsEnabled: false,
              },
            },
            update: {},
          });
          return c;
        },
        { timeout: 120000 },
      );
      logins.push(...generatedLogins);
      expected.push(...generatedExpected);
      writeFileSync(loginPath, JSON.stringify(logins, null, 2), {
        mode: 0o600,
      });
      writeFileSync(expectedPath, JSON.stringify(expected, null, 2));
    }
    const admin = await db.user.findFirstOrThrow({
      where: { companyId: company.id, role: { name: "Company Admin" } },
    });
    const ctx: Context = {
      companyId: company.id,
      userId: admin.id,
      name: admin.name,
      roleId: admin.roleId,
      roleName: "Company Admin",
      isSuperAdmin: false,
      sessionId: "local-demo-seed",
      permissions: Object.keys(permissions),
    };
    let run = await db.payrollRun.findUnique({
      where: { companyId_period: { companyId: company.id, period } },
    });
    if (!run) {
      await withTenant(company.id, () =>
        payrollAdmin(
          new NextRequest("http://localhost:3000/api/payroll/runs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ period }),
          }),
          ctx,
          ["payroll", "runs"],
        ),
      );
      run = await db.payrollRun.findUniqueOrThrow({
        where: { companyId_period: { companyId: company.id, period } },
      });
    }
    const items = await db.payrollRunItem.findMany({
      where: { runId: run.id },
      include: { employee: { select: { employeeCode: true } } },
    });
    const { config } = await withTenant(company.id, () =>
      statutoryConfig(company!.id, undefined, period),
    );
    for (const item of items) {
      const want = expected.find(
        (e) => e.code === code && e.employeeCode === item.employee.employeeCode,
      );
      if (!want)
        throw new Error(
          `Missing independent expectation for ${code}/${item.employee.employeeCode}.`,
        );
      const factor = (31 - want.expectedLop) / 31;
      const gross = [want.basic, want.hra, want.special].reduce(
        (sum, value) => sum + Math.round(value * factor),
        0,
      );
      const pf =
        i === 0
          ? 0
          : Math.round(
              (Math.min(Math.round(want.basic * factor), config.pfWageCeiling) *
                config.pfEmployeeRate) /
                100,
            );
      const esi =
        i !== 0 &&
        want.basic + want.hra + want.special <= config.esiWageThreshold
          ? Math.ceil((gross * config.esiEmployeeRate) / 100)
          : 0;
      const net = gross - pf - esi;
      checks.push({
        company: code,
        employee: want.employeeCode,
        name: want.name,
        period,
        absentDays: want.absent,
        halfDays: want.half,
        singlePunchDays: want.single,
        expectedLop: want.expectedLop,
        actualLop: item.lopDays,
        expectedGross: gross,
        actualGross: item.gross,
        expectedNet: net,
        actualNet: item.netPay,
        pass:
          item.lopDays === want.expectedLop &&
          item.gross === gross &&
          item.netPay === net,
      });
    }
    console.log(
      `${code}: ${items.length} employees, ${planNames[i]}, ${period} draft payroll ready.`,
    );
  }
  writeFileSync(
    "data/checking-payroll-verification.json",
    JSON.stringify(checks, null, 2),
  );
  const failed = checks.filter((c) => !c.pass);
  console.log(
    `${checks.length - failed.length}/${checks.length} independent payroll checks passed. Credentials: data/checking-logins.json. Report: data/checking-payroll-verification.json.`,
  );
  if (failed.length)
    throw new Error(
      `${failed.length} payroll checks failed; inspect the report before using the demo.`,
    );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Checking seed failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
