import { z } from "zod";

export const intents = [
  "leave_balance",
  "check_in",
  "attendance",
  "holidays",
  "leave_policy",
  "apply_leave",
  "bank_details",
  "absent",
  "late",
  "on_leave",
  "approvals",
  "headcount",
  "departments",
  "repeated_late",
  "attendance_summary",
  "payslip_location",
  "payroll_summary",
  "recruitment_pipeline",
  "expiring_documents",
  "onboarding_status",
  "training_status",
  "my_assets",
  "unavailable",
  "help",
] as const;
export const planSchema = z
  .object({
    intent: z.enum(intents),
    scope: z.enum(["own", "team", "company"]).default("own"),
    period: z.enum(["today", "month"]).default("today"),
    moreThan: z.number().int().min(0).max(31).default(3),
  })
  .strict();
export type QueryPlan = z.infer<typeof planSchema>;
export type QueryResult = {
  answer: string;
  columns: string[];
  rows: (string | number)[][];
  sources: string[];
  scope: string;
  asOf: string;
  truncated?: boolean;
};
export const querySchema = z
  .object({ question: z.string().trim().min(3).max(1000) })
  .strict();
export const documentKinds = [
  "job_description",
  "interview_questions",
  "interview_summary",
  "performance",
  "letter",
  "report_summary",
  "candidate_summary",
  "candidate_message",
  "review_draft",
] as const;
export const messageKinds = [
  "Interview invitation",
  "Application update (not selected)",
  "Offer follow-up",
  "Joining instructions",
] as const;
export const letterKinds = [
  "Offer letter",
  "Appointment letter",
  "Experience certificate",
  "Relieving letter",
  "Warning letter",
  "Promotion letter",
  "Salary revision letter",
  "Transfer letter",
  "Confirmation letter",
  "Internship letter",
  "Joining letter",
] as const;
export const draftSchema = z
  .object({
    kind: z.enum(documentKinds),
    title: z.string().trim().min(2).max(150),
    brief: z.string().trim().max(6000).default(""),
    jobTitle: z.string().max(150).optional(),
    department: z.string().max(150).optional(),
    experience: z.string().max(150).optional(),
    location: z.string().max(150).optional(),
    employmentType: z.string().max(100).optional(),
    skills: z.string().max(1000).optional(),
    salaryRange: z.string().max(150).optional(),
    responsibilities: z.string().max(2000).optional(),
    jobDocumentId: z.string().max(100).optional(),
    employeeId: z.string().max(100).optional(),
    letterType: z.enum(letterKinds).optional(),
    candidateId: z.string().max(100).optional(),
    reviewId: z.string().max(100).optional(),
    messageType: z.enum(messageKinds).optional(),
    notes: z
      .array(
        z
          .object({
            question: z.string().min(1).max(500),
            answer: z.string().max(1000),
            rating: z.number().int().min(1).max(5),
            comments: z.string().max(1000),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    report: planSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind.startsWith("interview") && !v.jobDocumentId)
      ctx.addIssue({
        code: "custom",
        message: "Select a saved job description.",
        path: ["jobDocumentId"],
      });
    if (v.kind === "interview_summary" && !v.notes?.length)
      ctx.addIssue({
        code: "custom",
        message: "Record interviewer notes first.",
        path: ["notes"],
      });
    if (v.kind === "letter" && (!v.letterType || !v.employeeId))
      ctx.addIssue({
        code: "custom",
        message: "Select a letter type and employee.",
        path: ["employeeId"],
      });
    if (v.kind === "report_summary" && !v.report)
      ctx.addIssue({
        code: "custom",
        message: "Select a report.",
        path: ["report"],
      });
    if (v.kind.startsWith("candidate_") && !v.candidateId)
      ctx.addIssue({
        code: "custom",
        message: "Select a candidate.",
        path: ["candidateId"],
      });
    if (v.kind === "candidate_message" && !v.messageType)
      ctx.addIssue({
        code: "custom",
        message: "Select the kind of message.",
        path: ["messageType"],
      });
    if (v.kind === "review_draft" && !v.reviewId)
      ctx.addIssue({
        code: "custom",
        message: "Select a review.",
        path: ["reviewId"],
      });
    if (v.kind === "job_description" && !v.jobTitle?.trim())
      ctx.addIssue({
        code: "custom",
        message: "Enter a job title.",
        path: ["jobTitle"],
      });
  });
export type DraftInput = z.infer<typeof draftSchema>;
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    allowExternalProcessing: z.boolean(),
    retentionDays: z.number().int().min(1).max(365),
  })
  .strict();
export const editSchema = z
  .object({
    title: z.string().trim().min(2).max(150),
    content: z.string().trim().min(1).max(20000),
    revision: z.number().int().min(1),
    action: z.enum(["save", "approve", "publish"]).default("save"),
  })
  .strict();

export function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\d[ -]?){7,}\b/g, "[number]")
    .replace(/\b(?:sk-|Bearer\s+)[\w.-]+/gi, "[secret]");
}

export function redactContext(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactContext);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => [key, redactContext(v)]),
    );
  return value;
}
