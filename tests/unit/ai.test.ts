import { describe, expect, it } from "vitest";
import { localPlan } from "../../src/modules/ai/queries";
import { planSchema, redactContext, draftSchema } from "../../src/modules/ai/contracts";

describe("HR Copilot query contracts", () => {
  it("classifies self, direct report and repeated late questions", () => {
    expect(localPlan("What is my leave balance?")).toMatchObject({ intent: "leave_balance", scope: "own" });
    expect(localPlan("Show my team's attendance")).toMatchObject({ intent: "attendance", scope: "team" });
    expect(localPlan("Show employees who were late more than 3 times this month")).toMatchObject({ intent: "repeated_late", moreThan: 3, period: "month", scope: "company" });
  });
  it("does not silently reinterpret unsupported date ranges", () => {
    expect(localPlan("Show my attendance last month")).toBeNull();
    expect(localPlan("Show my attendance in January")).toBeNull();
  });
  it("rejects arbitrary SQL, company IDs, employee IDs and unknown plan keys", () => {
    expect(planSchema.safeParse({ intent: "attendance", sql: "SELECT * FROM users" }).success).toBe(false);
    expect(planSchema.safeParse({ intent: "attendance", companyId: "other" }).success).toBe(false);
    expect(planSchema.safeParse({ intent: "attendance", employeeId: "other" }).success).toBe(false);
    expect(planSchema.safeParse({ intent: "delete_employees" }).success).toBe(false);
  });
  it("redacts strings without corrupting aggregate numbers", () => {
    expect(redactContext({ email: "someone@example.com", phone: "9876543210", total: 10000000, nested: ["sk-secret-value"] })).toEqual({ email: "[email]", phone: "[number]", total: 10000000, nested: ["[secret]"] });
  });
  it("requires a job for interviews and employee/type for letters", () => {
    expect(draftSchema.safeParse({ kind: "interview_questions", title: "Questions" }).success).toBe(false);
    expect(draftSchema.safeParse({ kind: "letter", title: "Offer" }).success).toBe(false);
    expect(draftSchema.safeParse({ kind: "interview_summary", title: "Summary", jobDocumentId: "job", notes: [{ question: "Q", answer: "A", rating: 6, comments: "" }] }).success).toBe(false);
  });
});
