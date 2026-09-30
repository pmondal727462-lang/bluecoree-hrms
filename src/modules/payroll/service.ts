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
    const query = z
      .object({
        period: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        search: z.string().trim().max(100).default(""),
        page: z.coerce.number().int().min(1).max(100000).optional(),
      })
      .parse(Object.fromEntries(req.nextUrl.searchParams));
    const start = query.period
      ? new Date(`${query.period}-01T00:00:00Z`)
      : undefined;
    const end = start
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
      : undefined;
    const where = {
      companyId: ctx.companyId,
      ...(employee ? { employeeId: employee.id } : {}),
      ...(start ? { periodEnd: { gte: start, lt: end } } : {}),
      ...(!own && query.search
        ? {
            employee: {
              OR: [
                {
                  employeeCode: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  firstName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  lastName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          }
        : {}),
    };
    const items = await db.payslip.findMany({
      where,
      select,
      orderBy: [{ periodEnd: "desc" }, { id: "asc" }],
      take: query.page ? 25 : 100,
      ...(query.page ? { skip: (query.page - 1) * 25 } : {}),
    });
    return query.page
      ? {
          items,
          total: await db.payslip.count({ where }),
          page: query.page,
          pageSize: 25,
        }
      : items;
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
