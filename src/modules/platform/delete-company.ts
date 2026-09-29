import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { db, withSystem } from "@/lib/db";
import { AppError, logger } from "@/lib/errors";
import { deleteFile } from "@/lib/storage";
import { ip, json, type Context } from "@/modules/auth/service";
import { companyDeletionOrder } from "./company-deletion-order";

export function companyDeletionBlock(
  company: { id: string; legalHold: boolean },
  currentCompanyId: string,
  hasPlatformOwner: boolean,
) {
  if (company.id === currentCompanyId)
    return "You cannot delete the company you are signed in to.";
  if (hasPlatformOwner)
    return "Move platform owner accounts to another company before deleting this company.";
  if (company.legalHold) return "This company is under a legal hold.";
  return null;
}

export async function deleteCompany(
  req: NextRequest,
  ctx: Context,
  id: string,
) {
  if (!ctx.isSuperAdmin)
    throw new AppError(403, "Super Admin access is required.");
  const body = z
    .object({ companyCode: z.string().min(1).max(100) })
    .strict()
    .parse(await json(req));
  const result = await db.$transaction(
    async (tx) => {
      // Lock the tenant before checking protection and collecting file references.
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${id} FOR UPDATE`;
      const company = await tx.company.findUnique({ where: { id } });
      if (!company) throw new AppError(404, "Company not found.");
      const owner = await tx.user.findFirst({
        where: { companyId: id, isSuperAdmin: true },
        select: { id: true },
      });
      const blocked = companyDeletionBlock(company, ctx.companyId, !!owner);
      if (blocked) throw new AppError(409, blocked);
      if (body.companyCode !== company.code)
        throw new AppError(
          422,
          "Type the exact company code to confirm deletion.",
        );

      const where = { companyId: id };
      if (
        await tx.auditLog.count({
          where: {
            ...where,
            action: "COMPANY_DELETED",
            newValue: { path: ["pendingFiles"], not: [] },
          },
        })
      )
        throw new AppError(
          409,
          "This company has pending file cleanup from an earlier deletion. Complete that cleanup first.",
        );
      const versions = await tx.documentVersion.findMany({
        where,
        select: { storageKey: true },
      });
      const attachments = await tx.helpdeskMessage.findMany({
        where,
        select: { storageKey: true },
      });
      const photos = await tx.employee.findMany({
        where: { ...where, photoKey: { not: null } },
        select: { photoKey: true },
      });
      const pendingFiles = [
        ...new Set(
          [
            ...versions.map((v) => v.storageKey),
            ...attachments.map((v) => v.storageKey),
            ...photos.map((v) => v.photoKey),
          ].filter((key): key is string => !!key),
        ),
      ];
      if (pendingFiles.some((key) => !key.startsWith(`${id}/`)))
        throw new AppError(
          409,
          "A stored file has an unexpected company reference. Resolve it before deletion.",
        );

      // Self references must be detached; all other tenant children are removed
      // before their parents. Session, role-permission and AI-message rows cascade.
      await tx.employee.updateMany({ where, data: { managerId: null } });
      await tx.goal.updateMany({ where, data: { parentId: null } });
      for (const model of companyDeletionOrder) {
        const delegate = tx[model] as unknown as {
          deleteMany(args: {
            where: { companyId: string };
          }): Promise<{ count: number }>;
        };
        await delegate.deleteMany({ where });
      }
      await tx.company.delete({ where: { id } });
      // Keep the deletion record and durable file-cleanup work in the operator's
      // company, so neither disappears with the deleted tenant.
      const log = await tx.auditLog.create({
        data: {
          companyId: ctx.companyId,
          actorId: ctx.userId,
          actorName: ctx.name,
          action: "COMPANY_DELETED",
          module: "companies",
          recordId: id,
          ip: ip(req),
          oldValue: { code: company.code, name: company.name },
          newValue: { pendingFiles, filesRemoved: 0 },
        },
      });
      return {
        id,
        code: company.code,
        cleanupId: log.id,
        pendingFiles: pendingFiles.length,
      };
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );

  // Storage is not transactional. Only remove files after commit, and leave
  // failed work durable for the scheduled retry instead of reporting rollback.
  let pendingFiles = result.pendingFiles;
  try {
    pendingFiles = await cleanCompanyFiles(result.cleanupId);
  } catch (error) {
    logger.error(
      { error: String(error), cleanupId: result.cleanupId },
      "Company file cleanup will retry",
    );
  }
  return { id: result.id, code: result.code, deleted: true, pendingFiles };
}

const cleanupState = z.object({
  pendingFiles: z.array(z.string()),
  filesRemoved: z.number(),
});
async function cleanCompanyFiles(auditId: string) {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM audit_logs WHERE id = ${auditId} FOR UPDATE`;
      const log = await tx.auditLog.findUniqueOrThrow({
        where: { id: auditId },
      });
      if (log.action !== "COMPANY_DELETED" || !log.recordId)
        throw new Error("Invalid cleanup record");
      const state = cleanupState.parse(log.newValue);
      const remaining = state.pendingFiles.slice(25);
      for (const key of state.pendingFiles.slice(0, 25)) {
        try {
          if (!key.startsWith(`${log.recordId}/`))
            throw new Error("Invalid company file key");
          await deleteFile(key);
          state.filesRemoved++;
        } catch {
          remaining.push(key);
        }
      }
      await tx.auditLog.update({
        where: { id: auditId },
        data: { newValue: { ...state, pendingFiles: remaining } },
      });
      return remaining.length;
    },
    { timeout: 30000 },
  );
}

export async function cleanupDeletedCompanyFiles() {
  return withSystem(async () => {
    const logs = await db.auditLog.findMany({
      where: {
        action: "COMPANY_DELETED",
        newValue: { path: ["pendingFiles"], not: [] },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let pendingFiles = 0;
    for (const log of logs) {
      try {
        pendingFiles += await cleanCompanyFiles(log.id);
      } catch (error) {
        logger.error(
          { error: String(error), cleanupId: log.id },
          "Company file cleanup failed",
        );
      }
    }
    return { processed: logs.length, pendingFiles };
  });
}
