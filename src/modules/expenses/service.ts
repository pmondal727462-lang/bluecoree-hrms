import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";
import { dayDate, localDay } from "@/modules/time/rules";
import { directReportIds, requireLinkedEmployee } from "@/modules/shared/team";
import { notify } from "@/modules/notifications/service";

const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    limitPerClaim: z.number().positive().max(10000000).nullable(),
    requiresReceipt: z.boolean(),
    active: z.boolean(),
  })
  .strict();
const claimSchema = z
  .object({
    categoryId: z.string().min(1),
    expenseDate: z.iso.date(),
    amount: z.number().positive().max(10000000),
    currency: z.string().trim().length(3).default("INR"),
    merchant: z.string().trim().max(120).optional(),
    description: z.string().trim().min(3).max(1000),
    receipt: z
      .object({
        name: z.string().min(1).max(200),
        type: z.string().max(100),
        base64: z.string().max(2_900_000),
      })
      .strict()
      .optional(),
  })
  .strict();
const reviewSchema = z
  .object({
    action: z.enum(["approve", "reject", "cancel", "reimburse"]),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
const claimSelect = {
  id: true,
  employeeId: true,
  expenseDate: true,
  amount: true,
  currency: true,
  merchant: true,
  description: true,
  receiptName: true,
  receiptSize: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  managerApprovedAt: true,
  managerNote: true,
  reimbursedAt: true,
  payrollRunId: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      userId: true,
      managerId: true,
    },
  },
} as const;

// Standard categories (spec §31); companies can edit or add their own.
const defaultCategories = [
  ["Travel", null, true],
  ["Food", 2000, true],
  ["Hotel", null, true],
  ["Fuel", null, true],
  ["Mobile", 1500, false],
  ["Other", null, true],
] as const;
// The manager's approval comes first when the employee reports to someone
// who can approve expenses; finance then approves. Without such a manager,
// finance approves directly.
async function approvingManager(employeeId: string) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      manager: {
        select: {
          user: {
            select: {
              id: true,
              active: true,
              role: {
                select: {
                  permissions: {
                    where: {
                      permissionKey: {
                        in: ["expenses.approve", "expenses.manage"],
                      },
                    },
                    select: { permissionKey: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const u = e?.manager?.user;
  return u?.active && u.role.permissions.length ? u.id : null;
}
async function canReview(ctx: Context, employeeId: string) {
  if (ctx.permissions.includes("expenses.manage")) return true;
  return (
    ctx.permissions.includes("expenses.approve") &&
    (await directReportIds(ctx)).includes(employeeId)
  );
}

export async function expensesRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  const method = req.method;
  if (
    !["expenses.self", "expenses.approve", "expenses.manage"].some((p) =>
      ctx.permissions.includes(p),
    )
  )
    throw new AppError(403, "You do not have access to expenses.", "FORBIDDEN");

  if (resource === "categories" && id === "defaults" && method === "POST") {
    requirePermission(ctx, "expenses.manage");
    return db.$transaction(async (tx) => {
      const existing = await tx.expenseCategory.findMany({
        where: { companyId: ctx.companyId },
        select: { name: true },
      });
      const have = new Set(existing.map((c) => c.name.toLowerCase()));
      const added: string[] = [];
      for (const [name, limitPerClaim, requiresReceipt] of defaultCategories) {
        if (have.has(name.toLowerCase())) continue;
        await tx.expenseCategory.create({
          data: {
            companyId: ctx.companyId,
            name,
            limitPerClaim,
            requiresReceipt,
          },
        });
        added.push(name);
      }
      await audit(
        tx,
        ctx,
        "CREATE",
        "expense_categories",
        ctx.companyId,
        undefined,
        { added },
        ip(req),
      );
      return { added };
    });
  }
  if (resource === "categories") {
    if (method === "GET")
      return db.expenseCategory.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { name: "asc" },
      });
    requirePermission(ctx, "expenses.manage");
    const b = categorySchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = id
        ? await tx.expenseCategory.findFirst({
            where: { id, companyId: ctx.companyId },
          })
        : null;
      if (id && !old) throw new AppError(404, "Category not found.");
      const saved = old
        ? await tx.expenseCategory.update({ where: { id: old.id }, data: b })
        : await tx.expenseCategory.create({
            data: { ...b, companyId: ctx.companyId },
          });
      await audit(
        tx,
        ctx,
        old ? "UPDATE" : "CREATE",
        "expense_categories",
        saved.id,
        old ?? undefined,
        b,
        ip(req),
      );
      return saved;
    });
  }

  if (resource !== "claims") throw new AppError(404, "Endpoint not found.");
  if (!id && method === "GET") {
    const scope = z
      .enum(["own", "team", "company"])
      .default("own")
      .parse(req.nextUrl.searchParams.get("scope") ?? undefined);
    const status = req.nextUrl.searchParams.get("status");
    let employeeFilter: Prisma.ExpenseClaimWhereInput;
    if (scope === "company") {
      requirePermission(ctx, "expenses.manage");
      employeeFilter = {};
    } else if (scope === "team") {
      requirePermission(ctx, "expenses.approve");
      employeeFilter = { employeeId: { in: await directReportIds(ctx) } };
    } else {
      requirePermission(ctx, "expenses.self");
      employeeFilter = { employeeId: (await requireLinkedEmployee(ctx)).id };
    }
    return db.expenseClaim.findMany({
      where: {
        companyId: ctx.companyId,
        ...employeeFilter,
        ...(status ? { status } : {}),
      },
      select: claimSelect,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
  if (!id && method === "POST") {
    requirePermission(ctx, "expenses.self");
    await rateLimit(`expense:${ctx.userId}`, 30);
    const b = claimSchema.parse(await json(req, 3_000_000));
    const me = await requireLinkedEmployee(ctx);
    const [category, company] = await Promise.all([
      db.expenseCategory.findFirst({
        where: { id: b.categoryId, companyId: ctx.companyId, active: true },
      }),
      db.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
    ]);
    if (!category)
      throw new AppError(404, "Active expense category not found.");
    if (b.expenseDate > localDay(new Date(), company.timezone))
      throw new AppError(422, "The expense date cannot be in the future.");
    if (category.limitPerClaim !== null && b.amount > category.limitPerClaim)
      throw new AppError(
        422,
        `${category.name} claims are limited to ${category.limitPerClaim} per claim.`,
      );
    if (category.requiresReceipt && !b.receipt)
      throw new AppError(422, `A receipt is required for ${category.name}.`);
    const file = b.receipt ? validateUpload(b.receipt) : null;
    if (file) await assertStorage(ctx.companyId, file.bytes.length);
    const submitted = await db.$transaction(async (tx) => {
      const saved = await tx.expenseClaim.create({
        data: {
          companyId: ctx.companyId,
          employeeId: me.id,
          categoryId: category.id,
          expenseDate: dayDate(b.expenseDate),
          amount: Math.round(b.amount * 100) / 100,
          currency: b.currency,
          merchant: b.merchant,
          description: b.description,
          ...(file
            ? {
                receiptName: file.name,
                receiptType: file.type,
                receiptSize: file.bytes.length,
                receiptData: file.bytes,
              }
            : {}),
        },
        select: claimSelect,
      });
      await audit(
        tx,
        ctx,
        "SUBMIT",
        "expense_claims",
        saved.id,
        undefined,
        { amount: saved.amount, category: category.name },
        ip(req),
      );
      return saved;
    });
    const manager = me.managerId
      ? await db.employee.findUnique({
          where: { id: me.managerId },
          select: { userId: true },
        })
      : null;
    await notify(
      ctx.companyId,
      [manager?.userId],
      "expense.submitted",
      {
        employee: ctx.name,
        category: category.name,
        amount: `${b.currency} ${b.amount}`,
      },
      "/expenses",
    );
    return submitted;
  }
  const claim = await db.expenseClaim.findFirst({
    where: { id, companyId: ctx.companyId },
    select: { ...claimSelect, receiptType: true },
  });
  if (!claim) throw new AppError(404, "Expense claim not found.");
  const mine = claim.employee.userId === ctx.userId;
  if (action === "receipt" && method === "GET") {
    if (!mine && !(await canReview(ctx, claim.employeeId)))
      throw new AppError(404, "Expense claim not found.");
    const row = await db.expenseClaim.findUniqueOrThrow({
      where: { id: claim.id },
      select: { receiptData: true },
    });
    if (!row.receiptData) throw new AppError(404, "No receipt attached.");
    return new NextResponse(new Uint8Array(row.receiptData), {
      headers: {
        "content-type": claim.receiptType ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${(claim.receiptName ?? "receipt").replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "no-store",
      },
    });
  }
  if (!action && method === "PUT") {
    const b = reviewSchema.parse(await json(req));
    const reviewed = await db.$transaction(async (tx) => {
      const current = await tx.expenseClaim.findUniqueOrThrow({
        where: { id: claim.id },
        include: { payrollRun: { select: { status: true } } },
      });
      let data: Prisma.ExpenseClaimUncheckedUpdateInput;
      if (b.action === "cancel") {
        if (!mine)
          throw new AppError(403, "Only the employee can cancel a claim.");
        if (!["SUBMITTED", "MANAGER_APPROVED"].includes(current.status))
          throw new AppError(
            409,
            "Only claims awaiting approval can be cancelled.",
          );
        data = { status: "CANCELLED" };
      } else if (b.action === "reimburse") {
        requirePermission(ctx, "expenses.manage");
        if (current.status !== "APPROVED")
          throw new AppError(409, "Only approved claims can be reimbursed.");
        if (current.payrollRun?.status === "PROCESSED")
          throw new AppError(
            409,
            "This claim was already paid through payroll.",
          );
        data = {
          status: "REIMBURSED",
          reimbursedAt: new Date(),
          // Paid directly, so no payroll run carries it. Disconnecting the
          // composite relation would also clear companyId.
          payrollRunId: null,
        };
      } else {
        if (mine)
          throw new AppError(
            403,
            "Another approver must review your own claim.",
          );
        if (!(await canReview(ctx, current.employeeId)))
          throw new AppError(403, "You cannot review this claim.");
        if (b.action === "reject" && !b.note)
          throw new AppError(422, "Give a reason for rejecting the claim.");
        const manager = await approvingManager(current.employeeId);
        const finance = ctx.permissions.includes("expenses.manage");
        if (current.status === "SUBMITTED" && manager) {
          // Manager stage.
          if (manager !== ctx.userId)
            throw new AppError(
              403,
              "The employee's manager approves this claim first.",
              "MANAGER_FIRST",
            );
          data =
            b.action === "approve"
              ? {
                  status: "MANAGER_APPROVED",
                  managerApprovedBy: ctx.userId,
                  managerApprovedAt: new Date(),
                  managerNote: b.note,
                }
              : {
                  status: "REJECTED",
                  reviewedBy: ctx.userId,
                  reviewNote: b.note,
                  reviewedAt: new Date(),
                };
        } else if (
          current.status === "MANAGER_APPROVED" ||
          (current.status === "SUBMITTED" && !manager)
        ) {
          // Finance stage, by someone other than the manager who approved.
          if (!finance)
            throw new AppError(
              403,
              "Finance approves the claim at this stage.",
              "FINANCE_STAGE",
            );
          if (current.managerApprovedBy === ctx.userId)
            throw new AppError(
              403,
              "A different person must give the finance approval.",
              "SAME_APPROVER",
            );
          data = {
            status: b.action === "approve" ? "APPROVED" : "REJECTED",
            reviewedBy: ctx.userId,
            reviewNote: b.note,
            reviewedAt: new Date(),
          };
        } else throw new AppError(409, "This claim has already been reviewed.");
      }
      const saved = await tx.expenseClaim.update({
        where: { id: claim.id },
        data,
        select: claimSelect,
      });
      await audit(
        tx,
        ctx,
        b.action.toUpperCase(),
        "expense_claims",
        claim.id,
        { status: current.status },
        { status: saved.status, note: b.note },
        ip(req),
      );
      return saved;
    });
    if (["approve", "reject", "reimburse"].includes(b.action))
      await notify(
        ctx.companyId,
        [claim.employee.userId],
        "expense.reviewed",
        {
          category: claim.category.name,
          amount: `${claim.currency} ${claim.amount}`,
          status: reviewed.status.toLowerCase(),
          note: b.note,
        },
        "/expenses",
      );
    return reviewed;
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
