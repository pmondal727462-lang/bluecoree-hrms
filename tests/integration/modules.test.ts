import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { encrypt } from "../../src/lib/crypto";
import { provisionCompany } from "../../src/modules/auth/service";
import { GET, POST, PUT, DELETE } from "../../src/app/api/[...path]/route";
import { testClientIp } from "./client";
import { ptTemplates } from "../../src/modules/payroll/statutory";

const prefix = `MOD-${randomBytes(4).toString("hex").toUpperCase()}`;
const password = "Modules-Integration-Password-123!";
const companies: string[] = [];
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const png = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`;
const pdf = Buffer.from("%PDF-1.4\n% test resume\n").toString("base64");

async function call(
  path: string,
  method = "GET",
  who = "admin",
  body?: unknown,
) {
  const req = new NextRequest(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      "x-forwarded-for": testClientIp,
      origin: process.env.APP_URL || "http://localhost:3000",
      "content-type": "application/json",
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await { GET, POST, PUT, DELETE }[method as "GET"](req, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
const data = <T = never>(r: { body: { data: unknown } }) => r.body.data as T;

beforeAll(async () => {
  const hash = await bcrypt.hash(password, 12);
  for (const suffix of ["A", "B"]) {
    const c = await db.$transaction(
      (tx) =>
        provisionCompany(tx, {
          code: prefix + suffix,
          name: `Modules ${suffix}`,
          email: "modules@example.com",
          timezone: "UTC",
          workingDays: [1, 2, 3, 4, 5],
        }),
      { timeout: 20000 },
    );
    companies.push(c.id);
    const people =
      suffix === "A"
        ? [
            ["admin", "Company Admin", "ADM", null],
            ["manager", "Department Manager", "MGR", null],
            ["staff", "Employee", "STF", "manager"],
            ["finance", "Finance Manager", "FIN", null],
          ]
        : [["other", "Company Admin", "OTH", null]];
    for (const [who, roleName, code, managerOf] of people as [
      string,
      string,
      string,
      string | null,
    ][]) {
      const role = await db.role.findUniqueOrThrow({
        where: { companyId_name: { companyId: c.id, name: roleName } },
      });
      const email = `${who}@modules.example.com`;
      const user = await db.user.create({
        data: {
          companyId: c.id,
          roleId: role.id,
          name: `${who} user`,
          email,
          passwordHash: hash,
        },
      });
      const e = await db.employee.create({
        data: {
          companyId: c.id,
          userId: user.id,
          firstName: who,
          lastName: "Tester",
          employeeCode: code,
          officialEmail: email,
          joinedAt: new Date("2025-01-01"),
          managerId: managerOf ? ids[managerOf] : null,
        },
      });
      ids[who] = e.id;
      ids[`${who}User`] = user.id;
      const login = await call("auth/login", "POST", "", {
        companyCode: c.code,
        identifier: email,
        password,
      });
      expect(login.status).toBe(200);
      cookies[who] = login.headers
        .getSetCookie()
        .map((v: string) => v.split(";")[0])
        .join("; ");
    }
  }
});
afterAll(async () => {
  await db.$transaction(
    async (tx) => {
      const where = { companyId: { in: companies } };
      await tx.payrollRunItem.updateMany({ where, data: { payslipId: null } });
      await tx.onboardingTask.updateMany({ where, data: { documentId: null } });
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
      await tx.payslip.deleteMany({ where });
      await tx.leaveRequest.deleteMany({ where });
      await tx.leaveType.deleteMany({ where });
      await tx.candidate.deleteMany({ where });
      await tx.expenseClaim.deleteMany({ where });
      await tx.expenseCategory.deleteMany({ where });
      await tx.employee.deleteMany({ where });
      await tx.session.deleteMany({ where: { user: where } });
      await tx.loginHistory.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.rolePermission.deleteMany({ where: { role: where } });
      await tx.role.deleteMany({ where });
      await tx.department.deleteMany({ where });
      await tx.designation.deleteMany({ where });
      await tx.branch.deleteMany({ where });
      await tx.auditLog.deleteMany({ where });
      await tx.company.deleteMany({ where: { id: { in: companies } } });
    },
    { timeout: 30000 },
  );
  await db.$disconnect();
});

describe("Expense management", () => {
  it("validates claims and routes approval to the manager, never the claimant", async () => {
    expect(
      (
        await call("expenses/categories", "POST", "staff", {
          name: "Travel",
          limitPerClaim: 5000,
          requiresReceipt: true,
          active: true,
        })
      ).status,
    ).toBe(403);
    const cat = await call("expenses/categories", "POST", "admin", {
      name: "Travel",
      limitPerClaim: 5000,
      requiresReceipt: true,
      active: true,
    });
    ids.category = data<{ id: string }>(cat).id;
    const claim = {
      categoryId: ids.category,
      expenseDate: "2026-06-05",
      amount: 1500,
      description: "Cab to client site",
    };
    expect((await call("expenses/claims", "POST", "staff", claim)).status).toBe(
      422,
    );
    expect(
      (
        await call("expenses/claims", "POST", "staff", {
          ...claim,
          amount: 9000,
          receipt: {
            name: "r.png",
            type: "image/png",
            base64: png.split(",")[1],
          },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("expenses/claims", "POST", "staff", {
          ...claim,
          receipt: {
            name: "r.html",
            type: "text/html",
            base64: Buffer.from("<script>").toString("base64"),
          },
        })
      ).status,
    ).toBe(422);
    const created = await call("expenses/claims", "POST", "staff", {
      ...claim,
      receipt: {
        name: "receipt.png",
        type: "image/png",
        base64: png.split(",")[1],
      },
    });
    expect(created.status).toBe(200);
    ids.claim = data<{ id: string }>(created).id;
    expect(
      (
        await call(`expenses/claims/${ids.claim}`, "PUT", "staff", {
          action: "approve",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`expenses/claims/${ids.claim}`, "PUT", "other", {
          action: "approve",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`expenses/claims/${ids.claim}`, "PUT", "manager", {
          action: "reject",
        })
      ).status,
    ).toBe(422);
    const team = await call("expenses/claims?scope=team", "GET", "manager");
    expect(data<unknown[]>(team)).toHaveLength(1);
    const approved = await call(
      `expenses/claims/${ids.claim}`,
      "PUT",
      "manager",
      { action: "approve", note: "OK" },
    );
    expect(data<{ status: string }>(approved).status).toBe("MANAGER_APPROVED");
    // Finance approves second; the manager cannot give both approvals.
    expect(
      (
        await call(`expenses/claims/${ids.claim}`, "PUT", "manager", {
          action: "approve",
        })
      ).status,
    ).toBe(403);
    const final = await call(`expenses/claims/${ids.claim}`, "PUT", "admin", {
      action: "approve",
    });
    expect(data<{ status: string }>(final).status).toBe("APPROVED");
    const receipt = await call(
      `expenses/claims/${ids.claim}/receipt`,
      "GET",
      "manager",
    );
    expect(receipt.headers.get("content-type")).toBe("image/png");
    expect(receipt.headers.get("content-disposition")).toContain("attachment");
  });
});

describe("Statutory payroll", () => {
  let runId = "",
    staffItem = "";
  it("computes PF, ESI, PT, TDS, unpaid leave and reimbursements", async () => {
    expect((await call("payroll/runs", "GET", "staff")).status).toBe(403);
    const cfg = data<{ config: Record<string, unknown> }>(
      await call("payroll/statutory"),
    ).config;
    expect(
      (
        await call("payroll/statutory", "PUT", "admin", {
          ...cfg,
          ptEnabled: true,
          ptState: "West Bengal",
          ptSlabs: ptTemplates["West Bengal"],
        })
      ).status,
    ).toBe(200);
    const base = {
      pfApplicable: true,
      esiApplicable: true,
      ptApplicable: true,
      taxRegime: "NEW",
      effectiveFrom: "2026-04-01",
    };
    expect(
      (
        await call(`payroll/structures/${ids.staff}`, "PUT", "admin", {
          ...base,
          basic: 20000,
          hra: 8000,
          specialAllowance: 7000,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`payroll/structures/${ids.manager}`, "PUT", "admin", {
          ...base,
          basic: 10000,
          hra: 4000,
          specialAllowance: 4000,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`payroll/structures/${ids.staff}`, "PUT", "other", {
          ...base,
          basic: 1,
        })
      ).status,
    ).toBe(404);
    await db.employee.update({
      where: { id: ids.staff },
      data: {
        sensitiveEncrypted: encrypt({
          uan: "100200300400",
          pan: "ABCDE1234F",
          esiNumber: "",
        }),
      },
    });
    const unpaid = await db.leaveType.create({
      data: {
        companyId: companies[0],
        name: "Unpaid",
        annualDays: 30,
        paid: false,
      },
    });
    await db.leaveRequest.create({
      data: {
        companyId: companies[0],
        employeeId: ids.staff,
        leaveTypeId: unpaid.id,
        startDate: new Date("2026-06-10"),
        endDate: new Date("2026-06-11"),
        days: 2,
        reason: "Personal",
        status: "Approved",
      },
    });
    const run = await call("payroll/runs", "POST", "admin", {
      period: "2026-06",
    });
    expect(run.status).toBe(200);
    runId = data<{ id: string }>(run).id;
    expect(
      (await call("payroll/runs", "POST", "admin", { period: "2026-06" }))
        .status,
    ).toBe(409);
    type Item = Record<string, number> & { id: string; employeeId: string };
    const detail = data<{ items: Item[] }>(await call(`payroll/runs/${runId}`));
    const staff = detail.items.find((i) => i.employeeId === ids.staff)!;
    const mgr = detail.items.find((i) => i.employeeId === ids.manager)!;
    staffItem = staff.id;
    expect(staff.lopDays).toBe(2);
    expect(staff.gross).toBe(32667);
    expect(staff.pfEmployee).toBe(1800);
    expect(staff.pfEmployerEps).toBe(1250);
    expect(staff.esiEmployee).toBe(0);
    expect(staff.pt).toBe(150);
    expect(staff.tds).toBe(0);
    expect(staff.reimbursements).toBe(1500);
    expect(staff.netPay).toBe(32217);
    expect(mgr.gross).toBe(18000);
    expect(mgr.esiEmployee).toBe(135);
    expect(mgr.esiEmployer).toBe(585);
    expect((await call(`payroll/runs/${runId}`, "GET", "other")).status).toBe(
      404,
    );
  });
  it("allows audited draft adjustments, then locks on processing", async () => {
    const adjusted = await call(
      `payroll/runs/${runId}/items/${staffItem}`,
      "PUT",
      "admin",
      {
        lopDays: 2,
        otherDeductions: 500,
        reason: "Canteen recovery",
      },
    );
    expect(data<{ netPay: number }>(adjusted).netPay).toBe(31717);
    // Draft -> submitted -> approved by someone else -> processed.
    expect(
      (await call(`payroll/runs/${runId}/process`, "POST", "admin")).status,
    ).toBe(409);
    const submitted = await call(
      `payroll/runs/${runId}/submit`,
      "POST",
      "admin",
    );
    expect(data<{ status: string }>(submitted).status).toBe("SUBMITTED");
    expect(
      (
        await call(`payroll/runs/${runId}/items/${staffItem}`, "PUT", "admin", {
          bonus: 100,
          reason: "Too late",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(`payroll/runs/${runId}/approve`, "POST", "admin", {})).status,
    ).toBe(403);
    expect(
      (await call(`payroll/runs/${runId}/approve`, "POST", "staff", {})).status,
    ).toBe(403);
    const approved = await call(
      `payroll/runs/${runId}/approve`,
      "POST",
      "finance",
      {},
    );
    expect(data<{ status: string }>(approved).status).toBe("APPROVED");
    const processed = await call(
      `payroll/runs/${runId}/process`,
      "POST",
      "admin",
    );
    expect(data<{ status: string }>(processed).status).toBe("PROCESSED");
    expect(
      (await call(`payroll/runs/${runId}/process`, "POST", "admin")).status,
    ).toBe(409);
    expect(
      (await call(`payroll/runs/${runId}/recalculate`, "POST", "admin")).status,
    ).toBe(409);
    expect(
      (await call(`payroll/runs/${runId}`, "DELETE", "admin")).status,
    ).toBe(409);
    const slip = await db.payslip.findFirstOrThrow({
      where: { employeeId: ids.staff },
    });
    expect(slip.netPay).toBe(31717);
    expect(
      (slip.breakdown as { deductions: { pf: number } }).deductions.pf,
    ).toBe(1800);
    expect(
      (await db.expenseClaim.findUniqueOrThrow({ where: { id: ids.claim } }))
        .status,
    ).toBe("REIMBURSED");
  });
  it("produces statutory files and a balanced accounting journal", async () => {
    const ecr = await call(`payroll/runs/${runId}/reports/pf-ecr`);
    expect(ecr.body).toContain(
      "100200300400#~#STAFF TESTER#~#32667#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0",
    );
    const esi = await call(`payroll/runs/${runId}/reports/esi`);
    expect(esi.body).toContain('"manager Tester"');
    expect(esi.body).not.toContain("staff Tester");
    const tds = await call(`payroll/runs/${runId}/reports/tds`);
    expect(tds.body).toContain("ABCDE1234F");
    const journal = await call(
      "integrations/accounting-export?from=2026-06-01&to=2026-06-30&format=json",
    );
    const entry = journal.body.entries[0];
    expect(entry.balanced).toBe(true);
    const accounts = entry.lines.map((l: { account: string }) => l.account);
    expect(accounts).toEqual(
      expect.arrayContaining([
        "PF Payable",
        "ESI Payable",
        "Professional Tax Payable",
        "Employee Reimbursements",
      ]),
    );
  });
});

describe("Recruitment", () => {
  it("runs a candidate from application to an explicit hire", async () => {
    expect((await call("recruitment/jobs", "GET", "staff")).status).toBe(403);
    const job = await call("recruitment/jobs", "POST", "admin", {
      title: "Sales Executive",
      employmentType: "Full time",
      openings: 2,
      description: "Grow regional accounts.",
      status: "OPEN",
    });
    ids.job = data<{ id: string }>(job).id;
    const candidate = {
      jobId: ids.job,
      name: "Asha Rao",
      email: "asha@example.com",
      resume: { name: "cv.pdf", type: "application/pdf", base64: pdf },
    };
    const created = await call(
      "recruitment/candidates",
      "POST",
      "admin",
      candidate,
    );
    expect(created.status).toBe(200);
    ids.candidate = data<{ id: string }>(created).id;
    expect(
      (await call("recruitment/candidates", "POST", "admin", candidate)).status,
    ).toBe(409);
    expect(
      (
        await call("recruitment/candidates", "POST", "admin", {
          ...candidate,
          email: "x@example.com",
          resume: {
            name: "cv.png",
            type: "image/png",
            base64: png.split(",")[1],
          },
        })
      ).status,
    ).toBe(422);
    const interview = await call(
      `recruitment/candidates/${ids.candidate}/interviews`,
      "POST",
      "admin",
      {
        interviewerUserId: ids.managerUser,
        scheduledAt: "2026-07-01T10:00:00Z",
        mode: "VIDEO",
      },
    );
    expect(interview.status).toBe(200);
    const mine = data<{ id: string }[]>(
      await call("recruitment/interviews", "GET", "manager"),
    );
    expect(mine).toHaveLength(1);
    const feedback = {
      status: "COMPLETED",
      rating: 4,
      recommendation: "YES",
      feedback: "Strong discovery questions.",
    };
    expect(
      (
        await call(
          `recruitment/interviews/${mine[0].id}`,
          "PUT",
          "admin",
          feedback,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `recruitment/interviews/${mine[0].id}`,
          "PUT",
          "manager",
          feedback,
        )
      ).status,
    ).toBe(200);
    const hire = { employeeCode: "SAL-001", joinedAt: "2026-07-15" };
    expect(
      (
        await call(
          `recruitment/candidates/${ids.candidate}/hire`,
          "POST",
          "admin",
          hire,
        )
      ).status,
    ).toBe(409);
    await call(
      `recruitment/candidates/${ids.candidate}/stage`,
      "POST",
      "admin",
      { stage: "OFFER" },
    );
    const hired = await call(
      `recruitment/candidates/${ids.candidate}/hire`,
      "POST",
      "admin",
      hire,
    );
    expect(hired.status).toBe(200);
    const employee = await db.employee.findUniqueOrThrow({
      where: { id: data<{ employeeId: string }>(hired).employeeId },
    });
    expect(employee.status).toBe("Probation");
    expect(employee.officialEmail).toBe("asha@example.com");
    const detail = data<{ stage: string; events: unknown[] }>(
      await call(`recruitment/candidates/${ids.candidate}`),
    );
    expect(detail.stage).toBe("HIRED");
    expect(detail.events).toHaveLength(4);
    expect(
      (
        await call(
          `recruitment/candidates/${ids.candidate}/stage`,
          "POST",
          "admin",
          { stage: "REJECTED" },
        )
      ).status,
    ).toBe(409);
    expect(
      (await call(`recruitment/candidates/${ids.candidate}`, "GET", "other"))
        .status,
    ).toBe(404);
    const resume = await call(`recruitment/candidates/${ids.candidate}/resume`);
    expect(resume.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("Performance management", () => {
  it("approves goals and completes self and manager reviews in order", async () => {
    const cycle = await call("performance/cycles", "POST", "admin", {
      name: "H1 2026",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
      selfReview: true,
    });
    ids.cycle = data<{ id: string }>(cycle).id;
    expect(
      (await call(`performance/cycles/${ids.cycle}/launch`, "POST", "manager"))
        .status,
    ).toBe(403);
    expect(
      (await call(`performance/cycles/${ids.cycle}/launch`, "POST", "admin"))
        .status,
    ).toBe(200);
    const goal = await call("performance/goals", "POST", "staff", {
      cycleId: ids.cycle,
      type: "KPI",
      title: "Monthly sales target",
      metric: "Monthly achieved revenue",
      target: "1000000",
      unit: "INR",
      weight: 40,
      source: "AI",
    });
    const g = data<{ id: string; status: string }>(goal);
    expect(g.status).toBe("DRAFT");
    await call(`performance/goals/${g.id}/status`, "POST", "staff", {
      status: "PENDING_APPROVAL",
    });
    expect(
      (
        await call(`performance/goals/${g.id}/status`, "POST", "staff", {
          status: "APPROVED",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`performance/goals/${g.id}/status`, "POST", "manager", {
          status: "APPROVED",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`performance/goals/${g.id}/progress`, "PUT", "staff", {
          progress: 60,
          actual: "600000",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `performance/goals?employeeId=${ids.admin}`,
          "GET",
          "manager",
        )
      ).status,
    ).toBe(404);

    const reviews = data<{ id: string; employeeId: string }[]>(
      await call(`performance/reviews?cycleId=${ids.cycle}`, "GET", "staff"),
    );
    const review = reviews[0].id;
    expect(
      (
        await call(`performance/reviews/${review}/manager`, "PUT", "manager", {
          managerRating: 4,
          managerComments: "Good",
        })
      ).status,
    ).toBe(409);
    await call(`performance/reviews/${review}/self`, "PUT", "staff", {
      selfRating: 4,
      selfComments: "Hit most targets.",
    });
    expect(
      (
        await call(`performance/reviews/${review}/manager`, "PUT", "staff", {
          managerRating: 5,
          managerComments: "Self",
        })
      ).status,
    ).toBe(403);
    await call(`performance/reviews/${review}/manager`, "PUT", "manager", {
      managerRating: 4,
      managerComments: "Consistent delivery.",
      developmentPlan: "Negotiation course",
    });
    const done = data<{ status: string; managerRating: number }>(
      await call(`performance/reviews/${review}`, "GET", "staff"),
    );
    expect(done.status).toBe("COMPLETED");
    expect(done.managerRating).toBe(4);
    expect(
      (await call(`performance/reviews/${review}/acknowledge`, "POST", "staff"))
        .status,
    ).toBe(200);
    const adminReview = data<{ id: string }[]>(
      await call(
        `performance/reviews?scope=company&employeeId=${ids.admin}`,
        "GET",
        "admin",
      ),
    )[0];
    expect(
      (await call(`performance/reviews/${adminReview.id}`, "GET", "manager"))
        .status,
    ).toBe(404);
  });
  it("keeps private notes to managers while allowing visible praise", async () => {
    expect(
      (
        await call("performance/feedback", "POST", "staff", {
          employeeId: ids.manager,
          kind: "NOTE",
          text: "Private",
          visibleToEmployee: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("performance/feedback", "POST", "staff", {
          employeeId: ids.manager,
          kind: "PRAISE",
          text: "Great mentoring",
        })
      ).status,
    ).toBe(200);
    await call("performance/feedback", "POST", "manager", {
      employeeId: ids.staff,
      kind: "NOTE",
      text: "Watch deadlines",
      visibleToEmployee: false,
    });
    const own = data<{ text: string }[]>(
      await call("performance/feedback", "GET", "staff"),
    );
    expect(own.map((f) => f.text)).not.toContain("Watch deadlines");
  });
});

describe("Custom reports", () => {
  it("builds permitted, tenant-scoped reports from allow-listed fields", async () => {
    expect((await call("reports/datasets", "GET", "staff")).status).toBe(403);
    const sets = data<{ key: string }[]>(await call("reports/datasets"));
    expect(sets.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        "employees",
        "payroll",
        "expenses",
        "candidates",
        "goals",
      ]),
    );
    const grouped = await call("reports/run", "POST", "admin", {
      dataset: "payroll",
      config: {
        columns: ["employeeCode"],
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        groupBy: "period",
        aggregates: [
          { field: "netPay", fn: "sum" },
          { field: "tds", fn: "count" },
        ],
      },
    });
    expect(data<{ rows: Record<string, number>[] }>(grouped).rows).toEqual([
      {
        period: "2026-06",
        sum_netPay: 31717 + (18000 - 1200 - 135 - 130),
        count_tds: 2,
      },
    ]);
    const filtered = await call("reports/run", "POST", "admin", {
      dataset: "employees",
      config: {
        columns: ["employeeCode", "status"],
        filters: [{ field: "status", op: "eq", value: "Probation" }],
      },
    });
    expect(data<{ rows: unknown[] }>(filtered).rows).toEqual([
      { employeeCode: "SAL-001", status: "Probation" },
    ]);
    expect(
      (
        await call("reports/run", "POST", "admin", {
          dataset: "employees",
          config: { columns: ["sensitiveEncrypted"] },
        })
      ).status,
    ).toBe(422);
    const saved = await call("reports/definitions", "POST", "admin", {
      name: "Headcount by department",
      dataset: "employees",
      config: { columns: ["employeeCode"], groupBy: "department" },
      shared: true,
    });
    const id = data<{ id: string }>(saved).id;
    const csv = await call(`reports/definitions/${id}/run?format=csv`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.body).toContain("Count");
    expect(
      data<unknown[]>(await call("reports/definitions", "GET", "other")),
    ).toHaveLength(0);
    expect(
      (await call(`reports/definitions/${id}/run`, "GET", "other")).status,
    ).toBe(404);
  });
});
