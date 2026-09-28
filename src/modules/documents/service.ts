import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import { deleteFile, putFile, signedUrl } from "@/lib/storage";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";
import { linkedEmployee } from "@/modules/shared/team";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { paginationSchema } from "@/modules/shared/validators";
import { employmentLetters, isEmploymentLetter } from "./categories";

export const documentCategories = [
  "CONTRACT",
  "OFFER_LETTER",
  "APPOINTMENT_LETTER",
  "INCREMENT_LETTER",
  "PROMOTION_LETTER",
  "POLICY",
  "ID_PROOF",
  "ADDRESS_PROOF",
  "PAN",
  "BANK",
  "PHOTO",
  "EDUCATION",
  "EXPERIENCE",
  "SALARY",
  "COMPLIANCE",
  "OTHER",
] as const;
export const maxDocumentBytes = 5 * 1024 * 1024;
const file = z
  .object({
    name: z.string().min(1).max(200),
    type: z.string().max(120),
    base64: z.string().max(7_000_000),
  })
  .strict();
const metaSchema = z
  .object({
    title: z.string().trim().min(2).max(150),
    category: z.enum(documentCategories),
    visibility: z
      .enum(["EMPLOYEE", "HR_ONLY", "ALL_EMPLOYEES"])
      .default("EMPLOYEE"),
    expiresOn: z.iso.date().nullable().default(null),
    requiresAcknowledgement: z.boolean().default(false),
  })
  .strict();
const createSchema = metaSchema
  .extend({ employeeId: z.string().nullable().default(null), file })
  .strict();
const include = {
  versions: {
    select: {
      version: true,
      fileName: true,
      contentType: true,
      size: true,
      createdAt: true,
      uploadedBy: true,
    },
    orderBy: { version: "desc" as const },
  },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      userId: true,
    },
  },
  _count: { select: { acknowledgements: true } },
};

// Stores a validated file as the next version of a document.
export async function storeVersion(
  tx: Prisma.TransactionClient,
  companyId: string,
  documentId: string,
  version: number,
  input: z.infer<typeof file>,
  uploadedBy: string,
) {
  const upload = validateUpload(input, maxDocumentBytes);
  await assertStorage(companyId, upload.bytes.length);
  const stored = await putFile(companyId, upload.bytes, upload.type);
  await tx.documentVersion.create({
    data: {
      companyId,
      documentId,
      version,
      fileName: upload.name,
      contentType: upload.type,
      size: upload.bytes.length,
      storageKey: stored.key,
      sha256: stored.sha256,
      uploadedBy,
    },
  });
}
async function access(ctx: Context) {
  const manage = ctx.permissions.includes("documents.manage");
  if (!manage) requirePermission(ctx, "documents.self");
  return { manage, me: await linkedEmployee(ctx) };
}
function canView(
  a: Awaited<ReturnType<typeof access>>,
  d: { employeeId: string | null; visibility: string; status: string },
) {
  if (a.manage) return true;
  if (d.visibility === "HR_ONLY") return false;
  if (d.employeeId) return d.employeeId === a.me?.id;
  return d.visibility === "ALL_EMPLOYEES" && d.status === "APPROVED";
}

export async function documentsRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, id, action] = path;
  const method = req.method;
  const a = await access(ctx);

  if (!id && method === "GET") {
    const q = req.nextUrl.searchParams;
    const scope = q.get("scope") ?? "own";
    const where: Prisma.DocumentWhereInput = { companyId: ctx.companyId };
    if (scope === "policies")
      Object.assign(where, {
        employeeId: null,
        ...(a.manage
          ? {}
          : { visibility: "ALL_EMPLOYEES", status: "APPROVED" }),
      });
    else if (scope === "company") {
      requirePermission(ctx, "documents.manage");
      if (q.get("employeeId")) where.employeeId = q.get("employeeId");
      if (q.get("status")) where.status = q.get("status")!;
      const days = Number(q.get("expiringDays") ?? 0);
      if (days > 0)
        where.expiresOn = { lte: new Date(Date.now() + days * 86400000) };
    } else {
      if (!a.me)
        throw new AppError(403, "Your account needs a linked employee record.");
      Object.assign(where, {
        employeeId: a.me.id,
        visibility: { not: "HR_ONLY" },
      });
    }
    if (q.get("letters") === "1")
      where.category = { in: [...employmentLetters] };
    else if (q.get("category")) where.category = q.get("category")!;
    // Callers requesting pages get totals and title/employee search; older
    // consumers keep the plain capped list.
    const paged = q.has("page");
    const p = paginationSchema.parse(Object.fromEntries(q));
    if (paged && p.search) {
      const contains = { contains: p.search, mode: "insensitive" as const };
      where.AND = [
        {
          OR: [
            { title: contains },
            { employee: { employeeCode: contains } },
            { employee: { firstName: contains } },
            { employee: { lastName: contains } },
          ],
        },
      ];
    }
    const [docs, total] = await Promise.all([
      db.document.findMany({
        where,
        include,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: paged ? (p.page - 1) * p.pageSize : 0,
        take: paged ? p.pageSize : 500,
      }),
      paged ? db.document.count({ where }) : 0,
    ]);
    const acked = a.me
      ? new Set(
          (
            await db.documentAcknowledgement.findMany({
              where: {
                employeeId: a.me.id,
                documentId: { in: docs.map((x) => x.id) },
              },
            })
          ).map((x) => x.documentId),
        )
      : new Set<string>();
    const items = docs.map(({ _count, ...d }) => ({
      ...d,
      acknowledgements: _count.acknowledgements,
      acknowledgedByMe: acked.has(d.id),
    }));
    return paged ? { items, total, page: p.page, pageSize: p.pageSize } : items;
  }

  if (!id && method === "POST") {
    await rateLimit(`document:${ctx.userId}`, 60);
    const b = createSchema.parse(await json(req, 7_500_000));
    if (isEmploymentLetter(b.category)) {
      requirePermission(ctx, "documents.manage");
      if (!b.employeeId || b.visibility !== "EMPLOYEE")
        throw new AppError(
          422,
          "Employment letters must be assigned to one employee and visible only to that employee and HR.",
        );
    }
    let employeeId = b.employeeId;
    if (!a.manage) {
      if (!a.me)
        throw new AppError(403, "Your account needs a linked employee record.");
      if (employeeId && employeeId !== a.me.id)
        throw new AppError(403, "You can only upload your own documents.");
      employeeId = a.me.id;
    } else if (
      employeeId &&
      !(await db.employee.findFirst({
        where: { id: employeeId, companyId: ctx.companyId },
      }))
    )
      throw new AppError(404, "Employee not found.");
    if (!employeeId && b.visibility === "EMPLOYEE")
      throw new AppError(
        422,
        "Company documents must be visible to all employees or HR only.",
      );
    const saved = await db.$transaction(
      async (tx) => {
        const doc = await tx.document.create({
          data: {
            companyId: ctx.companyId,
            employeeId,
            title: b.title,
            category: b.category,
            visibility: a.manage ? b.visibility : "EMPLOYEE",
            expiresOn: b.expiresOn ? new Date(b.expiresOn) : null,
            requiresAcknowledgement: a.manage && b.requiresAcknowledgement,
            // Employee uploads are reviewed by HR before they count.
            status: a.manage ? "APPROVED" : "PENDING_APPROVAL",
            uploadedBy: ctx.userId,
          },
        });
        await storeVersion(tx, ctx.companyId, doc.id, 1, b.file, ctx.userId);
        await audit(
          tx,
          ctx,
          "UPLOAD",
          "documents",
          doc.id,
          undefined,
          { title: b.title, category: b.category, employeeId },
          ip(req),
        );
        return doc;
      },
      { timeout: 30000 },
    );
    if (!a.manage)
      await notify(
        ctx.companyId,
        await usersWithPermission(ctx.companyId, "documents.manage"),
        "document.review",
        { employee: ctx.name, title: b.title },
        "/documents",
      );
    return saved;
  }

  const doc = await db.document.findFirst({
    where: { id, companyId: ctx.companyId },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  if (!doc || !canView(a, doc)) throw new AppError(404, "Document not found.");
  const own = !!a.me && doc.employeeId === a.me.id;

  if (action === "download" && method === "GET") {
    const wanted = Number(
      req.nextUrl.searchParams.get("version") ?? doc.currentVersion,
    );
    const v = doc.versions.find((x) => x.version === wanted);
    if (!v) throw new AppError(404, "Version not found.");
    const inline =
      req.nextUrl.searchParams.get("inline") === "1" &&
      ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(
        v.contentType,
      );
    await db.auditLog.create({
      data: {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorName: ctx.name,
        action: "DOWNLOAD",
        module: "documents",
        recordId: doc.id,
        newValue: { version: v.version },
        ip: ip(req),
      },
    });
    return {
      url: await signedUrl(v.storageKey, {
        fileName: v.fileName,
        contentType: v.contentType,
        inline,
      }),
      expiresInSeconds: 300,
    };
  }
  if (action === "versions" && method === "POST") {
    if (isEmploymentLetter(doc.category))
      requirePermission(ctx, "documents.manage");
    if (!a.manage && !own)
      throw new AppError(403, "You cannot update this document.");
    const b = z
      .object({ file })
      .strict()
      .parse(await json(req, 7_500_000));
    return db.$transaction(
      async (tx) => {
        const next = doc.currentVersion + 1;
        await storeVersion(tx, ctx.companyId, doc.id, next, b.file, ctx.userId);
        const saved = await tx.document.update({
          where: { id: doc.id },
          data: {
            currentVersion: next,
            ...(a.manage
              ? {}
              : {
                  status: "PENDING_APPROVAL",
                  reviewedAt: null,
                  reviewNote: null,
                }),
          },
        });
        // A new version asks everyone to acknowledge again.
        if (saved.requiresAcknowledgement)
          await tx.documentAcknowledgement.deleteMany({
            where: { documentId: doc.id },
          });
        await audit(
          tx,
          ctx,
          "NEW_VERSION",
          "documents",
          doc.id,
          { version: doc.currentVersion },
          { version: next },
          ip(req),
        );
        return saved;
      },
      { timeout: 30000 },
    );
  }
  if (action === "acknowledge" && method === "POST") {
    if (!a.me)
      throw new AppError(403, "Your account needs a linked employee record.");
    if (!doc.requiresAcknowledgement)
      throw new AppError(409, "This document does not need acknowledgement.");
    return db.documentAcknowledgement.upsert({
      where: {
        documentId_employeeId: { documentId: doc.id, employeeId: a.me.id },
      },
      create: {
        companyId: ctx.companyId,
        documentId: doc.id,
        employeeId: a.me.id,
      },
      update: {},
    });
  }
  requirePermission(ctx, "documents.manage");
  if (!action && method === "PUT") {
    const b = metaSchema.parse(await json(req));
    if (
      isEmploymentLetter(b.category) &&
      (!doc.employeeId || b.visibility !== "EMPLOYEE")
    )
      throw new AppError(
        422,
        "Employment letters must be private to the assigned employee and HR.",
      );
    if (!doc.employeeId && b.visibility === "EMPLOYEE")
      throw new AppError(
        422,
        "Company documents must be visible to all employees or HR only.",
      );
    return db.document.update({
      where: { id: doc.id },
      data: { ...b, expiresOn: b.expiresOn ? new Date(b.expiresOn) : null },
    });
  }
  if (action === "review" && method === "POST") {
    const b = z
      .object({
        action: z.enum(["approve", "reject"]),
        note: z.string().trim().max(500).default(""),
      })
      .strict()
      .parse(await json(req));
    if (own)
      throw new AppError(
        403,
        "Another reviewer must review your own document.",
      );
    if (doc.status !== "PENDING_APPROVAL")
      throw new AppError(409, "This document is not awaiting review.");
    if (b.action === "reject" && !b.note)
      throw new AppError(422, "Give a reason for rejecting the document.");
    const saved = await db.document.update({
      where: { id: doc.id },
      data: {
        status: b.action === "approve" ? "APPROVED" : "REJECTED",
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: b.note,
      },
    });
    const employee = doc.employeeId
      ? await db.employee.findUnique({
          where: { id: doc.employeeId },
          select: { userId: true },
        })
      : null;
    await notify(
      ctx.companyId,
      [employee?.userId],
      "document.reviewed",
      { title: doc.title, status: saved.status.toLowerCase(), note: b.note },
      "/documents",
    );
    return saved;
  }
  if (!action && method === "DELETE") {
    await db.$transaction(async (tx) => {
      // An onboarding task loses its evidence with the document, so it reopens.
      await tx.onboardingTask.updateMany({
        where: { companyId: ctx.companyId, documentId: doc.id },
        data: {
          documentId: null,
          status: "PENDING",
          completedBy: null,
          completedAt: null,
        },
      });
      await tx.document.delete({ where: { id: doc.id } });
      await audit(
        tx,
        ctx,
        "DELETE",
        "documents",
        doc.id,
        { title: doc.title, versions: doc.versions.length },
        undefined,
        ip(req),
      );
    });
    for (const v of doc.versions)
      await deleteFile(v.storageKey).catch(() => undefined);
    return { deleted: true };
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
