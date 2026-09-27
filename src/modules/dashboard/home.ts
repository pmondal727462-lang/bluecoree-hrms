import { db } from "@/lib/db";
import type { Context } from "@/modules/auth/service";
import { dayDate, localDay } from "@/modules/time/rules";
import { balances } from "@/modules/time/service";
import { visibleAnnouncements } from "@/modules/announcements/service";
import { directReportIds } from "@/modules/shared/team";
import { myTraining } from "@/modules/training/service";

// Employee self-service home: each block appears only when the user's
// permissions allow it.
export async function home(ctx: Context) {
  const has = (p: string) => ctx.permissions.includes(p);
  const company = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
  });
  const today = localDay(new Date(), company.timezone);
  const me = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    include: {
      department: { select: { name: true } },
      designation: { select: { name: true } },
      shift: { select: { name: true, startMinute: true, endMinute: true } },
    },
  });
  const team = await directReportIds(ctx);
  const in30 = new Date(Date.now() + 30 * 86400000);
  const [
    attendance,
    leave,
    holidays,
    payslip,
    announcements,
    documents,
    tickets,
    expenses,
    reviews,
    goals,
    unread,
  ] = await Promise.all([
    me && has("attendance.self")
      ? db.attendance.findFirst({
          where: {
            companyId: ctx.companyId,
            employeeId: me.id,
            workDate: dayDate(today),
          },
        })
      : null,
    me && has("timeoff.self")
      ? balances(ctx, me.id, Number(today.slice(0, 4)))
      : null,
    db.holiday.findMany({
      where: { companyId: ctx.companyId, date: { gte: dayDate(today) } },
      orderBy: { date: "asc" },
      take: 5,
    }),
    me && has("payroll.self")
      ? db.payslip.findFirst({
          where: { companyId: ctx.companyId, employeeId: me.id },
          orderBy: { periodEnd: "desc" },
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            netPay: true,
            currency: true,
          },
        })
      : null,
    visibleAnnouncements(ctx, 5),
    me && has("documents.self")
      ? Promise.all([
          db.document.count({
            where: {
              companyId: ctx.companyId,
              requiresAcknowledgement: true,
              status: "APPROVED",
              visibility: { not: "HR_ONLY" },
              OR: [
                { employeeId: null, visibility: "ALL_EMPLOYEES" },
                { employeeId: me.id },
              ],
              acknowledgements: { none: { employeeId: me.id } },
            },
          }),
          db.document.count({
            where: {
              companyId: ctx.companyId,
              employeeId: me.id,
              expiresOn: { lte: in30 },
            },
          }),
          db.document.count({
            where: {
              companyId: ctx.companyId,
              employeeId: me.id,
              status: "REJECTED",
            },
          }),
        ]).then(([toAcknowledge, expiringSoon, rejected]) => ({
          toAcknowledge,
          expiringSoon,
          rejected,
        }))
      : null,
    me && has("helpdesk.self")
      ? db.helpdeskTicket.count({
          where: {
            companyId: ctx.companyId,
            employeeId: me.id,
            status: { notIn: ["RESOLVED", "CLOSED"] },
          },
        })
      : null,
    me && has("expenses.self")
      ? db.expenseClaim.groupBy({
          by: ["status"],
          where: {
            companyId: ctx.companyId,
            employeeId: me.id,
            status: { in: ["SUBMITTED", "MANAGER_APPROVED", "APPROVED"] },
          },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : null,
    me && has("performance.self")
      ? db.performanceReview.count({
          where: {
            companyId: ctx.companyId,
            employeeId: me.id,
            status: "PENDING_SELF",
            cycle: { status: "ACTIVE" },
          },
        })
      : null,
    me && has("performance.self")
      ? db.goal.count({
          where: {
            companyId: ctx.companyId,
            employeeId: me.id,
            status: { in: ["DRAFT", "APPROVED"] },
          },
        })
      : null,
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  // Things waiting for this user's decision.
  const approvals = {
    leave: has("timeoff.manage")
      ? await db.leaveRequest.count({
          where: { companyId: ctx.companyId, status: "Pending" },
        })
      : team.length && has("timeoff.team.read")
        ? await db.leaveRequest.count({
            where: {
              companyId: ctx.companyId,
              status: "Pending",
              employeeId: { in: team },
            },
          })
        : 0,
    expenses: has("expenses.manage")
      ? await db.expenseClaim.count({
          where: {
            companyId: ctx.companyId,
            status: { in: ["SUBMITTED", "MANAGER_APPROVED"] },
          },
        })
      : team.length && has("expenses.approve")
        ? await db.expenseClaim.count({
            where: {
              companyId: ctx.companyId,
              status: "SUBMITTED",
              employeeId: { in: team },
            },
          })
        : 0,
    missedPunches: has("attendance.manage")
      ? await db.attendanceRegularization.count({
          where: { companyId: ctx.companyId, status: "Pending" },
        })
      : 0,
    documents: has("documents.manage")
      ? await db.document.count({
          where: { companyId: ctx.companyId, status: "PENDING_APPROVAL" },
        })
      : 0,
    helpdesk: has("helpdesk.manage")
      ? await db.helpdeskTicket.count({
          where: {
            companyId: ctx.companyId,
            status: { in: ["OPEN", "ASSIGNED"] },
          },
        })
      : 0,
    reviews:
      team.length && has("performance.team")
        ? await db.performanceReview.count({
            where: {
              companyId: ctx.companyId,
              status: "PENDING_MANAGER",
              employeeId: { in: team },
              cycle: { status: "ACTIVE" },
            },
          })
        : 0,
  };
  return {
    today,
    timezone: company.timezone,
    employee: me && {
      id: me.id,
      name: `${me.firstName} ${me.lastName}`,
      employeeCode: me.employeeCode,
      department: me.department?.name ?? null,
      designation: me.designation?.name ?? null,
      shift: me.shift,
    },
    attendance,
    leave,
    holidays,
    payslip,
    announcements,
    documents,
    openTickets: tickets,
    expenses:
      expenses?.map((e) => ({
        status: e.status,
        count: e._count._all,
        amount: e._sum.amount ?? 0,
      })) ?? null,
    pendingSelfReviews: reviews,
    activeGoals: goals,
    training:
      me && has("training.self")
        ? await myTraining(ctx).then((t) =>
            t
              ? {
                  upcoming: t.upcoming.slice(0, 3).map((u) => ({
                    course: u.session.course.title,
                    startsAt: u.session.startsAt,
                  })),
                  expiring: t.certifications.filter((c) => c.state !== "VALID")
                    .length,
                  completed: t.completed,
                }
              : null,
          )
        : null,
    unreadNotifications: unread,
    approvals,
  };
}
