import { afterAll, beforeAll, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/[...path]/route";
import { systemDb as db } from "../../src/lib/db";
import { encrypt } from "../../src/lib/crypto";
import { Fixture, call } from "./helpers";

const f = new Fixture();
let companyId: string;
let otherSlip: string;
beforeAll(async () => {
  companyId = (await f.company("PORTAL")).id;
  await f.user("hr", companyId, "HR Manager");
  await f.user("worker", companyId, "Employee");
  await f.user("colleague", companyId, "Employee");
  await f.user("auditor", companyId, "Auditor");
  const other = await f.company("OTHER");
  await f.user("outsider", other.id, "HR Manager");
  await db.company.update({
    where: { id: companyId },
    data: { timezone: "Asia/Kolkata" },
  });
  const branch = await db.branch.create({
    data: { companyId, name: "Kolkata" },
  });
  const department = await db.department.create({
    data: { companyId, name: "Engineering" },
  });
  for (const who of ["worker", "colleague"]) {
    await db.employee.update({
      where: { id: f.employees[who] },
      data: {
        branchId: branch.id,
        departmentId: department.id,
        sensitiveEncrypted: encrypt({
          bankAccount: "001234567890",
          ifsc: "TEST0001234",
        }),
      },
    });
    await db.attendance.create({
      data: {
        companyId,
        employeeId: f.employees[who],
        workDate: new Date("2026-08-03"),
        checkIn: new Date("2026-08-03T03:30:00Z"),
        checkOut: new Date("2026-08-03T11:30:00Z"),
        workedMinutes: 480,
        status: "PRESENT",
      },
    });
    const slip = await db.payslip.create({
      data: {
        companyId,
        employeeId: f.employees[who],
        periodStart: new Date("2026-08-01"),
        periodEnd: new Date("2026-08-31"),
        grossPay: 30000,
        netPay: 29000,
        deductions: 1000,
      },
    });
    if (who === "colleague") otherSlip = slip.id;
  }
  // An old/customized Employee role must not grant access to other people.
  const role = await db.role.findUniqueOrThrow({
    where: { companyId_name: { companyId, name: "Employee" } },
  });
  await db.rolePermission.createMany({
    data: [
      "employees.read",
      "attendance.read",
      "payroll.read",
      "timeoff.manage",
    ].map((permissionKey) => ({ roleId: role.id, permissionKey })),
  });
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

async function workbook(
  who: string,
  scope = "own",
  extra = "from=2026-08-01&to=2026-08-31",
) {
  const response = await GET(
    new NextRequest(
      `http://localhost:3000/api/time/attendance-report?scope=${scope}&${extra}`,
      { headers: { cookie: f.cookies[who] } },
    ),
    { params: Promise.resolve({ path: ["time", "attendance-report"] }) },
  );
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  return book;
}
it("returns only the signed-in profile, attendance and payslips and denies company data", async () => {
  expect(
    (
      await call(
        f,
        `profile?employeeId=${f.employees.colleague}`,
        "GET",
        "worker",
      )
    ).body.data.id,
  ).toBe(f.employees.worker);
  const records = (
    await call(
      f,
      `time/attendance?scope=own&from=2026-08-01&to=2026-08-31&employeeId=${f.employees.colleague}`,
      "GET",
      "worker",
    )
  ).body.data;
  expect(records.total).toBe(1);
  expect(records.items[0].employeeId).toBe(f.employees.worker);
  for (const path of [
    "employees",
    "home",
    "celebrations",
    "documents",
    "time/attendance?scope=company",
    "time/leave?scope=company",
    "payroll/runs",
    "payroll/period-policy",
    "time/attendance-report?scope=company&from=2026-08-01&to=2026-08-31",
  ]) {
    expect((await call(f, path, "GET", "worker")).status, path).toBe(403);
  }
  const slips = (
    await call(
      f,
      `payroll/payslips?page=1&period=2026-08&employeeId=${f.employees.colleague}`,
      "GET",
      "worker",
    )
  ).body.data;
  expect(slips.total).toBe(1);
  expect(slips.items[0].employee.id).toBe(f.employees.worker);
  expect(
    (await call(f, `payroll/payslips/${otherSlip}/pdf`, "GET", "worker"))
      .status,
  ).toBe(404);
  expect(
    (await call(f, `payroll/payslips/${otherSlip}/pdf`, "GET", "outsider"))
      .status,
  ).toBe(404);
  expect((await call(f, "time/leave?scope=own", "GET", "worker")).status).toBe(
    200,
  );
});
it("filters HR payslips by closing month and employee without leaking another company", async () => {
  expect(
    (
      await call(
        f,
        "payroll/payslips?page=1&period=2026-08&search=WORKER",
        "GET",
        "hr",
      )
    ).body.data.total,
  ).toBe(1);
  expect(
    (await call(f, "payroll/payslips?page=1&period=2026-07", "GET", "hr")).body
      .data.total,
  ).toBe(0);
  expect(
    (await call(f, "payroll/payslips?page=1", "GET", "outsider")).body.data
      .total,
  ).toBe(0);
});
it("exports the reference layout with local times and permission-scoped banking and salary", async () => {
  const own = await workbook("worker");
  expect(own.worksheets).toHaveLength(1);
  const sheet = own.getWorksheet("Kolkata")!;
  const text = JSON.stringify(sheet.model);
  expect(text).toContain("WORKER - worker Tester");
  expect(text).not.toContain("COLLEAGUE");
  expect(text).not.toContain("001234567890");
  expect(sheet.getCell("A4").value).toBe("DEPARTMENT: Engineering");
  expect(sheet.getCell("A6").value).toBe("Status");
  expect(sheet.getCell("D6").value).toBe("P");
  expect((sheet.getCell("D7").value as Date).getUTCHours()).toBe(9);
  expect((sheet.getCell("D8").value as Date).getUTCHours()).toBe(17);
  expect(sheet.getCell("D9").numFmt).toBe("[h]:mm");
  const total = sheet.getCell("D9").value;
  expect(total instanceof Date ? total.getUTCHours() : Number(total) * 24).toBe(
    8,
  );
  expect(sheet.getCell("AJ5").value).toBe(29000);
  const hr = JSON.stringify((await workbook("hr", "company")).model);
  expect(hr).toContain("001234567890");
  expect(hr).toContain("COLLEAGUE");
  const audit = JSON.stringify((await workbook("auditor", "company")).model);
  expect(audit).not.toContain("001234567890");
  expect(audit).not.toContain("29000");
});
