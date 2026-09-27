import { NextRequest } from "next/server";
import { companyAppUrl } from "@/modules/saas/branding";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { digest } from "@/lib/crypto";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { enforceLimit } from "@/modules/saas/service";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { dayDate } from "@/modules/time/rules";
import { recordHistory } from "@/modules/employees/lifecycle";
import { storeVersion } from "@/modules/documents/service";

type Tx = Prisma.TransactionClient;
// Default pre-joining checklist; companies can edit their own templates.
const defaults = [
  ["Offer letter issued and signed", "DOCUMENT", "HR", "OFFER_LETTER", true],
  ["Joining letter", "DOCUMENT", "HR", "APPOINTMENT_LETTER", true],
  ["Identity proof", "DOCUMENT", "EMPLOYEE", "ID_PROOF", true],
  ["Address proof", "DOCUMENT", "EMPLOYEE", "ADDRESS_PROOF", true],
  ["PAN card", "DOCUMENT", "EMPLOYEE", "PAN", true],
  [
    "Bank details (cancelled cheque or passbook)",
    "DOCUMENT",
    "EMPLOYEE",
    "BANK",
    true,
  ],
  ["Photograph", "DOCUMENT", "EMPLOYEE", "PHOTO", true],
  ["Education documents", "DOCUMENT", "EMPLOYEE", "EDUCATION", true],
  [
    "Previous employment documents",
    "DOCUMENT",
    "EMPLOYEE",
    "EXPERIENCE",
    false,
  ],
  ["Accept company policies", "POLICY", "EMPLOYEE", null, true],
  ["Allocate laptop and assets", "ASSET", "IT", null, false],
  ["Create email account", "ACCOUNT", "IT", null, true],
] as const;
const text = (max: number) => z.string().trim().max(max);
const templateSchema = z
  .array(
    z
      .object({
        title: text(150).min(2),
        category: z.enum(["DOCUMENT", "POLICY", "ASSET", "ACCOUNT", "OTHER"]),
        assignee: z.enum(["EMPLOYEE", "HR", "IT", "MANAGER"]),
        documentCategory: z.string().max(40).nullable().default(null),
        required: z.boolean(),
      })
      .strict(),
  )
  .min(1)
  .max(50);
const startSchema = z
  .object({
    candidateId: z.string().optional(),
    name: text(120).min(2).optional(),
    email: z.email().max(200).optional(),
    phone: text(30).optional(),
    employeeCode: text(40).min(1),
    joiningDate: z.iso.date(),
    departmentId: z.string().nullable().default(null),
    designationId: z.string().nullable().default(null),
  })
  .strict();
const file = z
  .object({
    name: z.string().min(1).max(200),
    type: z.string().max(120),
    base64: z.string().max(7_000_000),
  })
  .strict();

async function templates(tx: Tx | typeof db, companyId: string) {
  const rows = await tx.onboardingTaskTemplate.findMany({
    where: { companyId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.length
    ? rows
    : defaults.map(
        (
          [title, category, assignee, documentCategory, required],
          sortOrder,
        ) => ({
          title,
          category,
          assignee,
          documentCategory,
          required,
          sortOrder,
        }),
      );
}
const detail = (id: string) =>
  db.onboarding.findUniqueOrThrow({
    where: { id },
    include: {
      tasks: { orderBy: { sortOrder: "asc" } },
      documents: {
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
async function issuePortal(tx: Tx, onboardingId: string) {
  const token = randomBytes(32).toString("base64url");
  await tx.onboarding.update({
    where: { id: onboardingId },
    data: {
      portalTokenHash: digest(token),
      portalExpiresAt: new Date(Date.now() + 21 * 86400000),
    },
  });
  const o = await tx.onboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    select: { companyId: true },
  });
  return `${await companyAppUrl(o.companyId)}/onboarding/${token}`;
}

export async function onboardingRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  requirePermission(ctx, "onboarding.manage");
  const [, id, action, sub] = path;
  const method = req.method;
  if (id === "templates") {
    if (method === "GET") return templates(db, ctx.companyId);
    const b = templateSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      await tx.onboardingTaskTemplate.deleteMany({
        where: { companyId: ctx.companyId },
      });
      await tx.onboardingTaskTemplate.createMany({
        data: b.map((t, sortOrder) => ({
          ...t,
          sortOrder,
          companyId: ctx.companyId,
        })),
      });
      return templates(tx, ctx.companyId);
    });
  }
  if (!id && method === "GET")
    return db.onboarding.findMany({
      where: {
        companyId: ctx.companyId,
        ...(req.nextUrl.searchParams.get("status")
          ? { status: req.nextUrl.searchParams.get("status")! }
          : {}),
      },
      include: { tasks: { select: { status: true, required: true } } },
      orderBy: { joiningDate: "asc" },
      take: 200,
    });
  if (!id && method === "POST") {
    const b = startSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      let person = { name: b.name, email: b.email, phone: b.phone };
      if (b.candidateId) {
        const c = await tx.candidate.findFirst({
          where: { id: b.candidateId, companyId: ctx.companyId },
        });
        if (!c) throw new AppError(404, "Candidate not found.");
        if (c.stage !== "OFFER")
          throw new AppError(
            409,
            "Start onboarding once the candidate has an offer.",
          );
        person = { name: c.name, email: c.email, phone: c.phone ?? undefined };
      }
      if (!person.name || !person.email)
        throw new AppError(
          422,
          "Give the joiner's name and email, or choose a candidate.",
        );
      if (
        b.departmentId &&
        !(await tx.department.findFirst({
          where: { id: b.departmentId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Department not found.");
      if (
        b.designationId &&
        !(await tx.designation.findFirst({
          where: { id: b.designationId, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, "Designation not found.");
      if (
        await tx.employee.findUnique({
          where: {
            companyId_employeeCode: {
              companyId: ctx.companyId,
              employeeCode: b.employeeCode,
            },
          },
        })
      )
        throw new AppError(409, "This employee code is already in use.");
      const o = await tx.onboarding.create({
        data: {
          companyId: ctx.companyId,
          candidateId: b.candidateId,
          name: person.name,
          email: person.email.toLowerCase(),
          phone: person.phone,
          employeeCode: b.employeeCode,
          joiningDate: dayDate(b.joiningDate),
          departmentId: b.departmentId,
          designationId: b.designationId,
          createdBy: ctx.userId,
        },
      });
      await tx.onboardingTask.createMany({
        data: (await templates(tx, ctx.companyId)).map((t) => ({
          companyId: ctx.companyId,
          onboardingId: o.id,
          title: t.title,
          category: t.category,
          assignee: t.assignee,
          documentCategory: t.documentCategory,
          required: t.required,
          sortOrder: t.sortOrder,
        })),
      });
      await audit(
        tx,
        ctx,
        "START",
        "onboarding",
        o.id,
        undefined,
        { name: o.name, joiningDate: b.joiningDate },
        ip(req),
      );
      return o;
    });
  }
  const o = await db.onboarding.findFirst({
    where: { id, companyId: ctx.companyId },
  });
  if (!o) throw new AppError(404, "Onboarding not found.");
  if (!action && method === "GET") return detail(o.id);
  if (o.status !== "IN_PROGRESS")
    throw new AppError(409, "This onboarding is closed.");
  if (action === "invite" && method === "POST") {
    const link = await db.$transaction((tx) => issuePortal(tx, o.id));
    const company = await db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
    });
    let emailed = false;
    if (emailConfigured()) {
      await sendAuthEmail(
        o.email,
        `Complete your joining formalities at ${company.name}`,
        `Hello ${o.name},\n\nPlease complete your pre-joining checklist before ${o.joiningDate.toISOString().slice(0, 10)}:\n${link}\n\nThe link is valid for 21 days.`,
      )
        .then(() => (emailed = true))
        .catch(() => undefined);
    }
    return { link, emailed, expiresInDays: 21 };
  }
  if (action === "tasks" && sub && method === "PUT") {
    const b = z
      .object({
        status: z.enum(["PENDING", "DONE", "WAIVED"]),
        notes: text(500).optional(),
      })
      .strict()
      .parse(await json(req));
    const task = await db.onboardingTask.findFirst({
      where: { id: sub, onboardingId: o.id },
    });
    if (!task) throw new AppError(404, "Task not found.");
    if (b.status === "WAIVED" && task.required)
      throw new AppError(422, "Required tasks cannot be waived.");
    return db.onboardingTask.update({
      where: { id: task.id },
      data: {
        status: b.status,
        notes: b.notes ?? task.notes,
        completedBy: b.status === "PENDING" ? null : ctx.userId,
        completedAt: b.status === "PENDING" ? null : new Date(),
      },
    });
  }
  if (action === "tasks" && sub && method === "POST") {
    // HR uploads a document (e.g. the signed offer letter) for a task.
    const b = z
      .object({ file })
      .strict()
      .parse(await json(req, 7_500_000));
    return attachDocument(o.id, ctx.companyId, sub, b.file, ctx.userId, true);
  }
  if (action === "cancel" && method === "POST")
    return db.onboarding.update({
      where: { id: o.id },
      data: { status: "CANCELLED", portalTokenHash: null },
    });
  if (action === "complete" && method === "POST") {
    const tasks = await db.onboardingTask.findMany({
      where: { onboardingId: o.id },
    });
    const open = tasks.filter((t) => t.required && t.status !== "DONE");
    if (open.length)
      throw new AppError(
        409,
        `Complete the required tasks first: ${open.map((t) => t.title).join(", ")}.`,
      );
    return db.$transaction(async (tx) => {
      const [firstName, ...rest] = o.name.split(/\s+/);
      const employee = await tx.employee.create({
        data: {
          companyId: ctx.companyId,
          employeeCode: o.employeeCode,
          firstName,
          lastName: rest.join(" ") || "-",
          officialEmail: o.email,
          personalEmail: o.email,
          mobile: o.phone,
          joinedAt: o.joiningDate,
          status: "Probation",
          departmentId: o.departmentId,
          designationId: o.designationId,
        },
      });
      await enforceLimit(tx, ctx.companyId, "employees");
      // Collected documents move onto the new employee's record.
      await tx.document.updateMany({
        where: { onboardingId: o.id },
        data: { employeeId: employee.id, visibility: "EMPLOYEE" },
      });
      await tx.onboarding.update({
        where: { id: o.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          employeeId: employee.id,
          portalTokenHash: null,
        },
      });
      await recordHistory(
        tx,
        ctx,
        employee.id,
        "JOINED",
        o.joiningDate,
        undefined,
        { status: "Probation", source: "onboarding" },
      );
      if (o.candidateId) {
        const c = await tx.candidate.findUniqueOrThrow({
          where: { id: o.candidateId },
        });
        await tx.candidate.update({
          where: { id: c.id },
          data: { stage: "HIRED", hiredEmployeeId: employee.id },
        });
        await tx.candidateEvent.create({
          data: {
            companyId: ctx.companyId,
            candidateId: c.id,
            fromStage: c.stage,
            toStage: "HIRED",
            note: "Onboarding completed",
            actorId: ctx.userId,
            actorName: ctx.name,
          },
        });
        await enqueueWebhook(tx, ctx.companyId, "candidate.selected", {
          id: c.id,
          jobId: c.jobId,
          employeeId: employee.id,
        });
      }
      await enqueueWebhook(tx, ctx.companyId, "employee.created", {
        id: employee.id,
        employeeCode: employee.employeeCode,
        status: employee.status,
      });
      await audit(
        tx,
        ctx,
        "COMPLETE",
        "onboarding",
        o.id,
        undefined,
        { employeeId: employee.id },
        ip(req),
      );
      return { onboardingId: o.id, employeeId: employee.id };
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
async function attachDocument(
  onboardingId: string,
  companyId: string,
  taskId: string,
  input: z.infer<typeof file>,
  uploadedBy: string,
  byHr: boolean,
) {
  const task = await db.onboardingTask.findFirst({
    where: { id: taskId, onboardingId },
  });
  if (!task || task.category !== "DOCUMENT")
    throw new AppError(404, "Document task not found.");
  if (!byHr && task.assignee !== "EMPLOYEE")
    throw new AppError(403, "This task is completed by the company.");
  return db.$transaction(
    async (tx) => {
      const doc = task.documentId
        ? await tx.document.update({
            where: { id: task.documentId },
            data: {
              currentVersion: { increment: 1 },
              status: byHr ? "APPROVED" : "PENDING_APPROVAL",
            },
          })
        : await tx.document.create({
            data: {
              companyId,
              onboardingId,
              title: task.title,
              category: task.documentCategory ?? "OTHER",
              visibility: "HR_ONLY",
              status: byHr ? "APPROVED" : "PENDING_APPROVAL",
              uploadedBy,
            },
          });
      await storeVersion(
        tx,
        companyId,
        doc.id,
        doc.currentVersion,
        input,
        uploadedBy,
      );
      return tx.onboardingTask.update({
        where: { id: task.id },
        data: {
          documentId: doc.id,
          status: byHr ? "DONE" : "SUBMITTED",
          completedAt: byHr ? new Date() : null,
        },
      });
    },
    { timeout: 30000 },
  );
}

// Public pre-joining portal, reached with the single-use-per-joiner link.
export async function onboardingPortal(
  req: NextRequest,
  token: string,
  taskId?: string,
) {
  await rateLimit(`onboarding-portal:${ip(req)}`, 120);
  const o = await db.onboarding.findFirst({
    where: {
      portalTokenHash: digest(token),
      status: "IN_PROGRESS",
      portalExpiresAt: { gt: new Date() },
    },
    include: { company: { select: { name: true } } },
  });
  if (!o)
    throw new AppError(404, "This onboarding link is invalid or has expired.");
  // The link resolves to one joiner; everything after runs in that company.
  return withTenant(o.companyId, () => portal(req, o, taskId));
}
async function portal(
  req: NextRequest,
  o: Prisma.OnboardingGetPayload<{
    include: { company: { select: { name: true } } };
  }>,
  taskId?: string,
) {
  if (!taskId && req.method === "GET") {
    const tasks = await db.onboardingTask.findMany({
      where: { onboardingId: o.id, assignee: "EMPLOYEE" },
      orderBy: { sortOrder: "asc" },
    });
    return {
      company: o.company.name,
      name: o.name,
      joiningDate: o.joiningDate,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        required: t.required,
        status: t.status,
      })),
    };
  }
  if (taskId && req.method === "POST") {
    const task = await db.onboardingTask.findFirst({
      where: { id: taskId, onboardingId: o.id, assignee: "EMPLOYEE" },
    });
    if (!task) throw new AppError(404, "Task not found.");
    if (task.status === "DONE")
      throw new AppError(409, "This task has already been verified.");
    if (task.category === "POLICY") {
      z.object({ accept: z.literal(true) })
        .strict()
        .parse(await json(req));
      return db.onboardingTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          notes: `Accepted by ${o.name} on ${new Date().toISOString()}`,
          completedAt: new Date(),
        },
      });
    }
    const b = z
      .object({ file })
      .strict()
      .parse(await json(req, 7_500_000));
    return attachDocument(
      o.id,
      o.companyId,
      task.id,
      b.file,
      "onboarding-portal",
      false,
    );
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
