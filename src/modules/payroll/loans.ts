import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";

const money = z.number().finite().positive().max(100000000);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const createSchema = z
  .object({
    employeeId: z.string().min(1),
    kind: z.enum(["LOAN", "ADVANCE"]),
    principal: money,
    // An advance is recovered in one instalment unless told otherwise.
    instalment: money.optional(),
    startPeriod: period,
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const updateSchema = z
  .object({
    instalment: money.optional(),
    status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

// Salary loans and advances (spec §23), recovered by payroll in monthly
// instalments; repayments are recorded when a run is processed.
export async function loansRoute(
  req: NextRequest,
  ctx: Context,
  id: string | undefined,
) {
  if (req.method === "GET") {
    requirePermission(ctx, "payroll.read");
    if (id) {
      const loan = await db.employeeLoan.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
          repayments: {
            orderBy: { createdAt: "asc" },
            include: { run: { select: { period: true } } },
          },
        },
      });
      if (!loan) throw new AppError(404, "Loan not found.", "NOT_FOUND");
      return loan;
    }
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const status = req.nextUrl.searchParams.get("status");
    return db.employeeLoan.findMany({
      where: {
        companyId: ctx.companyId,
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true },
        },
        repayments: {
          orderBy: { createdAt: "asc" },
          include: { run: { select: { period: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
  requirePermission(ctx, "payroll.manage");
  if (req.method === "POST" && !id) {
    const b = createSchema.parse(await json(req));
    const instalment = b.instalment ?? (b.kind === "ADVANCE" ? b.principal : 0);
    if (!instalment)
      throw new AppError(422, "Give the monthly instalment for a loan.");
    if (instalment > b.principal)
      throw new AppError(422, "The instalment cannot exceed the amount.");
    return db.$transaction(async (tx) => {
      const e = await tx.employee.findFirst({
        where: { id: b.employeeId, companyId: ctx.companyId },
      });
      if (!e) throw new AppError(404, "Employee not found.");
      const saved = await tx.employeeLoan.create({
        data: {
          companyId: ctx.companyId,
          employeeId: e.id,
          kind: b.kind,
          principal: b.principal,
          instalment,
          balance: b.principal,
          startPeriod: b.startPeriod,
          note: b.note,
          createdBy: ctx.userId,
        },
      });
      await audit(
        tx,
        ctx,
        "CREATE",
        "employee_loans",
        saved.id,
        undefined,
        { employeeId: e.id, kind: b.kind, startPeriod: b.startPeriod },
        ip(req),
      );
      return saved;
    });
  }
  if (req.method === "PUT" && id) {
    const b = updateSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = await tx.employeeLoan.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!old) throw new AppError(404, "Loan not found.");
      if (old.status === "CLOSED" && old.balance <= 0)
        throw new AppError(409, "This loan is fully repaid.");
      if (b.instalment && b.instalment > old.principal)
        throw new AppError(422, "The instalment cannot exceed the amount.");
      const saved = await tx.employeeLoan.update({
        where: { id: old.id },
        data: b,
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "employee_loans",
        old.id,
        { status: old.status, instalment: old.instalment },
        { status: saved.status, instalment: saved.instalment },
        ip(req),
      );
      return saved;
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
