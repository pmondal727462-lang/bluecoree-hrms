import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { json, requirePermission, type Context } from "@/modules/auth/service";
import { AppError } from "@/lib/errors";

const date = z.iso.date();
const createSchema = z
  .object({
    employeeId: z.string().min(1),
    periodStart: date,
    periodEnd: date,
    grossPay: z.number().finite().min(0),
    deductions: z.number().finite().min(0).default(0),
    netPay: z.number().finite().min(0),
    currency: z.string().trim().min(3).max(6).default("INR"),
  })
  .strict();
const select = {
  id: true,
  periodStart: true,
  periodEnd: true,
  grossPay: true,
  deductions: true,
  netPay: true,
  currency: true,
  issuedAt: true,
  breakdown: true,
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  },
} as const;

import { enqueueWebhook } from "@/modules/integrations/outbound";
export async function payrollRoute(
  req: NextRequest,
  ctx: Context,
  id?: string,
) {
  if (req.method === "GET") {
    const own =
      ctx.permissions.includes("payroll.self") &&
      !ctx.permissions.includes("payroll.read");
    if (!own) requirePermission(ctx, "payroll.read");
    const employee = own
      ? await db.employee.findFirst({
          where: { companyId: ctx.companyId, userId: ctx.userId },
          select: { id: true },
        })
      : null;
    if (own && !employee)
      throw new AppError(
        403,
        "Your account is not linked to an employee record.",
      );
    return db.payslip.findMany({
      where: {
        companyId: ctx.companyId,
        ...(employee ? { employeeId: employee.id } : {}),
      },
      select,
      orderBy: { periodStart: "desc" },
      take: 100,
    });
  }
  requirePermission(ctx, "payroll.manage");
  if (req.method === "POST") {
    const b = createSchema.parse(await json(req));
    const employee = await db.employee.findFirst({
      where: { id: b.employeeId, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, "Employee not found.");
    if (b.netPay > b.grossPay)
      throw new AppError(422, "Net pay cannot exceed gross pay.");
    return db.$transaction(async (tx) => {
      const saved = await tx.payslip.create({
        data: {
          ...b,
          companyId: ctx.companyId,
          periodStart: new Date(b.periodStart),
          periodEnd: new Date(b.periodEnd),
        },
        select,
      });
      await enqueueWebhook(tx, ctx.companyId, "payslip.generated", {
        id: saved.id,
        employeeId: b.employeeId,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
      });
      return saved;
    });
  }
  throw new AppError(405, "Method not allowed.");
}
