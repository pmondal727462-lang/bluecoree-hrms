import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Context } from "@/modules/auth/service";
import { dayDate, localDay } from "@/modules/time/rules";
import { balances } from "@/modules/time/leave-balance";
import { planSchema, type QueryPlan, type QueryResult } from "./contracts";

export function localPlan(question: string): QueryPlan | null {
  const q = question.toLowerCase();
  if (
    /\b(last|yesterday|tomorrow|week|year|between|since)\b|\d{4}-\d{2}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
      q,
    )
  )
    return null;
  const scope = /\b(team|reports)\b/.test(q)
    ? "team"
    : /\b(my|i|me)\b/.test(q)
      ? "own"
      : "company";
  const period = /month/.test(q) ? "month" : "today";
  let intent: QueryPlan["intent"] | undefined;
  if (/onboarding|joiner/.test(q)) intent = "onboarding_status";
  else if (/expir/.test(q) && /document/.test(q)) intent = "expiring_documents";
  else if (/training|course|certificat/.test(q)) intent = "training_status";
  else if (/\basset|laptop|equipment/.test(q)) intent = "my_assets";
  else if (/payslip/.test(q)) intent = "payslip_location";
  else if (/payroll/.test(q)) intent = "payroll_summary";
  else if (/recruitment|pipeline|candidate|hiring/.test(q))
    intent = "recruitment_pipeline";
  else if (/bank/.test(q)) intent = "bank_details";
  else if (/apply.*leave|request.*leave/.test(q)) intent = "apply_leave";
  else if (/leave.*policy/.test(q)) intent = "leave_policy";
  else if (/leave.*balance/.test(q)) intent = "leave_balance";
  else if (/holiday/.test(q)) intent = "holidays";
  else if (/check.?in/.test(q)) intent = "check_in";
  else if (/pending|approval/.test(q)) intent = "approvals";
  else if (/on leave/.test(q)) intent = "on_leave";
  else if (/absent/.test(q)) intent = "absent";
  else if (/late/.test(q) && /times|repeated|more than/.test(q))
    intent = "repeated_late";
  else if (/late/.test(q)) intent = "late";
  else if (/department/.test(q) && /headcount|highest|count/.test(q))
    intent = "departments";
  else if (/active.*employee|employee.*active|headcount/.test(q))
    intent = "headcount";
  else if (/summary|summarize|report/.test(q) && /attendance|hr report/.test(q))
    intent = "attendance_summary";
  else if (/attendance/.test(q)) intent = "attendance";
  if (!intent) return null;
  const moreThan = Number(q.match(/more than\s+(\d+)/)?.[1] ?? 3);
  const parsed = planSchema.safeParse({ intent, scope, period, moreThan });
  return parsed.success ? parsed.data : null;
}

const eligible = ["Active", "Probation", "On notice"];
const person = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
} as const;
type Tx = Prisma.TransactionClient;
async function scopeWhere(
  tx: Tx,
  ctx: Context,
  plan: QueryPlan,
  domain: "attendance" | "timeoff",
): Promise<Prisma.EmployeeWhereInput> {
  const base = { companyId: ctx.companyId };
  if (plan.scope === "company") {
    requirePermission(
      ctx,
      domain === "attendance" ? "attendance.read" : "timeoff.manage",
    );
    return base;
  }
  requirePermission(
    ctx,
    plan.scope === "team" ? `${domain}.team.read` : `${domain}.self`,
  );
  const employee = await tx.employee.findFirst({
    where: { ...base, userId: ctx.userId },
    select: { id: true },
  });
  if (!employee)
    throw new AppError(403, "Your account needs a linked employee record.");
  return {
    ...base,
    ...(plan.scope === "team"
      ? { managerId: employee.id }
      : { id: employee.id }),
  };
}
// Counts of other workflows waiting for this user; names are not shown.
async function otherApprovals(tx: Tx, ctx: Context) {
  const has = (p: string) => ctx.permissions.includes(p);
  const base = { companyId: ctx.companyId };
  const me = await tx.employee.findFirst({
    where: { ...base, userId: ctx.userId },
    select: { id: true },
  });
  const team = me
    ? (
        await tx.employee.findMany({
          where: { ...base, managerId: me.id },
          select: { id: true },
        })
      ).map((e) => e.id)
    : [];
  const parts: [string, number][] = [
    [
      "expense claims",
      has("expenses.manage")
        ? await tx.expenseClaim.count({
            where: { ...base, status: "MANAGER_APPROVED" },
          })
        : has("expenses.approve") && team.length
          ? await tx.expenseClaim.count({
              where: { ...base, status: "SUBMITTED", employeeId: { in: team } },
            })
          : 0,
    ],
    [
      "missed-punch requests",
      has("attendance.manage")
        ? await tx.attendanceRegularization.count({
            where: { ...base, status: "Pending" },
          })
        : 0,
    ],
    [
      "overtime entries",
      has("attendance.manage")
        ? await tx.attendance.count({
            where: { ...base, overtimeStatus: "PENDING" },
          })
        : 0,
    ],
    [
      "payroll runs",
      has("payroll.approve")
        ? await tx.payrollRun.count({ where: { ...base, status: "SUBMITTED" } })
        : 0,
    ],
    [
      "documents",
      has("documents.manage")
        ? await tx.document.count({
            where: { ...base, status: "PENDING_APPROVAL" },
          })
        : 0,
    ],
    [
      "manager reviews",
      has("performance.team") && me
        ? await tx.performanceReview.count({
            where: {
              ...base,
              reviewerEmployeeId: me.id,
              status: "PENDING_MANAGER",
              cycle: { status: "ACTIVE" },
            },
          })
        : 0,
    ],
  ];
  const waiting = parts.filter(([, n]) => n > 0);
  return waiting.length
    ? ` Also waiting: ${waiting.map(([k, n]) => `${n} ${k}`).join(", ")}.`
    : "";
}
export async function executeQuery(
  ctx: Context,
  plan: QueryPlan,
): Promise<QueryResult> {
  requirePermission(ctx, "ai.use");
  return db.$transaction(
    async (tx) => {
      // Static SQL sets a transaction property only. Model output never becomes SQL.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const company = await tx.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { timezone: true, workingDays: true },
      });
      const today = localDay(new Date(), company.timezone),
        at = dayDate(today);
      const range = {
        gte: dayDate(
          plan.period === "month" ? today.slice(0, 7) + "-01" : today,
        ),
        lte: at,
      };
      const base = { companyId: ctx.companyId };
      const output = (
        answer: string,
        columns: string[] = [],
        rows: (string | number)[][] = [],
        sources: string[] = [],
      ): QueryResult => ({
        answer,
        columns,
        rows: rows.slice(0, 200),
        sources,
        scope: plan.scope,
        asOf: today + " · " + company.timezone,
        ...(rows.length > 200 ? { truncated: true } : {}),
      });
      if (plan.intent === "unavailable")
        return output(
          "This question is not supported by the HR Copilot query catalogue yet. Use the relevant workspace module to view permitted records. No records were queried.",
        );
      if (plan.intent === "payslip_location") {
        requirePermission(ctx, "payroll.self");
        return output(
          "Open Payslips in the menu to view and download your payslips, including the earnings and statutory deductions breakdown.",
        );
      }
      if (plan.intent === "payroll_summary") {
        requirePermission(ctx, "payroll.read");
        // Company totals only; individual salaries are never returned here.
        const run = await tx.payrollRun.findFirst({
          where: { ...base, status: "PROCESSED" },
          orderBy: { period: "desc" },
        });
        if (!run)
          return output(
            "No payroll run has been processed yet.",
            [],
            [],
            ["payroll_runs"],
          );
        const t = (run.totals ?? {}) as Record<string, number>;
        const r = (v?: number) => Math.round(v ?? 0);
        return output(
          `Latest processed payroll: ${run.period}.`,
          [
            "Month",
            "Employees",
            "Gross",
            "Deductions",
            "Net pay",
            "PF (employee + employer)",
            "ESI (employee + employer)",
            "Professional tax",
            "TDS",
            "Employer cost",
          ],
          [
            [
              run.period,
              r(t.employees),
              r(t.gross),
              r(t.deductions),
              r(t.netPay),
              r(
                (t.pfEmployee ?? 0) +
                  (t.pfEmployerEpf ?? 0) +
                  (t.pfEmployerEps ?? 0),
              ),
              r((t.esiEmployee ?? 0) + (t.esiEmployer ?? 0)),
              r(t.pt),
              r(t.tds),
              r(t.employerCost),
            ],
          ],
          ["payroll_runs"],
        );
      }
      if (plan.intent === "recruitment_pipeline") {
        requirePermission(ctx, "recruitment.manage");
        const [jobs, counts] = await Promise.all([
          tx.jobOpening.findMany({
            where: { ...base, status: { in: ["OPEN", "ON_HOLD"] } },
            select: { id: true, title: true, openings: true },
          }),
          tx.candidate.groupBy({
            by: ["jobId", "stage"],
            where: base,
            _count: { _all: true },
          }),
        ]);
        const stages = [
          "APPLIED",
          "SCREENING",
          "SHORTLISTED",
          "INTERVIEW",
          "SELECTED",
          "OFFER",
          "HIRED",
        ];
        const n = (jobId: string, stage: string) =>
          counts.find((c) => c.jobId === jobId && c.stage === stage)?._count
            ._all ?? 0;
        return output(
          `${jobs.length} open or on-hold job openings. Candidate names are not shown here.`,
          [
            "Job",
            "Openings",
            ...stages.map((s) => s[0] + s.slice(1).toLowerCase()),
          ],
          jobs.map((j) => [
            j.title,
            j.openings,
            ...stages.map((s) => n(j.id, s)),
          ]),
          ["job_openings", "candidates"],
        );
      }
      if (plan.intent === "help")
        return output(
          "Ask about your leave balance, today's check-in, attendance this month, holidays, your training or assets, pending approvals, or (with access) team and company attendance, headcount, payroll, recruitment, onboarding and expiring documents. Use Today or This month. Other dates and filters are not yet supported.",
        );
      if (plan.intent === "expiring_documents") {
        // HR sees the company; everyone else sees only their own documents.
        const all = ctx.permissions.includes("documents.manage");
        if (!all) requirePermission(ctx, "documents.self");
        const own = all
          ? null
          : await tx.employee.findFirst({
              where: { ...base, userId: ctx.userId },
              select: { id: true },
            });
        if (!all && !own)
          throw new AppError(
            403,
            "Your account needs a linked employee record.",
          );
        const in30 = new Date(at.getTime() + 30 * 86400000);
        const docs = await tx.document.findMany({
          where: {
            ...base,
            expiresOn: { not: null, lte: in30 },
            status: { not: "REJECTED" },
            ...(own ? { employeeId: own.id } : {}),
          },
          select: {
            title: true,
            category: true,
            expiresOn: true,
            employee: { select: person },
          },
          orderBy: { expiresOn: "asc" },
          take: 201,
        });
        return output(
          `${docs.length} document(s) expired or expiring within 30 days.`,
          ["Document", "Category", "Employee", "Expires"],
          docs.map((d) => [
            d.title,
            d.category,
            d.employee
              ? `${d.employee.firstName} ${d.employee.lastName}`
              : "Company",
            d.expiresOn!.toISOString().slice(0, 10),
          ]),
          ["documents"],
        );
      }
      if (plan.intent === "onboarding_status") {
        requirePermission(ctx, "onboarding.manage");
        const rows = await tx.onboarding.findMany({
          where: { ...base, status: "IN_PROGRESS" },
          select: {
            name: true,
            joiningDate: true,
            tasks: { select: { status: true, required: true } },
          },
          orderBy: { joiningDate: "asc" },
          take: 201,
        });
        return output(
          `${rows.length} joiner(s) in onboarding.`,
          ["Joiner", "Joining date", "Required tasks done", "Open tasks"],
          rows.map((o) => [
            o.name,
            o.joiningDate.toISOString().slice(0, 10),
            `${o.tasks.filter((t) => t.required && t.status === "DONE").length}/${o.tasks.filter((t) => t.required).length}`,
            o.tasks.filter((t) => !["DONE", "WAIVED"].includes(t.status))
              .length,
          ]),
          ["onboarding", "onboarding_tasks"],
        );
      }
      if (plan.intent === "training_status") {
        if (
          ctx.permissions.includes("training.manage") &&
          plan.scope === "company"
        ) {
          const expiring = await tx.trainingEnrollment.findMany({
            where: {
              ...base,
              status: "COMPLETED",
              expiresOn: {
                not: null,
                lte: new Date(at.getTime() + 60 * 86400000),
              },
            },
            select: {
              expiresOn: true,
              employee: { select: person },
              session: { select: { course: { select: { title: true } } } },
            },
            orderBy: { expiresOn: "asc" },
            take: 201,
          });
          return output(
            `${expiring.length} certificate(s) expired or expiring within 60 days.`,
            ["Employee", "Course", "Expires"],
            expiring.map((e) => [
              `${e.employee.firstName} ${e.employee.lastName}`,
              e.session.course.title,
              e.expiresOn!.toISOString().slice(0, 10),
            ]),
            ["training_enrollments"],
          );
        }
        requirePermission(ctx, "training.self");
        const me = await tx.employee.findFirst({
          where: { ...base, userId: ctx.userId },
          select: { id: true },
        });
        if (!me)
          throw new AppError(
            403,
            "Your account needs a linked employee record.",
          );
        const mine = await tx.trainingEnrollment.findMany({
          where: { ...base, employeeId: me.id, status: { not: "CANCELLED" } },
          select: {
            status: true,
            expiresOn: true,
            session: {
              select: { startsAt: true, course: { select: { title: true } } },
            },
          },
          orderBy: { session: { startsAt: "desc" } },
          take: 201,
        });
        return output(
          "Your training sessions and certificates.",
          ["Course", "Date", "Status", "Certificate valid until"],
          mine.map((e) => [
            e.session.course.title,
            e.session.startsAt.toISOString().slice(0, 10),
            e.status.toLowerCase(),
            e.expiresOn?.toISOString().slice(0, 10) ?? "—",
          ]),
          ["training_enrollments"],
        );
      }
      if (plan.intent === "my_assets") {
        requirePermission(ctx, "assets.self");
        const me = await tx.employee.findFirst({
          where: { ...base, userId: ctx.userId },
          select: { id: true },
        });
        if (!me)
          throw new AppError(
            403,
            "Your account needs a linked employee record.",
          );
        const held = await tx.assetAssignment.findMany({
          where: { ...base, employeeId: me.id, returnedOn: null },
          select: {
            issuedOn: true,
            asset: { select: { assetCode: true, name: true, category: true } },
          },
        });
        return output(
          `${held.length} company asset(s) are issued to you.`,
          ["Asset", "Type", "Issued"],
          held.map((h) => [
            `${h.asset.assetCode} · ${h.asset.name}`,
            h.asset.category.toLowerCase().replace("_", " "),
            h.issuedOn.toISOString().slice(0, 10),
          ]),
          ["asset_assignments"],
        );
      }
      if (plan.intent === "apply_leave") {
        requirePermission(ctx, "timeoff.self");
        return output(
          "Open Leave & holidays, choose Request leave, select the leave type and dates, enter your reason and submit for review.",
        );
      }
      if (plan.intent === "bank_details") {
        requirePermission(ctx, "profile.read");
        return output(
          "Contact authorized HR to update bank details. Bank information cannot be updated through Copilot or the self-service profile. Do not paste account details into chat.",
        );
      }
      if (plan.intent === "holidays") {
        requirePermission(ctx, "timeoff.self");
        const where = {
          ...base,
          date: { gte: at, lte: dayDate(today.slice(0, 4) + "-12-31") },
        };
        const count = await tx.holiday.count({ where });
        const rows = await tx.holiday.findMany({
          where,
          orderBy: { date: "asc" },
          take: 201,
          select: { name: true, date: true },
        });
        return output(
          `${count} holidays remain this calendar year, including today if applicable.`,
          ["Holiday", "Date"],
          rows.map((r) => [r.name, r.date.toISOString().slice(0, 10)]),
          ["holidays"],
        );
      }
      if (plan.intent === "headcount" || plan.intent === "departments") {
        requirePermission(ctx, "employees.read");
        if (plan.intent === "headcount")
          return output(
            "Employees with Active employment status.",
            ["Active employees"],
            [
              [
                await tx.employee.count({
                  where: { ...base, status: "Active" },
                }),
              ],
            ],
            ["employees"],
          );
        const groups = await tx.employee.groupBy({
          by: ["departmentId"],
          where: { ...base, status: "Active" },
          _count: { _all: true },
          orderBy: { _count: { departmentId: "desc" } },
          take: 201,
        });
        const departments = await tx.department.findMany({
          where: {
            ...base,
            id: {
              in: groups.flatMap((g) =>
                g.departmentId ? [g.departmentId] : [],
              ),
            },
          },
          select: { id: true, name: true },
        });
        return output(
          "Active headcount by current department.",
          ["Department", "Employees"],
          groups
            .sort((a, b) => b._count._all - a._count._all)
            .map((g) => [
              departments.find((d) => d.id === g.departmentId)?.name ??
                "Unassigned",
              g._count._all,
            ]),
          ["employees", "departments"],
        );
      }
      if (plan.intent === "leave_policy") {
        requirePermission(ctx, "timeoff.self");
        const types = await tx.leaveType.findMany({
          where: { ...base, active: true },
          select: { name: true, annualDays: true, paid: true },
          take: 201,
        });
        return output(
          "Configured annual allowances. Pending and approved leave reserve balance. Working weekdays and holidays affect leave days. This is not a complete policy document; contact HR for additional rules.",
          ["Leave type", "Annual days", "Paid"],
          types.map((t) => [t.name, t.annualDays, t.paid ? "Yes" : "No"]),
          ["leave_types"],
        );
      }
      if (["leave_balance", "on_leave", "approvals"].includes(plan.intent)) {
        const whereEmployee = await scopeWhere(tx, ctx, plan, "timeoff");
        if (plan.intent === "leave_balance") {
          if (plan.scope !== "own")
            throw new AppError(422, "Ask for your own leave balance.");
          const own = await tx.employee.findFirstOrThrow({
            where: whereEmployee,
            select: { id: true },
          });
          const engine = await balances(
            ctx,
            own.id,
            Number(today.slice(0, 4)),
            tx,
          );
          return output(
            "Leave balance for the current calendar year, including accrual, carry-forward and adjustments. Pending requests reserve days.",
            ["Type", "Entitled", "Approved", "Pending", "Remaining"],
            engine.map((b) => [
              b.name,
              b.entitled,
              b.approved,
              b.pending,
              b.paid ? b.remaining : "No limit (unpaid)",
            ]),
            ["leave_types", "leave_requests", "leave_ledger"],
          );
        }
        const where: Prisma.LeaveRequestWhereInput = {
          ...base,
          employee: whereEmployee,
          ...(plan.intent === "approvals"
            ? { status: "Pending" }
            : {
                status: "Approved",
                startDate: { lte: at },
                endDate: { gte: at },
              }),
        };
        const total = await tx.leaveRequest.count({ where });
        const requests = await tx.leaveRequest.findMany({
          where,
          select: {
            employee: { select: person },
            startDate: true,
            endDate: true,
            status: true,
          },
          orderBy: { startDate: "asc" },
          take: 201,
        });
        const other =
          plan.intent === "approvals" ? await otherApprovals(tx, ctx) : "";
        return output(
          `${total} ${plan.intent === "approvals" ? `pending leave requests.${other}` : "approved leave requests covering today."}`,
          ["Employee", "From", "To", "Status"],
          requests.map((r) => [
            r.employee.firstName + " " + r.employee.lastName,
            r.startDate.toISOString().slice(0, 10),
            r.endDate.toISOString().slice(0, 10),
            r.status,
          ]),
          ["leave_requests"],
        );
      }
      const employee = await scopeWhere(tx, ctx, plan, "attendance");
      if (plan.intent === "absent") {
        // Revealing approved leave requires leave permission as well as attendance permission.
        await scopeWhere(tx, ctx, plan, "timeoff");
        const population = {
          ...employee,
          status: { in: eligible },
          joinedAt: { lte: at },
        };
        const present = {
          attendance: {
            some: {
              companyId: ctx.companyId,
              workDate: at,
              status: { notIn: ["ABSENT", "PENDING_REVIEW"] },
            },
          },
        };
        const leave = {
          leaveRequests: {
            some: {
              companyId: ctx.companyId,
              status: "Approved",
              startDate: { lte: at },
              endDate: { gte: at },
            },
          },
        };
        const scheduled =
          company.workingDays.includes(at.getUTCDay()) &&
          !(await tx.holiday.count({ where: { ...base, date: at } }));
        const total = await tx.employee.count({ where: population });
        const presentCount = await tx.employee.count({
          where: { ...population, ...present },
        });
        const leaveCount = await tx.employee.count({
          where: { ...population, ...leave, NOT: present },
        });
        const absentWhere = { ...population, NOT: [present, leave] };
        const missing = scheduled
          ? await tx.employee.findMany({
              where: absentWhere,
              select: person,
              take: 201,
              orderBy: { employeeCode: "asc" },
            })
          : [];
        return output(
          `Today: total eligible employees ${total}; present ${presentCount}; approved leave without attendance ${leaveCount}; ${scheduled ? `not checked in ${total - presentCount - leaveCount}` : "non-working day; no absence inferred"}. Not checked in is a current snapshot, not a finalized absence decision.`,
          ["Employee ID", "Name"],
          missing.map((e) => [e.employeeCode, e.firstName + " " + e.lastName]),
          ["employees", "attendance", "leave_requests", "holidays"],
        );
      }
      // Days marked absent or awaiting missed-punch review are not attendance.
      const where: Prisma.AttendanceWhereInput = {
        ...base,
        status: { notIn: ["ABSENT", "PENDING_REVIEW"] },
        employee,
        workDate: plan.intent === "check_in" ? at : range,
      };
      if (plan.intent === "repeated_late") {
        const groups = await tx.attendance.groupBy({
          by: ["employeeId"],
          where: {
            ...where,
            workDate: { gte: dayDate(today.slice(0, 7) + "-01"), lte: at },
            lateMinutes: { gt: 0 },
          },
          _count: { _all: true },
          having: { employeeId: { _count: { gt: plan.moreThan } } },
          orderBy: { _count: { employeeId: "desc" } },
          take: 201,
        });
        const names = await tx.employee.findMany({
          where: {
            AND: [employee, { id: { in: groups.map((g) => g.employeeId) } }],
          },
          select: person,
        });
        return output(
          `Employees late more than ${plan.moreThan} times this month to date.`,
          ["Employee", "Late days"],
          groups.map((g) => {
            const e = names.find((n) => n.id === g.employeeId)!;
            return [e.firstName + " " + e.lastName, g._count._all];
          }),
          ["attendance", "employees"],
        );
      }
      if (plan.intent === "attendance_summary") {
        const count = await tx.attendance.count({ where });
        const late = await tx.attendance.count({
          where: { ...where, lateMinutes: { gt: 0 } },
        });
        const totals = await tx.attendance.aggregate({
          where,
          _sum: { workedMinutes: true, overtimeMinutes: true },
        });
        return output(
          `Recorded attendance ${range.gte.toISOString().slice(0, 10)} to ${today}. Hours include completed/corrected sessions; open sessions are not final. No prior-period comparison or absence rate is inferred.`,
          [
            "Recorded employee-days",
            "Late days",
            "Worked minutes",
            "Overtime minutes",
          ],
          [
            [
              count,
              late,
              totals._sum.workedMinutes ?? 0,
              totals._sum.overtimeMinutes ?? 0,
            ],
          ],
          ["attendance"],
        );
      }
      const filtered = {
        ...where,
        ...(plan.intent === "late" ? { lateMinutes: { gt: 0 } } : {}),
      };
      const total = await tx.attendance.count({ where: filtered });
      const rows = await tx.attendance.findMany({
        where: filtered,
        select: {
          employee: { select: person },
          workDate: true,
          checkIn: true,
          checkOut: true,
          lateMinutes: true,
          workedMinutes: true,
        },
        orderBy: [{ workDate: "desc" }, { id: "asc" }],
        take: 201,
      });
      const time = (date: Date | null) =>
        date
          ? date.toLocaleString("en-IN", { timeZone: company.timezone })
          : "Not checked out";
      return output(
        `${total} attendance records matched.`,
        [
          "Employee",
          "Work date",
          "Check in",
          "Check out",
          "Late minutes",
          "Worked minutes",
        ],
        rows.map((r) => [
          r.employee.firstName + " " + r.employee.lastName,
          r.workDate.toISOString().slice(0, 10),
          time(r.checkIn),
          time(r.checkOut),
          r.lateMinutes,
          r.workedMinutes,
        ]),
        ["attendance"],
      );
    },
    { timeout: 15000 },
  );
}
