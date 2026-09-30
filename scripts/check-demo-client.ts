import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

async function main() {
  const c = JSON.parse(
    readFileSync("data/live-demo10-credentials.json", "utf8"),
  );
  const account = c.accounts.find(
    (a: { role: string }) => a.role === "Employee",
  );
  const base = "https://bluecoreehr.vercel.app";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      companyCode: c.companyCode,
      identifier: account.email,
      password: account.password,
    }),
  });
  assert.equal(login.status, 200, "Demo employee login");
  const cookie = login.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  assert(cookie, "Login should issue session cookies");
  const headers = { cookie };
  try {
    const get = async (path: string) => {
      const res = await fetch(`${base}/api/${path}`, { headers });
      assert.equal(res.status, 200, path);
      return (await res.json()).data;
    };
    const me = await get("auth/me");
    assert.equal(me.company.code, "DEMO10");
    assert.equal(me.company.timezone, "Asia/Kolkata");
    assert.equal(me.company.dateFormat, "DD/MM/YYYY");
    assert.deepEqual(
      [...me.permissions].sort(),
      [
        "profile.read",
        "profile.write",
        "attendance.self",
        "timeoff.self",
        "payroll.self",
      ].sort(),
    );
    const profile = await get("profile");
    assert.equal(profile.officialEmail, account.email);
    await get("time/summary");
    await get("time/leave?scope=own");
    const attendance = await get(
      "time/attendance?scope=own&from=2026-08-01&to=2026-08-31&pageSize=100",
    );
    assert.equal(attendance.total, 21);
    assert(
      attendance.items.every(
        (a: { workedMinutes: number }) => a.workedMinutes === 480,
      ),
    );
    const slips = await get("payroll/payslips");
    assert.equal(slips.length, 1);
    assert(slips[0].grossPay > 0 && slips[0].netPay > 0);
    const filtered = await get("payroll/payslips?page=1&period=2026-08");
    assert.equal(filtered.total, 1);
    const report = await fetch(
      `${base}/api/time/attendance-report?scope=own&period=2026-08`,
      { headers },
    );
    assert.equal(report.status, 200, "Excel attendance download");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await report.arrayBuffer());
    assert.equal(workbook.worksheets.length, 1);
    const reportText = JSON.stringify(workbook.model);
    assert(reportText.includes(account.name));
    assert(!reportText.includes("Ananya Das"));
    for (const path of [
      "employees",
      "time/leave?scope=company",
      "payroll/runs",
      "home",
    ]) {
      assert.equal(
        (await fetch(`${base}/api/${path}`, { headers })).status,
        403,
        path,
      );
    }
    const pdf = await fetch(`${base}/api/payroll/payslips/${slips[0].id}/pdf`, {
      headers,
    });
    assert.equal(pdf.status, 200, "Payslip PDF download");
    assert(pdf.headers.get("content-type")?.includes("application/pdf"));
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert(bytes.length > 1000);
    const forbidden = await fetch(`${base}/api/time/attendance?scope=company`, {
      headers,
    });
    assert.equal(
      forbidden.status,
      403,
      "Employee cannot export other employees' records",
    );
    console.log(
      JSON.stringify({
        login: "passed",
        attendance: attendance.total,
        payslips: slips.length,
        pdfBytes: bytes.length,
        timezone: me.company.timezone,
        dateFormat: me.company.dateFormat,
        isolation: "passed",
        employeePortal: "passed",
        excel: "passed",
        payslipFilter: "passed",
      }),
    );
  } finally {
    await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: base },
    });
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Demo verification failed");
  process.exitCode = 1;
});
