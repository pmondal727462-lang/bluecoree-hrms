import { NextRequest } from "next/server";
import { db, jobScope } from "@/lib/db";
import { encrypt, decrypt, digest } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import type { PermissionKey } from "@/config/permissions";
import {
  aiProvider,
  providerConfigured,
  providerIsLocal,
  unavailable,
} from "./provider";
import {
  draftSchema,
  editSchema,
  querySchema,
  settingsSchema,
  redactText,
  redactContext,
  type DraftInput,
} from "./contracts";
import { executeQuery, localPlan } from "./queries";

const kindPermission: Record<DraftInput["kind"], PermissionKey> = {
  job_description: "ai.recruitment",
  interview_questions: "ai.recruitment",
  interview_summary: "ai.recruitment",
  performance: "ai.performance",
  letter: "ai.documents",
  report_summary: "ai.reports",
  candidate_summary: "ai.recruitment",
  candidate_message: "ai.recruitment",
  review_draft: "ai.performance",
};
// Drafts about a candidate or a review the user may act on.
async function authorizeSubject(ctx: Context, input: DraftInput) {
  if (input.candidateId) {
    if (!input.kind.startsWith("candidate_"))
      throw new AppError(422, "This draft does not accept a candidate.");
    requirePermission(ctx, "recruitment.manage");
    const c = await db.candidate.findFirst({
      where: { id: input.candidateId, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!c) throw new AppError(404, "Candidate not found.");
  }
  if (input.reviewId) {
    if (input.kind !== "review_draft")
      throw new AppError(422, "This draft does not accept a review.");
    const self = await db.employee.findFirst({
      where: { companyId: ctx.companyId, userId: ctx.userId },
      select: { id: true },
    });
    const review = await db.performanceReview.findFirst({
      where: {
        id: input.reviewId,
        companyId: ctx.companyId,
        // HR may draft for anyone; a manager only for reviews they write.
        ...(ctx.permissions.includes("performance.manage")
          ? {}
          : { reviewerEmployeeId: self?.id ?? "unlinked" }),
      },
      select: { id: true, employeeId: true },
    });
    if (!review || review.employeeId === self?.id)
      throw new AppError(404, "Review not found.");
  }
}
const settings = async (companyId: string) =>
  (await db.aiSettings.findUnique({ where: { companyId } })) ?? {
    companyId,
    enabled: false,
    allowExternalProcessing: false,
    retentionDays: 30,
  };
async function purgeExpiredAIJob(companyId?: string) {
  const where = {
    ...(companyId ? { companyId } : {}),
    expiresAt: { lte: new Date() },
  };
  await db.$transaction([
    db.aiConversation.deleteMany({ where }),
    db.aiAccessLog.deleteMany({ where }),
    db.aiGeneratedDocument.deleteMany({ where }),
  ]);
}
async function fingerprint(ctx: Context) {
  const employee = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: {
      id: true,
      reports: { where: { companyId: ctx.companyId }, select: { id: true } },
    },
  });
  return digest(
    JSON.stringify({
      permissions: [...ctx.permissions].sort(),
      employeeId: employee?.id,
      reports: employee?.reports.map((r) => r.id).sort(),
    }),
  );
}
async function requireProvider(ctx: Context) {
  const config = await settings(ctx.companyId);
  if (!config.enabled || !providerConfigured()) throw unavailable();
  if (!providerIsLocal() && !config.allowExternalProcessing)
    throw new AppError(
      403,
      "External AI processing is disabled by your company.",
      "AI_PROCESSING_DISABLED",
    );
  return aiProvider();
}
async function logStart(ctx: Context, query: string, intent: string) {
  const config = await settings(ctx.companyId);
  return db.aiAccessLog.create({
    data: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      query: encrypt({ text: query }),
      intent,
      dataSources: [],
      responseSummary: "Request started",
      status: "STARTED",
      expiresAt: new Date(Date.now() + config.retentionDays * 86400000),
    },
  });
}
async function logged<T>(
  ctx: Context,
  query: string,
  intent: string,
  work: (logId: string) => Promise<T>,
): Promise<T> {
  const entry = await logStart(ctx, query, intent);
  try {
    const result = await work(entry.id);
    await db.aiAccessLog.update({
      where: { id: entry.id },
      data: {
        status: "SUCCESS",
        responseSummary:
          "Completed; content accessible only through permission-checked records.",
      },
    });
    return result;
  } catch (error) {
    await db.aiAccessLog.update({
      where: { id: entry.id },
      data: {
        status:
          error instanceof AppError && error.status === 403
            ? "DENIED"
            : "FAILED",
        responseSummary:
          error instanceof AppError ? error.code : "INVALID_REQUEST",
      },
    });
    throw error;
  }
}
async function authorizeDraft(ctx: Context, input: DraftInput) {
  requirePermission(ctx, kindPermission[input.kind]);
  await authorizeSubject(ctx, input);
  if (input.employeeId) {
    if (input.kind !== "letter" && input.kind !== "performance")
      throw new AppError(
        422,
        "This draft does not accept employee information.",
      );
    if (input.kind === "letter") requirePermission(ctx, "employees.read");
    const self = await db.employee.findFirst({
      where: { companyId: ctx.companyId, userId: ctx.userId },
      select: { id: true },
    });
    const employee = await db.employee.findFirst({
      where: {
        id: input.employeeId,
        companyId: ctx.companyId,
        ...(!ctx.permissions.includes("employees.read")
          ? { managerId: self?.id ?? "unlinked" }
          : {}),
      },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, "Employee not found.");
  }
  if (input.kind === "report_summary") {
    if (
      ![
        "attendance_summary",
        "headcount",
        "departments",
        "repeated_late",
      ].includes(input.report!.intent)
    )
      throw new AppError(422, "Select a supported aggregate report.");
    await executeQuery(ctx, input.report!);
  }
}
async function generate(ctx: Context, req: NextRequest) {
  const raw = await json(req);
  return logged(ctx, "Draft generation", "draft", async (logId) => {
    const input = draftSchema.parse(raw);
    await authorizeDraft(ctx, input);
    const provider = await requireProvider(ctx);
    // Employee identities are substituted locally after generation.
    const context: Record<string, unknown> = {
      ...input,
      employeeId: undefined,
      jobDocumentId: undefined,
      report: undefined,
      candidateId: undefined,
      reviewId: undefined,
    };
    let substitutions: Record<string, string> = {};
    const sources = ["user_reviewed_brief"];
    if (input.employeeId) {
      const employee = await db.employee.findFirstOrThrow({
        where: { id: input.employeeId, companyId: ctx.companyId },
        select: {
          firstName: true,
          lastName: true,
          employeeCode: true,
          joinedAt: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
        },
      });
      const company = await db.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { name: true },
      });
      substitutions = {
        "{{employeeName}}": `${employee.firstName} ${employee.lastName}`,
        "{{companyName}}": company.name,
        "{{employeeCode}}": employee.employeeCode,
      };
      context.employee = {
        name: "{{employeeName}}",
        code: "{{employeeCode}}",
        company: "{{companyName}}",
        joinedAt: employee.joinedAt.toISOString().slice(0, 10),
        designation: employee.designation?.name,
        department: employee.department?.name,
      };
      sources.push("employees", "company");
    }
    if (input.candidateId) {
      // Names and contact details stay local; the provider sees placeholders.
      const c = await db.candidate.findFirstOrThrow({
        where: { id: input.candidateId, companyId: ctx.companyId },
        select: {
          name: true,
          stage: true,
          experienceYears: true,
          currentCompany: true,
          source: true,
          job: { select: { title: true } },
          interviews: {
            where: { status: "COMPLETED" },
            select: { rating: true, recommendation: true, feedback: true },
          },
        },
      });
      const company = await db.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { name: true },
      });
      substitutions = {
        ...substitutions,
        "{{candidateName}}": c.name,
        "{{companyName}}": company.name,
      };
      context.candidate = {
        name: "{{candidateName}}",
        company: "{{companyName}}",
        job: c.job.title,
        stage: c.stage,
        experienceYears: c.experienceYears,
        currentEmployer: c.currentCompany,
        source: c.source,
        interviewFeedback: c.interviews.map((i, n) => ({
          interviewer: `Interviewer ${n + 1}`,
          rating: i.rating,
          recommendation: i.recommendation,
          notes: i.feedback,
        })),
      };
      sources.push("candidates", "interviews");
    }
    if (input.reviewId) {
      const r = await db.performanceReview.findFirstOrThrow({
        where: { id: input.reviewId, companyId: ctx.companyId },
        select: {
          employeeId: true,
          selfRating: true,
          selfComments: true,
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { name: true, ratingScale: true } },
          peerReviews: {
            where: { status: "SUBMITTED" },
            select: { rating: true, comments: true },
          },
          cycleId: true,
        },
      });
      const goals = await db.goal.findMany({
        where: {
          companyId: ctx.companyId,
          employeeId: r.employeeId,
          OR: [{ cycleId: r.cycleId }, { cycleId: null }],
          status: { in: ["APPROVED", "COMPLETED"] },
        },
        select: {
          type: true,
          title: true,
          target: true,
          actual: true,
          progress: true,
          status: true,
        },
        take: 50,
      });
      substitutions = {
        ...substitutions,
        "{{employeeName}}": `${r.employee.firstName} ${r.employee.lastName}`,
      };
      context.review = {
        employee: "{{employeeName}}",
        cycle: r.cycle.name,
        ratingScale: r.cycle.ratingScale,
        selfRating: r.selfRating,
        selfAssessment: r.selfComments,
        goals,
        peerFeedback: r.peerReviews.map((p) => ({
          rating: p.rating,
          comments: p.comments,
        })),
      };
      sources.push("performance_reviews", "goals", "peer_reviews");
    }
    if (input.jobDocumentId) {
      const job = await db.aiGeneratedDocument.findFirst({
        where: {
          id: input.jobDocumentId,
          companyId: ctx.companyId,
          kind: "job_description",
          expiresAt: { gt: new Date() },
        },
      });
      if (!job) throw new AppError(404, "Job description not found.");
      context.jobDescription = decrypt(job.contentEncrypted).text;
      sources.push("ai_generated_documents");
    }
    if (input.report) {
      const report = await executeQuery(ctx, input.report);
      // Reports sent to providers contain aggregates only; repeated-late identities are removed.
      context.report = {
        ...report,
        rows:
          input.report.intent === "repeated_late"
            ? report.rows.map((r, i) => [`Employee ${i + 1}`, r[1]])
            : report.rows,
      };
      sources.push(...report.sources);
    }
    await db.aiAccessLog.update({
      where: { id: logId },
      data: {
        intent: input.kind,
        dataSources: sources,
        responseSummary:
          "Sending minimized drafting context to configured provider",
      },
    });
    const sanitized = redactContext(context);
    let content =
      input.kind === "job_description"
        ? await provider.generateJobDescription(sanitized)
        : input.kind === "interview_questions"
          ? await provider.generateInterviewQuestions(sanitized)
          : input.kind === "performance"
            ? await provider.generatePerformanceGoals(sanitized)
            : input.kind === "report_summary"
              ? await provider.summarizeReport(sanitized)
              : await provider.generateText(
                  input.kind === "letter"
                    ? `Draft a ${input.letterType}; keep placeholder names exactly as supplied.`
                    : input.kind === "candidate_summary"
                      ? "Summarize the candidate's recorded experience and the interviewers' feedback for the hiring team. Attribute opinions to the interviewer who gave them. Do not recommend hiring or rejection, and do not infer personal or protected characteristics."
                      : input.kind === "candidate_message"
                        ? `Draft a short, courteous email to the candidate: ${input.messageType}. Use the placeholders {{candidateName}} and {{companyName}} exactly. Do not state decisions or dates that are not in the brief.`
                        : input.kind === "review_draft"
                          ? "Draft manager review comments, strengths, areas to improve and a development plan from the recorded goals, self assessment and peer feedback. Do not assign a rating; the manager decides. Keep the placeholder {{employeeName}} exactly."
                          : "Summarize the interviewer-entered question, answer, rating and comments. Attribute statements to the interviewer. Do not recommend hiring or rejection or infer candidate traits.",
                  sanitized,
                );
    for (const [placeholder, value] of Object.entries(substitutions))
      content = content.replaceAll(placeholder, value);
    const config = await settings(ctx.companyId);
    const doc = await db.aiGeneratedDocument.create({
      data: {
        companyId: ctx.companyId,
        userId: ctx.userId,
        kind: input.kind,
        title: input.title,
        contentEncrypted: encrypt({ text: content }),
        inputEncrypted: encrypt({ text: JSON.stringify(input) }),
        expiresAt: new Date(Date.now() + config.retentionDays * 86400000),
      },
    });
    await audit(
      db,
      ctx,
      "AI_DRAFT",
      "ai",
      doc.id,
      undefined,
      { kind: input.kind },
      ip(req),
    );
    return {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      content,
      status: doc.status,
      revision: doc.revision,
    };
  });
}
export async function aiRoute(req: NextRequest, ctx: Context, path: string[]) {
  requirePermission(ctx, "ai.use");
  await purgeExpiredAI(ctx.companyId);
  const resource = path[1],
    id = path[2];
  if (path.length > 3) throw new AppError(404, "Endpoint not found.");
  if (resource === "settings" && !id) {
    if (req.method === "GET")
      return {
        ...(await settings(ctx.companyId)),
        providerConfigured: providerConfigured(),
        localProvider: providerIsLocal(),
      };
    if (req.method === "PUT") {
      requirePermission(ctx, "ai.configure");
      const data = settingsSchema.parse(await json(req));
      return db.$transaction(async (tx) => {
        const config = await tx.aiSettings.upsert({
          where: { companyId: ctx.companyId },
          create: { companyId: ctx.companyId, ...data },
          update: data,
        });
        // Shorter retention applies to existing content too.
        const ceiling = new Date(Date.now() + data.retentionDays * 86400000);
        const where = { companyId: ctx.companyId, expiresAt: { gt: ceiling } };
        await tx.aiConversation.updateMany({
          where,
          data: { expiresAt: ceiling },
        });
        await tx.aiAccessLog.updateMany({
          where,
          data: { expiresAt: ceiling },
        });
        await tx.aiGeneratedDocument.updateMany({
          where,
          data: { expiresAt: ceiling },
        });
        await audit(
          tx,
          ctx,
          "AI_SETTINGS",
          "ai",
          ctx.companyId,
          undefined,
          data,
          ip(req),
        );
        return config;
      });
    }
  }
  if (resource === "query" && req.method === "POST" && !id) {
    await rateLimit(`ai:${ctx.companyId}:${ctx.userId}`, 30);
    const { question } = querySchema.parse(await json(req));
    return logged(ctx, question, "pending", async (logId) => {
      const accessFingerprint = await fingerprint(ctx);
      let plan = localPlan(question);
      if (!plan) {
        const provider = await requireProvider(ctx);
        await db.aiAccessLog.update({
          where: { id: logId },
          data: { dataSources: ["redacted_question"] },
        });
        plan = await provider.answerHRQuery(redactText(question));
      }
      // Unqualified manager questions default to direct reports, never the entire company.
      if (
        plan.scope === "company" &&
        !/company|all employees|organization/i.test(question) &&
        !ctx.permissions.includes("attendance.read") &&
        ctx.permissions.includes("attendance.team.read")
      )
        plan = { ...plan, scope: "team" };
      await db.aiAccessLog.update({
        where: { id: logId },
        data: { intent: plan.intent },
      });
      const result = await executeQuery(ctx, plan);
      if (accessFingerprint !== (await fingerprint(ctx)))
        throw new AppError(
          409,
          "Your team assignment changed. Please ask again.",
        );
      await db.aiAccessLog.update({
        where: { id: logId },
        data: { dataSources: result.sources },
      });
      const config = await settings(ctx.companyId);
      const conversation = await db.aiConversation.create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.userId,
          accessFingerprint,
          expiresAt: new Date(Date.now() + config.retentionDays * 86400000),
          messages: {
            create: [
              { role: "user", contentEncrypted: encrypt({ text: question }) },
              {
                role: "assistant",
                contentEncrypted: encrypt({ text: JSON.stringify(result) }),
              },
            ],
          },
        },
      });
      return { ...result, conversationId: conversation.id };
    });
  }
  if (resource === "conversations" && req.method === "GET") {
    const where = {
      companyId: ctx.companyId,
      userId: ctx.userId,
      accessFingerprint: await fingerprint(ctx),
      expiresAt: { gt: new Date() },
      ...(id ? { id } : {}),
    };
    const records = await db.aiConversation.findMany({
      where,
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: id ? 1 : 20,
    });
    if (id && !records.length)
      throw new AppError(
        404,
        "Conversation is unavailable under your current access.",
      );
    return records.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      messages: r.messages.map((m) => ({
        role: m.role,
        content: decrypt(m.contentEncrypted).text,
      })),
    }));
  }
  if (resource === "conversations" && id && req.method === "DELETE") {
    const result = await db.aiConversation.deleteMany({
      where: { id, companyId: ctx.companyId, userId: ctx.userId },
    });
    if (!result.count) throw new AppError(404, "Conversation not found.");
    return { deleted: true };
  }
  if (resource === "generate" && req.method === "POST" && !id) {
    await rateLimit(`ai-generation:${ctx.companyId}:${ctx.userId}`, 10);
    return generate(ctx, req);
  }
  if (resource === "employees" && req.method === "GET" && !id) {
    if (
      !ctx.permissions.includes("ai.documents") &&
      !ctx.permissions.includes("ai.performance")
    )
      throw new AppError(403, "Drafting permission required.");
    const own = await db.employee.findFirst({
      where: { companyId: ctx.companyId, userId: ctx.userId },
      select: { id: true },
    });
    return db.employee.findMany({
      where: {
        companyId: ctx.companyId,
        ...(!ctx.permissions.includes("employees.read")
          ? { managerId: own?.id ?? "unlinked" }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: { employeeCode: "asc" },
      take: 200,
    });
  }
  if (resource === "documents") {
    if (req.method === "GET" && !id) {
      const kinds = Object.entries(kindPermission)
        .filter(([, permission]) => ctx.permissions.includes(permission))
        .map(([kind]) => kind);
      return db.aiGeneratedDocument.findMany({
        where: {
          companyId: ctx.companyId,
          kind: { in: kinds },
          expiresAt: { gt: new Date() },
          OR: [
            { userId: ctx.userId },
            {
              kind: {
                in: [
                  "job_description",
                  "interview_questions",
                  "interview_summary",
                ],
              },
            },
          ],
        },
        select: {
          id: true,
          kind: true,
          title: true,
          status: true,
          revision: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
    }
    if (id && ["GET", "PUT"].includes(req.method)) {
      const doc = await db.aiGeneratedDocument.findFirst({
        where: { id, companyId: ctx.companyId, expiresAt: { gt: new Date() } },
      });
      if (!doc) throw new AppError(404, "Draft not found.");
      const input = draftSchema.parse(
        JSON.parse(decrypt(doc.inputEncrypted).text),
      );
      await authorizeDraft(ctx, input);
      if (
        doc.userId !== ctx.userId &&
        !ctx.permissions.includes("ai.configure") &&
        ![
          "job_description",
          "interview_questions",
          "interview_summary",
        ].includes(doc.kind)
      )
        throw new AppError(403, "This draft belongs to another user.");
      if (req.method === "GET")
        return {
          id,
          kind: doc.kind,
          title: doc.title,
          content: decrypt(doc.contentEncrypted).text,
          status: doc.status,
          revision: doc.revision,
          input,
        };
      const edit = editSchema.parse(await json(req));
      if (
        edit.action === "publish" &&
        (doc.kind !== "job_description" ||
          doc.status !== "Approved" ||
          edit.content !== decrypt(doc.contentEncrypted).text ||
          edit.title !== doc.title)
      )
        throw new AppError(
          409,
          "Only an unchanged, approved job description can be published.",
        );
      const status =
        edit.action === "publish"
          ? "Published"
          : edit.action === "approve"
            ? "Approved"
            : "Draft";
      return db.$transaction(async (tx) => {
        const updated = await tx.aiGeneratedDocument.updateMany({
          where: { id, companyId: ctx.companyId, revision: edit.revision },
          data: {
            title: edit.title,
            contentEncrypted: encrypt({ text: edit.content }),
            status,
            revision: { increment: 1 },
            reviewedBy: edit.action === "save" ? null : ctx.userId,
            reviewedAt: edit.action === "save" ? null : new Date(),
          },
        });
        if (!updated.count)
          throw new AppError(409, "The draft changed. Reload before saving.");
        await audit(
          tx,
          ctx,
          `AI_${edit.action.toUpperCase()}`,
          "ai",
          id,
          { status: doc.status },
          { status, revision: edit.revision + 1 },
          ip(req),
        );
        return {
          id,
          kind: doc.kind,
          title: edit.title,
          content: edit.content,
          status,
          revision: edit.revision + 1,
        };
      });
    }
  }
  if (resource === "logs" && req.method === "GET" && !id) {
    requirePermission(ctx, "audit.read");
    return db.aiAccessLog.findMany({
      where: { companyId: ctx.companyId },
      select: {
        id: true,
        userId: true,
        intent: true,
        dataSources: true,
        timestamp: true,
        responseSummary: true,
        status: true,
      },
      orderBy: { timestamp: "desc" },
      take: 100,
    });
  }
  throw new AppError(404, "AI endpoint not found.");
}
export function purgeExpiredAI(companyId?: string) {
  return jobScope(() => purgeExpiredAIJob(companyId));
}
