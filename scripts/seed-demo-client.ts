import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { systemDb as db } from "../src/lib/db";
import { provisionCompany } from "../src/modules/auth/service";

// Operator-only, additive demo provisioning. Existing tenants are never reused.
const code = "DEMO10";
const month = "2026-08";
const names = ["Aarav Sharma", "Ananya Das", "Ishaan Roy", "Diya Patel", "Kabir Nair", "Meera Singh", "Rohan Mehta", "Priya Shah", "Arjun Rao", "Sneha Kapoor"];
const output = "data/live-demo10-credentials.json";

async function main() {
  if (process.env.APP_URL !== "https://bluecoreehr.vercel.app")
    throw new Error("Load the live site's environment before running this script.");
  if (await db.company.findUnique({ where: { code } }))
    throw new Error("DEMO10 already exists; no changes made.");
  const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: "FREE_TRIAL" } });
  if (!plan.active || !plan.trialDays || (plan.employeeLimit !== null && plan.employeeLimit < 10) || !plan.features.includes("attendance"))
    throw new Error("The trial plan must support 10 employees and attendance.");
  if (!process.argv.includes("--create")) {
    console.log(JSON.stringify({ ready: true, companyCode: code, month, employees: 10, trialDays: plan.trialDays }));
    return;
  }
  const accounts = [
    { name: "Demo Client Admin", email: "admin@demo10.example.com", role: "Company Admin" },
    ...names.map((name, i) => ({ name, email: `employee${String(i + 1).padStart(2, "0")}@demo10.example.com`, role: "Employee" })),
  ].map((a) => ({ ...a, password: randomBytes(18).toString("base64url") }));
  const hashes = await Promise.all(accounts.map((a) => bcrypt.hash(a.password, 12)));
  mkdirSync("data", { recursive: true });
  const credentials = { status: "pending", login: `${process.env.APP_URL}/login`, companyCode: code, month, accounts };
  writeFileSync(output, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const company = await db.$transaction(async (tx) => {
    const c = await provisionCompany(tx, {
      code, name: "[Demo] BlueCoree Sample Client", email: "contact@demo10.example.com",
      timezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5],
    });
    const roles = await tx.role.findMany({ where: { companyId: c.id } });
    const departments = await tx.department.findMany({ where: { companyId: c.id }, orderBy: { name: "asc" } });
    const designations = await tx.designation.findMany({ where: { companyId: c.id }, orderBy: { name: "asc" } });
    const branch = await tx.branch.findFirstOrThrow({ where: { companyId: c.id } });
    const shift = await tx.shift.create({ data: {
      companyId: c.id, name: "General 09:00-18:00", startMinute: 540, endMinute: 1080,
      breakMinutes: 60, minimumMinutes: 480, halfDayMinutes: 240, graceMinutes: 10,
    } });
    await tx.attendancePolicy.create({ data: { companyId: c.id, faceAttendanceEnabled: false } });
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const user = await tx.user.create({ data: {
        companyId: c.id, roleId: roles.find((r) => r.name === account.role)!.id,
        name: account.name, email: account.email, passwordHash: hashes[i],
        mustChangePassword: i === 0, isSuperAdmin: false,
      } });
      if (i === 0) continue;
      const [firstName, lastName] = account.name.split(" ");
      const employee = await tx.employee.create({ data: {
        companyId: c.id, userId: user.id, employeeCode: `EMP${String(i).padStart(3, "0")}`,
        firstName, lastName, officialEmail: account.email, joinedAt: new Date("2026-07-01"),
        status: "Active", departmentId: departments[(i - 1) % departments.length].id,
        designationId: designations[(i - 1) % designations.length].id,
        branchId: branch.id, shiftId: shift.id, faceRequired: false,
      } });
      const days = Array.from({ length: 31 }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, "0")}`;
        const workDate = new Date(date);
        return { date, workDate, weeklyOff: [0, 6].includes(workDate.getUTCDay()) };
      });
      await tx.rosterEntry.createMany({ data: days.map((day) => ({
        companyId: c.id, employeeId: employee.id, workDate: day.workDate,
        weeklyOff: day.weeklyOff, shiftId: day.weeklyOff ? null : shift.id,
        note: "Fictional demo schedule",
      })) });
      const attendance = days.filter((day) => !day.weeklyOff).map((day) => ({
        id: randomUUID(), companyId: c.id, employeeId: employee.id, workDate: day.workDate,
        checkIn: new Date(`${day.date}T09:00:00+05:30`), checkOut: new Date(`${day.date}T18:00:00+05:30`),
        workedMinutes: 480, expectedMinutes: 480, breakMinutes: 60, shiftName: shift.name,
        scheduledEnd: new Date(`${day.date}T18:00:00+05:30`), status: "PRESENT", source: "Manual",
        correctionReason: "Fictional demo attendance requested by operator",
      }));
      await tx.attendance.createMany({ data: attendance });
      await tx.attendancePunch.createMany({ data: attendance.flatMap((a) => [
        { companyId: c.id, employeeId: employee.id, attendanceId: a.id, direction: "IN", punchedAt: a.checkIn, source: "Manual" },
        { companyId: c.id, employeeId: employee.id, attendanceId: a.id, direction: "OUT", punchedAt: a.checkOut, source: "Manual" },
      ]) });
    }
    await tx.auditLog.create({ data: {
      companyId: c.id, actorName: "Demo client provisioning", action: "DEMO_CREATED", module: "company", recordId: c.id,
      newValue: { month, employeeCount: 10, attendanceCount: 210, fictional: true },
    } });
    return c;
  }, { timeout: 120000 });
  writeFileSync(output, JSON.stringify({ ...credentials, status: "created", companyId: company.id }, null, 2) + "\n", { mode: 0o600 });
  const [employees, attendance, punches, weeklyOff] = await Promise.all([
    db.employee.count({ where: { companyId: company.id } }),
    db.attendance.count({ where: { companyId: company.id } }),
    db.attendancePunch.count({ where: { companyId: company.id } }),
    db.rosterEntry.count({ where: { companyId: company.id, weeklyOff: true } }),
  ]);
  if (employees !== 10 || attendance !== 210 || punches !== 420 || weeklyOff !== 100)
    throw new Error("Demo was created but verification counts differ; inspect before rerunning.");
  console.log(JSON.stringify({ company: company.name, code, month, employees, attendance, punches, weeklyOff, credentials: output }));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "Demo provisioning failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
