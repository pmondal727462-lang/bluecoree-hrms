import { db } from "@/lib/db";
import { requirePermission, type Context } from "@/modules/auth/service";
export async function dashboard(ctx: Context) {
  requirePermission(ctx, "dashboard.read");
  const now = new Date(),
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const where = { companyId: ctx.companyId };
  const [
    total,
    active,
    newHires,
    onNotice,
    departments,
    recent,
    activity,
    headcount,
  ] = await Promise.all([
    db.employee.count({ where }),
    db.employee.count({
      where: { ...where, status: { in: ["Active", "Probation"] } },
    }),
    db.employee.count({
      where: { ...where, joinedAt: { gte: start, lte: now } },
    }),
    db.employee.count({ where: { ...where, status: "On notice" } }),
    db.department.findMany({
      where,
      select: {
        name: true,
        _count: {
          select: { employees: { where: { status: { not: "Inactive" } } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        status: true,
        joinedAt: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    ctx.permissions.includes("audit.read")
      ? db.auditLog.findMany({
          where,
          take: 5,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            actorName: true,
            action: true,
            module: true,
            createdAt: true,
          },
        })
      : [],
    Promise.all(
      Array.from({ length: 6 }, (_, i) => {
        const date = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i + 1, 1),
        );
        return db.employee
          .count({ where: { ...where, joinedAt: { lt: date } } })
          .then((count) => ({
            month: new Date(
              Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
            ).toLocaleDateString("en", { month: "short", timeZone: "UTC" }),
            count,
          }));
      }),
    ),
  ]);
  return {
    total,
    active,
    newHires,
    onNotice,
    departments: departments.map((d) => ({
      name: d.name,
      count: d._count.employees,
    })),
    recent,
    activity,
    headcount,
  };
}
