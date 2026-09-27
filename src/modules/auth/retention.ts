import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { deleteFile } from "@/lib/storage";
import { audit, ip, json, requirePermission, type Context } from "./service";

type Tx = Prisma.TransactionClient;
// Minimum periods protect records that law or disputes may need.
export const retentionCategories = {
  attendance: {
    min: 1095,
    action:
      "Delete attendance records and punch evidence older than the period",
  },
  audit_logs: {
    min: 365,
    action: "Delete audit log entries older than the period",
  },
  login_history: {
    min: 90,
    action: "Delete login history older than the period",
  },
  applications: {
    min: 30,
    action:
      "Anonymise rejected and withdrawn candidates (name, contact, resume, notes) last updated before the period",
  },
  documents: {
    min: 365,
    action: "Delete documents of employees who left before the period",
  },
  exited_employees: {
    min: 730,
    action:
      "Anonymise contact, identity, bank and address data of employees who left before the period; code, name and payroll records are kept",
  },
} as const;
type Category = keyof typeof retentionCategories;
const categories = Object.keys(retentionCategories) as Category[];
const day = 86400000;

// Records a category would affect for the cutoff.
async function affected(
  tx: Tx | typeof db,
  companyId: string,
  category: Category,
  cutoff: Date,
) {
  const left = {
    companyId,
    status: "Inactive",
    OR: [
      { exitSettlement: { lastWorkingDay: { lt: cutoff } } },
      { exitSettlement: null, updatedAt: { lt: cutoff } },
    ],
  } satisfies Prisma.EmployeeWhereInput;
  switch (category) {
    case "attendance":
      return tx.attendance.count({
        where: { companyId, workDate: { lt: cutoff } },
      });
    case "audit_logs":
      return tx.auditLog.count({
        where: { companyId, createdAt: { lt: cutoff } },
      });
    case "login_history":
      return tx.loginHistory.count({
        where: { companyId, createdAt: { lt: cutoff } },
      });
    case "applications":
      return tx.candidate.count({
        where: {
          companyId,
          stage: { in: ["REJECTED", "WITHDRAWN"] },
          updatedAt: { lt: cutoff },
          NOT: { email: { endsWith: "@removed.invalid" } },
        },
      });
    case "documents":
      return tx.document.count({ where: { companyId, employee: left } });
    case "exited_employees":
      return tx.employee.count({
        where: {
          ...left,
          NOT: {
            personalEmail: null,
            mobile: null,
            sensitiveEncrypted: null,
            dateOfBirth: null,
          },
        },
      });
  }
}

async function apply(
  tx: Tx,
  companyId: string,
  category: Category,
  cutoff: Date,
) {
  const left = {
    companyId,
    status: "Inactive",
    OR: [
      { exitSettlement: { lastWorkingDay: { lt: cutoff } } },
      { exitSettlement: null, updatedAt: { lt: cutoff } },
    ],
  } satisfies Prisma.EmployeeWhereInput;
  if (category === "attendance") {
    const ids = (
      await tx.attendance.findMany({
        where: { companyId, workDate: { lt: cutoff } },
        select: { id: true },
      })
    ).map((a) => a.id);
    const linked = { where: { attendanceId: { in: ids } } };
    await tx.attendancePunch.deleteMany(linked);
    await tx.geofenceEvent.deleteMany(linked);
    await tx.faceVerificationLog.deleteMany(linked);
    await tx.attendanceRegularization.updateMany({
      ...linked,
      data: { attendanceId: null },
    });
    await tx.compOffRequest.updateMany({
      ...linked,
      data: { attendanceId: null },
    });
    await tx.devicePunch.updateMany({
      ...linked,
      data: { attendanceId: null },
    });
    return (await tx.attendance.deleteMany({ where: { id: { in: ids } } }))
      .count;
  }
  if (category === "audit_logs")
    return (
      await tx.auditLog.deleteMany({
        where: { companyId, createdAt: { lt: cutoff } },
      })
    ).count;
  if (category === "login_history")
    return (
      await tx.loginHistory.deleteMany({
        where: { companyId, createdAt: { lt: cutoff } },
      })
    ).count;
  if (category === "applications") {
    const rows = await tx.candidate.findMany({
      where: {
        companyId,
        stage: { in: ["REJECTED", "WITHDRAWN"] },
        updatedAt: { lt: cutoff },
        NOT: { email: { endsWith: "@removed.invalid" } },
      },
      select: { id: true },
    });
    for (const r of rows)
      await tx.candidate.update({
        where: { id: r.id },
        data: {
          name: "Removed applicant",
          email: `${r.id}@removed.invalid`,
          phone: null,
          currentCompany: null,
          notes: null,
          resumeName: null,
          resumeType: null,
          resumeSize: null,
          resumeData: null,
        },
      });
    return rows.length;
  }
  if (category === "documents") {
    const docs = await tx.document.findMany({
      where: { companyId, employee: left },
      select: { id: true, versions: { select: { storageKey: true } } },
    });
    const ids = docs.map((d) => d.id);
    await tx.onboardingTask.updateMany({
      where: { documentId: { in: ids } },
      data: { documentId: null },
    });
    await tx.documentAcknowledgement.deleteMany({
      where: { documentId: { in: ids } },
    });
    await tx.documentVersion.deleteMany({ where: { documentId: { in: ids } } });
    await tx.document.deleteMany({ where: { id: { in: ids } } });
    // Stored files are removed after the rows; a missing file is not an error.
    for (const key of docs.flatMap((d) => d.versions.map((v) => v.storageKey)))
      await deleteFile(key).catch(() => undefined);
    return ids.length;
  }
  const people = await tx.employee.findMany({
    where: left,
    select: { id: true, photoKey: true },
  });
  const ids = people.map((p) => p.id);
  await tx.employeeAddress.deleteMany({ where: { employeeId: { in: ids } } });
  await tx.employeeEmergencyContact.deleteMany({
    where: { employeeId: { in: ids } },
  });
  await tx.employeeBankAccount.deleteMany({
    where: { employeeId: { in: ids } },
  });
  await tx.employee.updateMany({
    where: { id: { in: ids } },
    data: {
      personalEmail: null,
      mobile: null,
      dateOfBirth: null,
      sensitiveEncrypted: null,
      photoKey: null,
      photoType: null,
      photoSize: null,
    },
  });
  for (const p of people)
    if (p.photoKey) await deleteFile(p.photoKey).catch(() => undefined);
  return ids.length;
}

const policySchema = z
  .object({
    category: z.enum(categories as [Category, ...Category[]]),
    retainDays: z.number().int().min(30).max(36500),
    enabled: z.boolean(),
  })
  .strict();

export async function retentionRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  requirePermission(ctx, "security.manage");
  const [, , action] = path;
  const method = req.method;
  const now = Date.now();
  if (!action && method === "GET") {
    const [policies, company, runs] = await Promise.all([
      db.retentionPolicy.findMany({ where: { companyId: ctx.companyId } }),
      db.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { legalHold: true },
      }),
      db.retentionRun.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const rows = [];
    for (const category of categories) {
      const p = policies.find((x) => x.category === category);
      const days = p?.retainDays ?? null;
      rows.push({
        category,
        minimumDays: retentionCategories[category].min,
        action: retentionCategories[category].action,
        retainDays: days,
        enabled: p?.enabled ?? false,
        // What a run would affect today, for review before enabling.
        wouldAffect: days
          ? await affected(
              db,
              ctx.companyId,
              category,
              new Date(now - days * day),
            )
          : null,
      });
    }
    return { legalHold: company.legalHold, policies: rows, runs };
  }
  if (!action && method === "PUT") {
    const b = policySchema.parse(await json(req));
    const min = retentionCategories[b.category].min;
    if (b.retainDays < min)
      throw new AppError(
        422,
        `Keep ${b.category.replace("_", " ")} for at least ${min} days.`,
        "RETENTION_TOO_SHORT",
      );
    return db.$transaction(async (tx) => {
      const saved = await tx.retentionPolicy.upsert({
        where: {
          companyId_category: {
            companyId: ctx.companyId,
            category: b.category,
          },
        },
        create: { ...b, companyId: ctx.companyId, updatedBy: ctx.userId },
        update: {
          retainDays: b.retainDays,
          enabled: b.enabled,
          updatedBy: ctx.userId,
        },
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "retention_policies",
        saved.id,
        undefined,
        b,
        ip(req),
      );
      return saved;
    });
  }
  if (action === "legal-hold" && method === "PUT") {
    const b = z
      .object({
        enabled: z.boolean(),
        reason: z.string().trim().min(3).max(300),
      })
      .strict()
      .parse(await json(req));
    return db.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: ctx.companyId },
        data: { legalHold: b.enabled },
      });
      await audit(
        tx,
        ctx,
        b.enabled ? "LEGAL_HOLD_ON" : "LEGAL_HOLD_OFF",
        "retention_policies",
        ctx.companyId,
        undefined,
        { reason: b.reason },
        ip(req),
      );
      return { legalHold: b.enabled };
    });
  }
  if (action === "run" && method === "POST") {
    const b = z
      .object({
        category: z.enum(categories as [Category, ...Category[]]),
        dryRun: z.boolean().default(true),
        confirm: z.literal(true).optional(),
      })
      .strict()
      .parse(await json(req));
    if (!b.dryRun && !b.confirm)
      throw new AppError(
        422,
        "Confirm that the records may be permanently removed.",
        "CONFIRMATION_REQUIRED",
      );
    return runRetention(ctx.companyId, b.category, b.dryRun, ctx.userId, ctx);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Runs one category's enabled policy; also used by the scheduled worker.
export async function runRetention(
  companyId: string,
  category: Category,
  dryRun: boolean,
  runBy: string,
  ctx?: Context,
) {
  return db.$transaction(
    async (tx) => {
      const [company, policy] = await Promise.all([
        tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { legalHold: true },
        }),
        tx.retentionPolicy.findUnique({
          where: { companyId_category: { companyId, category } },
        }),
      ]);
      if (!policy?.enabled)
        throw new AppError(
          409,
          "Enable a retention policy for this category first.",
          "RETENTION_DISABLED",
        );
      if (policy.retainDays < retentionCategories[category].min)
        throw new AppError(
          409,
          "The policy is below the minimum period.",
          "RETENTION_TOO_SHORT",
        );
      if (company.legalHold && !dryRun)
        throw new AppError(
          423,
          "A legal hold is active; nothing is removed.",
          "LEGAL_HOLD",
        );
      const cutoff = new Date(new Date().toISOString().slice(0, 10));
      cutoff.setUTCDate(cutoff.getUTCDate() - policy.retainDays);
      const count = dryRun
        ? await affected(tx, companyId, category, cutoff)
        : await apply(tx, companyId, category, cutoff);
      await tx.retentionRun.create({
        data: { companyId, category, cutoff, dryRun, affected: count, runBy },
      });
      if (ctx && !dryRun)
        await audit(
          tx,
          ctx,
          "RETENTION_RUN",
          "retention_policies",
          policy.id,
          undefined,
          {
            category,
            affected: count,
            cutoff: cutoff.toISOString().slice(0, 10),
          },
        );
      return { category, cutoff, dryRun, affected: count };
    },
    { timeout: 120000 },
  );
}
