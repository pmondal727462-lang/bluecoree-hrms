import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 12: new Copilot questions (expiring documents, onboarding, training,
// assets, all approvals, balance engine) and new drafts (candidate summary,
// candidate message, review draft) with minimized provider context.
const f = new Fixture();
let a = "";
let lastBody = "";
let reply = "Draft for {{candidateName}} at {{companyName}}.";

beforeAll(async () => {
  vi.stubEnv("AI_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("AI_PROVIDER", "compatible");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      lastBody = String(init.body);
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: reply } }],
      });
    }),
  );
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("other", f.companies[1], "Company Admin");
  await db.aiSettings.create({
    data: { companyId: a, enabled: true, allowExternalProcessing: true },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const where = { companyId: { in: f.companies } };
  await db.aiConversation.deleteMany({ where });
  await db.aiAccessLog.deleteMany({ where });
  await db.aiGeneratedDocument.deleteMany({ where });
  await db.aiSettings.deleteMany({ where });
  await db.assetAssignment.deleteMany({ where });
  await db.asset.deleteMany({ where });
  await db.document.deleteMany({ where });
  await db.onboardingTask.deleteMany({ where });
  await db.onboarding.deleteMany({ where });
  await db.performanceReview.deleteMany({ where });
  await db.reviewCycle.deleteMany({ where });
  await db.interview.deleteMany({ where });
  await db.jobOpening.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});
const ask = (who: string, question: string) =>
  call(f, "ai/query", "POST", who, { question });

describe("Phase 12 HR Copilot", () => {
  it("answers expiring-document questions within each user's scope", async () => {
    const soon = new Date(Date.now() + 10 * 86400000);
    await db.document.createMany({
      data: [
        {
          companyId: a,
          employeeId: f.employees.staff,
          title: "Passport",
          category: "ID_PROOF",
          expiresOn: soon,
          uploadedBy: f.users.admin,
        },
        {
          companyId: a,
          employeeId: f.employees.manager,
          title: "Visa",
          category: "ID_PROOF",
          expiresOn: soon,
          uploadedBy: f.users.admin,
        },
      ],
    });
    const hr = await ask("admin", "Which documents are expiring?");
    expect(hr.body.data.rows.map((r: string[]) => r[0]).sort()).toEqual([
      "Passport",
      "Visa",
    ]);
    const own = await ask("staff", "Are my documents expiring?");
    expect(own.body.data.rows.map((r: string[]) => r[0])).toEqual(["Passport"]);
    expect(
      (await ask("other", "Which documents are expiring?")).body.data.rows,
    ).toHaveLength(0);
  });

  it("reports onboarding, training and assets with permission checks", async () => {
    const o = await db.onboarding.create({
      data: {
        companyId: a,
        name: "New Joiner",
        email: "joiner@example.com",
        employeeCode: "NJ1",
        joiningDate: new Date("2026-10-05"),
        createdBy: f.users.admin,
      },
    });
    await db.onboardingTask.createMany({
      data: [
        {
          companyId: a,
          onboardingId: o.id,
          title: "PAN",
          category: "DOCUMENT",
          assignee: "EMPLOYEE",
          required: true,
          status: "DONE",
        },
        {
          companyId: a,
          onboardingId: o.id,
          title: "Photo",
          category: "DOCUMENT",
          assignee: "EMPLOYEE",
          required: true,
        },
      ],
    });
    const onboarding = await ask("admin", "Show onboarding status");
    expect(onboarding.body.data.rows).toEqual([
      ["New Joiner", "2026-10-05", "1/2", 1],
    ]);
    expect((await ask("staff", "Show onboarding status")).status).toBe(403);

    const asset = await db.asset.create({
      data: {
        companyId: a,
        assetCode: "LT-9",
        category: "LAPTOP",
        name: "MacBook",
        status: "ASSIGNED",
        createdBy: f.users.admin,
      },
    });
    await db.assetAssignment.create({
      data: {
        companyId: a,
        assetId: asset.id,
        employeeId: f.employees.staff,
        issuedOn: new Date("2026-09-01"),
        issueCondition: "NEW",
        issuedBy: f.users.admin,
      },
    });
    const mine = await ask("staff", "Which assets do I have?");
    expect(mine.body.data.rows).toEqual([
      ["LT-9 · MacBook", "laptop", "2026-09-01"],
    ]);
    expect(
      (await ask("manager", "Which assets do I have?")).body.data.rows,
    ).toHaveLength(0);
    const training = await ask("staff", "Show my training");
    expect(training.status).toBe(200);
    expect(training.body.data.columns).toContain("Certificate valid until");
  });

  it("uses the balance engine and lists every approval waiting", async () => {
    const type = await db.leaveType.create({
      data: { companyId: a, name: "Casual", annualDays: 12 },
    });
    await db.leaveRequest.create({
      data: {
        companyId: a,
        employeeId: f.employees.staff,
        leaveTypeId: type.id,
        startDate: new Date("2026-12-01"),
        endDate: new Date("2026-12-02"),
        days: 2,
        reason: "Family",
        status: "Pending",
      },
    });
    await db.leaveLedger.create({
      data: {
        companyId: a,
        employeeId: f.employees.staff,
        leaveTypeId: type.id,
        year: new Date().getUTCFullYear(),
        kind: "ADJUSTMENT",
        days: 3,
      },
    });
    const balance = await ask("staff", "What is my leave balance?");
    // 12 entitled + 3 adjusted − 2 pending.
    expect(balance.body.data.rows[0]).toEqual(["Casual", 12, 0, 2, 13]);
    const cat = await db.expenseCategory.create({
      data: { companyId: a, name: "Travel" },
    });
    await db.expenseClaim.create({
      data: {
        companyId: a,
        employeeId: f.employees.staff,
        categoryId: cat.id,
        expenseDate: new Date("2026-09-01"),
        amount: 100,
        description: "Cab",
      },
    });
    const approvals = await ask("manager", "Show pending approvals");
    expect(approvals.body.data.answer).toContain("1 pending leave requests");
    expect(approvals.body.data.answer).toContain("1 expense claims");
    expect(approvals.body.data.answer).not.toContain("not installed");
  });
});

describe("Phase 12 AI drafts", () => {
  it("summarizes a candidate without sending contact details", async () => {
    const job = await db.jobOpening.create({
      data: {
        companyId: a,
        title: "Data analyst",
        description: "Analyse data",
        status: "OPEN",
        createdBy: f.users.admin,
      },
    });
    const c = await db.candidate.create({
      data: {
        companyId: a,
        jobId: job.id,
        name: "Priya Sharma",
        email: "priya.private@example.com",
        phone: "9812345678",
        experienceYears: 5,
        stage: "INTERVIEW",
      },
    });
    await db.interview.create({
      data: {
        companyId: a,
        candidateId: c.id,
        interviewerId: f.users.manager,
        interviewerName: "manager user",
        scheduledAt: new Date(),
        status: "COMPLETED",
        rating: 4,
        recommendation: "YES",
        feedback: "Strong SQL skills",
      },
    });
    const draft = await call(f, "ai/generate", "POST", "admin", {
      kind: "candidate_summary",
      title: "Summary",
      candidateId: c.id,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.data.content).toContain("Priya Sharma");
    expect(lastBody).toContain("Strong SQL skills");
    expect(lastBody).not.toContain("Priya");
    expect(lastBody).not.toContain("priya.private@example.com");
    expect(lastBody).not.toContain("9812345678");
    expect(lastBody).toContain("Do not recommend hiring or rejection");

    const message = await call(f, "ai/generate", "POST", "admin", {
      kind: "candidate_message",
      title: "Invite",
      candidateId: c.id,
      messageType: "Interview invitation",
    });
    expect(message.status).toBe(200);
    expect(lastBody).toContain("Interview invitation");
    expect(
      (
        await call(f, "ai/generate", "POST", "admin", {
          kind: "candidate_message",
          title: "No type",
          candidateId: c.id,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, "ai/generate", "POST", "other", {
          kind: "candidate_summary",
          title: "Cross tenant",
          candidateId: c.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(f, "ai/generate", "POST", "manager", {
          kind: "candidate_summary",
          title: "No access",
          candidateId: c.id,
        })
      ).status,
    ).toBe(403);
  });

  it("drafts a review only for the reviewing manager or HR, without a rating", async () => {
    reply = "Draft review for {{employeeName}}.";
    const cycle = await db.reviewCycle.create({
      data: {
        companyId: a,
        name: "H2",
        periodStart: new Date("2026-04-01"),
        periodEnd: new Date("2026-09-30"),
        status: "ACTIVE",
      },
    });
    const review = await db.performanceReview.create({
      data: {
        companyId: a,
        cycleId: cycle.id,
        employeeId: f.employees.staff,
        reviewerEmployeeId: f.employees.manager,
        status: "PENDING_MANAGER",
        selfRating: 4,
        selfComments: "Shipped the reporting module",
      },
    });
    const draft = await call(f, "ai/generate", "POST", "manager", {
      kind: "review_draft",
      title: "Review",
      reviewId: review.id,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.data.content).toBe("Draft review for staff Tester.");
    expect(lastBody).toContain("Shipped the reporting module");
    expect(lastBody).not.toContain("staff Tester");
    expect(lastBody).toContain("Do not assign a rating");
    // The employee cannot draft their own review.
    expect(
      (
        await call(f, "ai/generate", "POST", "staff", {
          kind: "review_draft",
          title: "Mine",
          reviewId: review.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(f, "ai/generate", "POST", "other", {
          kind: "review_draft",
          title: "Cross tenant",
          reviewId: review.id,
        })
      ).status,
    ).toBe(404);
  });
});
