import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Context } from "@/modules/auth/service";

// The employee record linked to the signed-in user, if any.
export function linkedEmployee(ctx: Context) {
  return db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true, managerId: true, firstName: true, lastName: true },
  });
}
export async function requireLinkedEmployee(ctx: Context) {
  const e = await linkedEmployee(ctx);
  if (!e)
    throw new AppError(
      403,
      "Your account needs a linked employee record. Contact HR.",
    );
  return e;
}
// IDs of employees who report directly to the signed-in user.
export async function directReportIds(ctx: Context) {
  const me = await linkedEmployee(ctx);
  if (!me) return [];
  return (
    await db.employee.findMany({
      where: { companyId: ctx.companyId, managerId: me.id },
      select: { id: true },
    })
  ).map((e) => e.id);
}
