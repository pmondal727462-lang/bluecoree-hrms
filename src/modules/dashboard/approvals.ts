import { db } from "@/lib/db";
import type { Context } from "@/modules/auth/service";
import { directReportIds } from "@/modules/shared/team";
import { entitlements } from "@/modules/saas/service";
import { permissionFeature } from "@/lib/module-access";

// Leave requests and expense claims this user can decide now, for the mobile
// approvals screen. Other workflows are counted on the home dashboard.
export async function pendingApprovals(ctx: Context) {
  const access = await entitlements(ctx.companyId);
  const allowed = (feature: string) =>
    access.sub.status !== "EXPIRED" && access.features.has(feature);
  const has = (p: string) =>
    ctx.permissions.includes(p) &&
    (!permissionFeature(p) || allowed(permissionFeature(p)!));
  const team = await directReportIds(ctx);
  const person = {
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  };
  const [leave, expenses] = await Promise.all([
    allowed("attendance") && (has("timeoff.manage") || team.length)
      ? db.leaveRequest.findMany({
          where: {
            companyId: ctx.companyId,
            status: "Pending",
            ...(has("timeoff.manage") ? {} : { employeeId: { in: team } }),
            employee: { userId: { not: ctx.userId } },
          },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            days: true,
            halfDay: true,
            level: true,
            createdAt: true,
            leaveType: { select: { name: true } },
            employee: person,
          },
          orderBy: { createdAt: "asc" },
          take: 100,
        })
      : [],
    has("expenses.manage") || (has("expenses.approve") && team.length)
      ? db.expenseClaim.findMany({
          where: {
            companyId: ctx.companyId,
            employee: { userId: { not: ctx.userId } },
            OR: [
              ...(has("expenses.approve") && team.length
                ? [{ status: "SUBMITTED", employeeId: { in: team } }]
                : []),
              ...(has("expenses.manage")
                ? [{ status: "MANAGER_APPROVED" }]
                : []),
            ],
          },
          select: {
            id: true,
            amount: true,
            currency: true,
            expenseDate: true,
            description: true,
            status: true,
            category: { select: { name: true } },
            employee: person,
          },
          orderBy: { createdAt: "asc" },
          take: 100,
        })
      : [],
  ]);
  return { leave, expenses };
}
