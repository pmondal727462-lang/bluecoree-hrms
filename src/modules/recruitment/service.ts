import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt } from "@/lib/crypto";
import { validateUpload } from "@/lib/uploads";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage, enforceLimit } from "@/modules/saas/service";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { dayDate } from "@/modules/time/rules";
import { notify } from "@/modules/notifications/service";
import { careersSettings } from "./careers";
import { acceptedOffer, candidateOffers, offersRoute } from "./offers";

type Tx = Prisma.TransactionClient;
export const stages = [
  "APPLIED",
  "SCREENING",
  "SHORTLISTED",
  "INTERVIEW",
  "SELECTED",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;
const text = (max: number) => z.string().trim().max(max);
const jobSchema = z
  .object({
    title: text(150).min(2),
    departmentId: z.string().nullable().default(null),
    location: text(120).nullable().default(null),
    employmentType: z.enum(["Full time", "Part time", "Contract", "Intern"]),
    openings: z.number().int().min(1).max(500),
    description: text(20000).default(""),
    aiDocumentId: z.string().optional(),
    status: z.enum(["DRAFT", "OPEN", "ON_HOLD", "CLOSED"]),
    hiringManagerId: z.string().nullable().default(null),
    closesOn: z.iso.date().nullable().default(null),
  })
  .strict();
const file = z
  .object({
    name: z.string().min(1).max(200),
    type: z.string().max(100),
    base64: z.string().max(2_900_000),
  })
  .strict();
const candidateSchema = z
  .object({
    jobId: z.string().min(1),
    name: text(120).min(2),
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    phone: text(30).optional(),
    source: text(60).optional(),
    currentCompany: text(120).optional(),
    experienceYears: z.number().min(0).max(60).optional(),
    expectedSalary: z.number().min(0).max(1000000000).optional(),
    notes: text(2000).optional(),
    resume: file.optional(),
  })
  .strict();
const interviewSchema = z
  .object({
    interviewerUserId: z.string().min(1),
    scheduledAt: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    mode: z.enum(["IN_PERSON", "VIDEO", "PHONE"]),
    location: text(300).optional(),
  })
  .strict();
const feedbackSchema = z
  .object({
    status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
    rating: z.number().int().min(1).max(5).nullable().default(null),
    recommendation: z
      .enum(["STRONG_YES", "YES", "NO", "STRONG_NO"])
      .nullable()
      .default(null),
    feedback: text(5000).nullable().default(null),
  })
  .strict();
const candidateSelect = {
  id: true,
  jobId: true,
  name: true,
  email: true,
  phone: true,
  source: true,
  currentCompany: true,
  experienceYears: true,
  expectedSalary: true,
  stage: true,
  rating: true,
  notes: true,
  resumeName: true,
  resumeSize: true,
  hiredEmployeeId: true,
  createdAt: true,
  updatedAt: true,
  job: { select: { id: true, title: true } },
} as const;

async function findCandidate(
  ctx: Context,
  id: string,
  tx: Tx | typeof db = db,
) {
  const c = await tx.candidate.findFirst({
    where: { id, companyId: ctx.companyId },
    select: candidateSelect,
  });
  if (!c) throw new AppError(404, "Candidate not found.");
  return c;
}
async function moveStage(
  tx: Tx,
  ctx: Context,
  candidate: { id: string; stage: string },
  to: string,
  note?: string,
) {
  await tx.candidate.update({
    where: { id: candidate.id },
    data: { stage: to },
  });
  await tx.candidateEvent.create({
    data: {
      companyId: ctx.companyId,
      candidateId: candidate.id,
      fromStage: candidate.stage,
      toStage: to,
      note,
      actorId: ctx.userId,
      actorName: ctx.name,
    },
  });
}
// Job description text can come from an approved AI draft of this company.
async function aiDescription(ctx: Context, id?: string) {
  if (!id) return null;
  const doc = await db.aiGeneratedDocument.findFirst({
    where: {
      id,
      companyId: ctx.companyId,
      kind: "job_description",
      status: { in: ["Approved", "Published"] },
    },
  });
  if (!doc) throw new AppError(422, "Choose an approved AI job description.");
  return decrypt(doc.contentEncrypted).text;
}

export async function recruitmentRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  const method = req.method;
  const manage = () => requirePermission(ctx, "recruitment.manage");

  if (resource === "interviews") {
    if (
      !ctx.permissions.includes("recruitment.interview") &&
      !ctx.permissions.includes("recruitment.manage")
    )
      throw new AppError(
        403,
        "You do not have permission for this action.",
        "FORBIDDEN",
      );
    const all = ctx.permissions.includes("recruitment.manage");
    if (!id && method === "GET")
      return db.interview.findMany({
        where: {
          companyId: ctx.companyId,
          ...(all && req.nextUrl.searchParams.get("mine") !== "1"
            ? {}
            : { interviewerId: ctx.userId }),
        },
        include: {
          candidate: {
            select: {
              id: true,
              name: true,
              stage: true,
              job: { select: { title: true } },
            },
          },
        },
        orderBy: { scheduledAt: "desc" },
        take: 200,
      });
    if (id && method === "PUT") {
      const b = feedbackSchema.parse(await json(req));
      return db.$transaction(async (tx) => {
        const interview = await tx.interview.findFirst({
          where: { id, companyId: ctx.companyId },
        });
        if (!interview) throw new AppError(404, "Interview not found.");
        const assigned = interview.interviewerId === ctx.userId;
        // Only the assigned interviewer records the assessment.
        if (b.status === "COMPLETED" && !assigned)
          throw new AppError(
            403,
            "Only the assigned interviewer can submit feedback.",
          );
        if (!assigned && !all) throw new AppError(404, "Interview not found.");
        if (
          b.status === "COMPLETED" &&
          (!b.rating || !b.recommendation || !b.feedback)
        )
          throw new AppError(
            422,
            "Give a rating, recommendation and written feedback.",
          );
        const saved = await tx.interview.update({
          where: { id: interview.id },
          data: {
            ...b,
            submittedAt:
              b.status === "COMPLETED" ? new Date() : interview.submittedAt,
          },
        });
        await audit(
          tx,
          ctx,
          "UPDATE",
          "interviews",
          interview.id,
          { status: interview.status },
          { status: b.status },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "pipeline" && method === "GET") {
    manage();
    const [jobs, counts] = await Promise.all([
      db.jobOpening.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ["OPEN", "ON_HOLD"] },
        },
        select: { id: true, title: true, openings: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
      db.candidate.groupBy({
        by: ["jobId", "stage"],
        where: { companyId: ctx.companyId },
        _count: { _all: true },
      }),
    ]);
    return jobs.map((j) => ({
      ...j,
      stages: Object.fromEntries(
        stages.map((s) => [
          s,
          counts.find((c) => c.jobId === j.id && c.stage === s)?._count._all ??
            0,
        ]),
      ),
    }));
  }

  if (resource === "jobs") {
    manage();
    if (!id && method === "GET") {
      const status = req.nextUrl.searchParams.get("status");
      const jobs = await db.jobOpening.findMany({
        where: { companyId: ctx.companyId, ...(status ? { status } : {}) },
        include: { _count: { select: { candidates: true } } },
        orderBy: { createdAt: "desc" },
      });
      return jobs.map(({ _count, ...j }) => ({
        ...j,
        candidateCount: _count.candidates,
      }));
    }
    if (id && method === "GET") {
      const job = await db.jobOpening.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!job) throw new AppError(404, "Job opening not found.");
      return job;
    }
    if ((!id && method === "POST") || (id && method === "PUT")) {
      const { aiDocumentId, ...b } = jobSchema.parse(await json(req, 200000));
      const description =
        (await aiDescription(ctx, aiDocumentId)) ?? b.description;
      if (!description.trim())
        throw new AppError(
          422,
          "Add a job description or choose an approved AI draft.",
        );
      if (
        b.departmentId &&
        !(await db.department.findFirst({
          where: { id: b.departmentId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Department not found.");
      if (
        b.hiringManagerId &&
        !(await db.employee.findFirst({
          where: { id: b.hiringManagerId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Hiring manager not found.");
      const data = {
        ...b,
        description,
        closesOn: b.closesOn ? dayDate(b.closesOn) : null,
      };
      return db.$transaction(async (tx) => {
        const old = id
          ? await tx.jobOpening.findFirst({
              where: { id, companyId: ctx.companyId },
            })
          : null;
        if (id && !old) throw new AppError(404, "Job opening not found.");
        const saved = old
          ? await tx.jobOpening.update({ where: { id: old.id }, data })
          : await tx.jobOpening.create({
              data: {
                ...data,
                companyId: ctx.companyId,
                createdBy: ctx.userId,
              },
            });
        await audit(
          tx,
          ctx,
          old ? "UPDATE" : "CREATE",
          "job_openings",
          saved.id,
          old ? { status: old.status } : undefined,
          { title: saved.title, status: saved.status },
          ip(req),
        );
        return saved;
      });
    }
  }

  if (resource === "careers") return careersSettings(req, ctx);
  if (resource === "offers" && id) {
    manage();
    return offersRoute(req, ctx, id, action);
  }
  if (resource === "candidates" && id && action === "offers") {
    manage();
    return candidateOffers(req, ctx, id);
  }
  if (resource === "candidates") {
    manage();
    if (!id && method === "GET") {
      const q = req.nextUrl.searchParams;
      return db.candidate.findMany({
        where: {
          companyId: ctx.companyId,
          ...(q.get("jobId") ? { jobId: q.get("jobId")! } : {}),
          ...(q.get("stage") ? { stage: q.get("stage")! } : {}),
          ...(q.get("q")
            ? {
                OR: [
                  { name: { contains: q.get("q")!, mode: "insensitive" } },
                  { email: { contains: q.get("q")!, mode: "insensitive" } },
                  {
                    currentCompany: {
                      contains: q.get("q")!,
                      mode: "insensitive",
                    },
                  },
                ],
              }
            : {}),
        },
        select: candidateSelect,
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
    }
    if (!id && method === "POST") {
      await rateLimit(`candidate:${ctx.userId}`, 60);
      const { resume, ...b } = candidateSchema.parse(
        await json(req, 3_000_000),
      );
      const job = await db.jobOpening.findFirst({
        where: { id: b.jobId, companyId: ctx.companyId },
      });
      if (!job) throw new AppError(404, "Job opening not found.");
      if (job.status === "CLOSED")
        throw new AppError(409, "This job opening is closed.");
      const upload = resume ? validateUpload(resume) : null;
      if (upload && upload.type !== "application/pdf")
        throw new AppError(422, "Upload the resume as a PDF.");
      if (upload) await assertStorage(ctx.companyId, upload.bytes.length);
      return db.$transaction(async (tx) => {
        const saved = await tx.candidate.create({
          data: {
            ...b,
            companyId: ctx.companyId,
            ...(upload
              ? {
                  resumeName: upload.name,
                  resumeType: upload.type,
                  resumeSize: upload.bytes.length,
                  resumeData: upload.bytes,
                }
              : {}),
          },
          select: candidateSelect,
        });
        await tx.candidateEvent.create({
          data: {
            companyId: ctx.companyId,
            candidateId: saved.id,
            toStage: "APPLIED",
            actorId: ctx.userId,
            actorName: ctx.name,
          },
        });
        await enqueueWebhook(tx, ctx.companyId, "candidate.created", {
          id: saved.id,
          jobId: job.id,
          jobTitle: job.title,
          name: saved.name,
        });
        await audit(
          tx,
          ctx,
          "CREATE",
          "candidates",
          saved.id,
          undefined,
          { jobId: job.id },
          ip(req),
        );
        return saved;
      });
    }
    if (id && !action && method === "GET") {
      const c = await findCandidate(ctx, id);
      const [events, interviews] = await Promise.all([
        db.candidateEvent.findMany({
          where: { candidateId: c.id },
          orderBy: { createdAt: "asc" },
        }),
        db.interview.findMany({
          where: { candidateId: c.id },
          orderBy: { scheduledAt: "asc" },
        }),
      ]);
      return { ...c, events, interviews };
    }
    if (id && !action && method === "PUT") {
      const b = z
        .object({
          phone: text(30).nullable(),
          source: text(60).nullable(),
          currentCompany: text(120).nullable(),
          experienceYears: z.number().min(0).max(60).nullable(),
          expectedSalary: z.number().min(0).max(1000000000).nullable(),
          rating: z.number().int().min(1).max(5).nullable(),
          notes: text(2000).nullable(),
        })
        .strict()
        .parse(await json(req));
      const c = await findCandidate(ctx, id);
      return db.candidate.update({
        where: { id: c.id },
        data: b,
        select: candidateSelect,
      });
    }
    if (id && action === "resume" && method === "GET") {
      const c = await db.candidate.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { resumeData: true, resumeName: true, resumeType: true },
      });
      if (!c?.resumeData) throw new AppError(404, "Resume not found.");
      return new NextResponse(new Uint8Array(c.resumeData), {
        headers: {
          "content-type": c.resumeType ?? "application/pdf",
          "content-disposition": `attachment; filename="${(c.resumeName ?? "resume.pdf").replace(/"/g, "")}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "cache-control": "no-store",
        },
      });
    }
    if (id && action === "stage" && method === "POST") {
      const b = z
        .object({
          stage: z.enum(stages).exclude(["HIRED"]),
          note: text(1000).optional(),
        })
        .strict()
        .parse(await json(req));
      return db.$transaction(async (tx) => {
        const c = await findCandidate(ctx, id, tx);
        if (c.stage === "HIRED")
          throw new AppError(409, "Hired candidates cannot change stage.");
        if (c.stage === b.stage)
          throw new AppError(409, "The candidate is already in this stage.");
        await moveStage(tx, ctx, c, b.stage, b.note);
        return findCandidate(ctx, id, tx);
      });
    }
    // Hiring is always an explicit decision by an authorised person.
    if (id && action === "hire" && method === "POST") {
      const b = z
        .object({
          employeeCode: text(40).min(1),
          officialEmail: z.email().max(200).optional(),
          joinedAt: z.iso.date(),
          departmentId: z.string().nullable().default(null),
          designationId: z.string().nullable().default(null),
          note: text(1000).optional(),
        })
        .strict()
        .parse(await json(req));
      return db.$transaction(async (tx) => {
        const c = await findCandidate(ctx, id, tx);
        if (c.stage !== "OFFER")
          throw new AppError(409, "Move the candidate to Offer before hiring.");
        await acceptedOffer(tx, c.id);
        for (const [model, value] of [
          ["department", b.departmentId],
          ["designation", b.designationId],
        ] as const)
          if (
            value &&
            !(await (tx[model] as typeof tx.department).findFirst({
              where: { id: value, companyId: ctx.companyId },
            }))
          )
            throw new AppError(404, `The selected ${model} was not found.`);
        const [firstName, ...rest] = c.name.split(/\s+/);
        const employee = await tx.employee.create({
          data: {
            companyId: ctx.companyId,
            employeeCode: b.employeeCode,
            firstName,
            lastName: rest.join(" ") || "-",
            officialEmail: b.officialEmail ?? c.email,
            personalEmail: c.email,
            mobile: c.phone,
            joinedAt: dayDate(b.joinedAt),
            status: "Probation",
            departmentId: b.departmentId,
            designationId: b.designationId,
          },
        });
        await enforceLimit(tx, ctx.companyId, "employees");
        await tx.candidate.update({
          where: { id: c.id },
          data: { hiredEmployeeId: employee.id },
        });
        await moveStage(tx, ctx, c, "HIRED", b.note);
        await enqueueWebhook(tx, ctx.companyId, "candidate.selected", {
          id: c.id,
          jobId: c.jobId,
          employeeId: employee.id,
        });
        await enqueueWebhook(tx, ctx.companyId, "employee.created", {
          id: employee.id,
          employeeCode: employee.employeeCode,
          status: employee.status,
        });
        await audit(
          tx,
          ctx,
          "HIRE",
          "candidates",
          c.id,
          { stage: c.stage },
          { employeeId: employee.id },
          ip(req),
        );
        return { candidateId: c.id, employeeId: employee.id };
      });
    }
    if (id && action === "interviews" && method === "POST") {
      const b = interviewSchema.parse(await json(req));
      const interviewer = await db.user.findFirst({
        where: {
          id: b.interviewerUserId,
          companyId: ctx.companyId,
          active: true,
          role: {
            permissions: {
              some: {
                permissionKey: {
                  in: ["recruitment.interview", "recruitment.manage"],
                },
              },
            },
          },
        },
      });
      if (!interviewer)
        throw new AppError(404, "Choose an active user who can interview.");
      const scheduled = await db.$transaction(async (tx) => {
        const c = await findCandidate(ctx, id, tx);
        if (["HIRED", "REJECTED", "WITHDRAWN"].includes(c.stage))
          throw new AppError(409, "This candidate is no longer in process.");
        const saved = await tx.interview.create({
          data: {
            companyId: ctx.companyId,
            candidateId: c.id,
            interviewerId: interviewer.id,
            interviewerName: interviewer.name,
            scheduledAt: new Date(b.scheduledAt),
            durationMinutes: b.durationMinutes,
            mode: b.mode,
            location: b.location,
          },
        });
        if (["APPLIED", "SCREENING", "SHORTLISTED"].includes(c.stage))
          await moveStage(tx, ctx, c, "INTERVIEW", "Interview scheduled");
        return saved;
      });
      const cand = await findCandidate(ctx, id);
      await notify(
        ctx.companyId,
        [interviewer.id],
        "interview.scheduled",
        {
          candidate: cand.name,
          job: cand.job.title,
          when:
            scheduled.scheduledAt.toISOString().replace("T", " ").slice(0, 16) +
            " UTC",
        },
        "/recruitment",
      );
      return scheduled;
    }
  }
  if (resource === "interviewers" && method === "GET") {
    manage();
    return db.user.findMany({
      where: {
        companyId: ctx.companyId,
        active: true,
        role: {
          permissions: {
            some: {
              permissionKey: {
                in: ["recruitment.interview", "recruitment.manage"],
              },
            },
          },
        },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
