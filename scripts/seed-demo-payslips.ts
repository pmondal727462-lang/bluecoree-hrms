import "dotenv/config";
import { readFileSync } from "node:fs";
import { systemDb as db } from "../src/lib/db";

// Add fictional sample payslips only to the exact tenant created by our demo seed.
async function main() {
  const saved = JSON.parse(
    readFileSync("data/live-demo10-credentials.json", "utf8"),
  );
  const company = await db.company.findUniqueOrThrow({
    where: { code: "DEMO10" },
  });
  if (
    process.env.APP_URL !== "https://bluecoreehr.vercel.app" ||
    company.id !== saved.companyId ||
    company.name !== "[Demo] BlueCoree Sample Client"
  )
    throw new Error(
      "The expected live demo tenant was not found; no changes made.",
    );
  const employees = await db.employee.findMany({
    where: { companyId: company.id },
    orderBy: { employeeCode: "asc" },
  });
  if (employees.length !== 10)
    throw new Error("Expected exactly 10 demo employees.");
  const start = new Date("2026-08-01"),
    end = new Date("2026-08-31");
  const counts = await Promise.all([
    db.attendance.count({
      where: { companyId: company.id, workDate: { gte: start, lte: end } },
    }),
    db.payslip.count({ where: { companyId: company.id, periodStart: start } }),
    db.salaryStructure.count({ where: { companyId: company.id } }),
  ]);
  console.log(
    JSON.stringify({
      code: company.code,
      employees: employees.length,
      attendance: counts[0],
      payslips: counts[1],
      salaryStructures: counts[2],
    }),
  );
  if (!process.argv.includes("--create")) return;
  if (counts[0] !== 210 || counts[1] || counts[2])
    throw new Error(
      "Demo payroll data already exists or attendance is incomplete; refusing to overwrite it.",
    );
  await db.$transaction(
    async (tx) => {
      for (const [index, employee] of employees.entries()) {
        const basic = 20000 + index * 1000,
          hra = basic * 0.4,
          specialAllowance = 2000;
        const gross = basic + hra + specialAllowance;
        await tx.salaryStructure.create({
          data: {
            companyId: company.id,
            employeeId: employee.id,
            basic,
            hra,
            specialAllowance,
            pfApplicable: false,
            esiApplicable: false,
            ptApplicable: false,
            effectiveFrom: start,
          },
        });
        await tx.payslip.create({
          data: {
            companyId: company.id,
            employeeId: employee.id,
            periodStart: start,
            periodEnd: end,
            grossPay: gross,
            netPay: gross,
            deductions: 0,
            currency: "INR",
            breakdown: {
              demo: true,
              note: "Fictional sample amounts for product demonstration; no payment or statutory calculation.",
              earnings: { basic, hra, specialAllowance },
              deductions: {},
              reimbursements: 0,
              days: { total: 31, paid: 31, lop: 0, absent: 0 },
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: company.id,
          actorName: "Demo data setup",
          action: "DEMO_PAYSLIPS_CREATED",
          module: "payroll",
          recordId: company.id,
          newValue: {
            period: "2026-08",
            count: 10,
            fictional: true,
            paymentsInitiated: false,
          },
        },
      });
    },
    { timeout: 30000 },
  );
  const slips = await db.payslip.findMany({
    where: { companyId: company.id, periodStart: start },
    select: { grossPay: true, netPay: true },
  });
  if (
    slips.length !== 10 ||
    slips.some((s) => s.grossPay <= 0 || s.netPay !== s.grossPay)
  )
    throw new Error("Payslip verification failed.");
  console.log(
    "Verified 10 August 2026 demo payslips with sample earnings and zero deductions. No payments initiated.",
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Demo payslip setup failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
