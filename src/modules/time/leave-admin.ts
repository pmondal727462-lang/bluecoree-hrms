import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
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
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { balances } from "./leave-balance";
import { addDays, dayDate, localDay } from "./rules";
import {
  adjustmentSchema,
  carryForwardSchema,
  compOffRequestSchema,
  encashSchema,
} from "./validators";

type Tx = Prisma.TransactionClient;
const fail = (message: string, status = 409): never => {
  throw new AppError(status, message);
};
const lock = <T>(
  ctx: Pick<Context, "companyId">,
  run: (tx: Tx) => Promise<T>,
) =>
  db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.companyId}))::text`;
      return run(tx);
    },
    { timeout: 60000 },
  );
async function me(ctx: Context, tx: Tx | typeof db = db) {
  const e = await tx.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true, firstName: true, lastName: true, joinedAt: true },
  });
  if (!e) fail("Your account needs a linked employee record.", 403);
  return e!;
}
async function policy(companyId: string) {
  const p = await db.attendancePolicy.findUnique({
    where: { companyId },
    select: {
      compOffEnabled: true,
      compOffExpiryDays: true,
      optionalHolidayLimit: true,
    },
  });
  return {
    compOffEnabled: p?.compOffEnabled ?? false,
    compOffExpiryDays: p?.compOffExpiryDays ?? 90,
    optionalHolidayLimit: p?.optionalHolidayLimit ?? 0,
  };
}
async function today(companyId: string) {
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  return localDay(new Date(), c.timezone);
}

// Standard Indian leave types (spec §21); every value is editable afterwards.
// Earned and privilege leave are the same entitlement under two names, so
// one "Earned / Privilege Leave" type covers both.
const standardTypes: Prisma.LeaveTypeCreateManyInput[] = [
  { companyId: "", name: "Casual Leave", annualDays: 12, paid: true },
  { companyId: "", name: "Sick Leave", annualDays: 12, paid: true },
  {
    companyId: "",
    name: "Earned / Privilege Leave",
    annualDays: 15,
    paid: true,
    accrual: "MONTHLY",
    carryForwardMax: 30,
    encashable: true,
    encashMax: 15,
  },
  {
    companyId: "",
    name: "Maternity Leave",
    annualDays: 182,
    paid: true,
    halfDayAllowed: false,
  },
  { companyId: "", name: "Paternity Leave", annualDays: 5, paid: true },
  {
    companyId: "",
    name: "Compensatory Off",
    annualDays: 0,
    paid: true,
    compOff: true,
  },
  { companyId: "", name: "Loss of Pay", annualDays: 0, paid: false },
];

export async function leaveAdminRoute(
  req: NextRequest,
  ctx: Context,
  resource: string,
  id?: string,
) {
  const method = req.method;
  if (resource === "leave-types" && id === "defaults" && method === "POST") {
    requirePermission(ctx, "time.configure");
    return lock(ctx, async (tx) => {
      const existing = new Set(
        (
          await tx.leaveType.findMany({
            where: { companyId: ctx.companyId },
            select: { name: true },
          })
        ).map((t) => t.name.toLowerCase()),
      );
      const add = standardTypes
        .filter((t) => !existing.has(t.name.toLowerCase()))
        .map((t) => ({ ...t, companyId: ctx.companyId }));
      if (add.length) await tx.leaveType.createMany({ data: add });
      await audit(
        tx,
        ctx,
        "LEAVE_TYPES_DEFAULTS",
        "leave",
        undefined,
        undefined,
        { added: add.map((t) => t.name) },
        ip(req),
      );
      return { added: add.map((t) => t.name) };
    });
  }

  // Optional holidays: employees choose up to the policy limit per year.
  if (resource === "optional-holidays") {
    requirePermission(ctx, "timeoff.self");
    const e = await me(ctx);
    const { optionalHolidayLimit } = await policy(ctx.companyId);
    const day = await today(ctx.companyId);
    const year = Number(day.slice(0, 4));
    const range = {
      gte: dayDate(`${year}-01-01`),
      lte: dayDate(`${year}-12-31`),
    };
    if (method === "GET" && !id) {
      const holidays = await db.holiday.findMany({
        where: { companyId: ctx.companyId, optional: true, date: range },
        include: {
          selections: { where: { employeeId: e.id }, select: { id: true } },
        },
        orderBy: { date: "asc" },
      });
      return {
        limit: optionalHolidayLimit,
        selected: holidays.filter((h) => h.selections.length).length,
        items: holidays.map(({ selections, ...h }) => ({
          ...h,
          selected: selections.length > 0,
        })),
      };
    }
    if (!id) fail("Choose a holiday.", 422);
    const holiday = await db.holiday.findFirst({
      where: { id, companyId: ctx.companyId, optional: true },
    });
    if (!holiday) return fail("Optional holiday not found.", 404);
    if (holiday.date.toISOString().slice(0, 10) <= day)
      fail("Change optional holidays before the date.", 422);
    return lock(ctx, async (tx) => {
      if (method === "POST") {
        const count = await tx.holidaySelection.count({
          where: {
            companyId: ctx.companyId,
            employeeId: e.id,
            holidayId: {
              in: (
                await tx.holiday.findMany({
                  where: {
                    companyId: ctx.companyId,
                    optional: true,
                    date: range,
                  },
                  select: { id: true },
                })
              ).map((h) => h.id),
            },
          },
        });
        if (count >= optionalHolidayLimit)
          fail(
            `You can choose ${optionalHolidayLimit} optional holidays a year.`,
          );
        await tx.holidaySelection.upsert({
          where: {
            companyId_employeeId_holidayId: {
              companyId: ctx.companyId,
              employeeId: e.id,
              holidayId: holiday.id,
            },
          },
          create: {
            companyId: ctx.companyId,
            employeeId: e.id,
            holidayId: holiday.id,
          },
          update: {},
        });
      } else if (method === "DELETE")
        await tx.holidaySelection.deleteMany({
          where: {
            companyId: ctx.companyId,
            employeeId: e.id,
            holidayId: holiday.id,
          },
        });
      else fail("Method not allowed.", 405);
      return { holidayId: holiday.id, selected: method === "POST" };
    });
  }

  // Compensatory off: request a credit for work on a weekly off or holiday.
  if (resource === "comp-off" && !id && method === "GET") {
    const company = req.nextUrl.searchParams.get("scope") === "company";
    requirePermission(ctx, company ? "timeoff.manage" : "timeoff.self");
    const e = company ? null : await me(ctx);
    const where = {
      companyId: ctx.companyId,
      ...(e ? { employeeId: e.id } : {}),
      ...(req.nextUrl.searchParams.get("status")
        ? { status: req.nextUrl.searchParams.get("status")! }
        : {}),
    };
    return db.compOffRequest.findMany({
      where,
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 200,
    });
  }
  if (resource === "comp-off" && !id && method === "POST") {
    requirePermission(ctx, "timeoff.self");
    const b = compOffRequestSchema.parse(await json(req));
    const p = await policy(ctx.companyId);
    if (!p.compOffEnabled)
      fail("Compensatory off is not enabled for your company.", 422);
    return lock(ctx, async (tx) => {
      const e = await me(ctx, tx);
      const a = await tx.attendance.findFirst({
        where: {
          companyId: ctx.companyId,
          employeeId: e.id,
          workDate: dayDate(b.workDate),
        },
      });
      if (!a?.checkOut || !a.offDay)
        fail(
          "Compensatory off needs completed attendance on a weekly off or holiday.",
          422,
        );
      // Half a day needs half a working day; a full day needs a full one.
      const full = a!.expectedMinutes || 480;
      if (a!.workedMinutes < (b.days === 1 ? full : full / 2))
        fail("Not enough time worked on that date for this credit.", 422);
      const exists = await tx.compOffRequest.findUnique({
        where: {
          companyId_employeeId_workDate: {
            companyId: ctx.companyId,
            employeeId: e.id,
            workDate: dayDate(b.workDate),
          },
        },
      });
      if (exists)
        fail("A compensatory off request already exists for that date.");
      const saved = await tx.compOffRequest.create({
        data: {
          companyId: ctx.companyId,
          employeeId: e.id,
          workDate: dayDate(b.workDate),
          days: b.days,
          reason: b.reason,
          attendanceId: a!.id,
        },
      });
      await audit(
        tx,
        ctx,
        "COMP_OFF_REQUEST",
        "leave",
        saved.id,
        undefined,
        { workDate: b.workDate, days: b.days },
        ip(req),
      );
      await notify(
        ctx.companyId,
        await usersWithPermission(ctx.companyId, "timeoff.manage"),
        "leave.submitted",
        {
          employee: `${e.firstName} ${e.lastName}`,
          days: b.days,
          leaveType: "compensatory off credit",
          startDate: b.workDate,
          endDate: b.workDate,
        },
        "/leave",
      );
      return saved;
    });
  }
  if (resource === "comp-off" && id && method === "PUT") {
    requirePermission(ctx, "timeoff.manage");
    const b = z
      .object({
        status: z.enum(["Approved", "Rejected"]),
        note: z.string().trim().max(500).default(""),
      })
      .strict()
      .parse(await json(req));
    const p = await policy(ctx.companyId);
    return lock(ctx, async (tx) => {
      const r = await tx.compOffRequest.findFirst({
        where: { id, companyId: ctx.companyId },
        include: { employee: { select: { userId: true } } },
      });
      if (!r) return fail("Request not found.", 404);
      if (r.status !== "Pending") fail("This request is already reviewed.");
      if (r.employee.userId === ctx.userId)
        fail("Another administrator must review your own request.", 403);
      const workDay = r.workDate.toISOString().slice(0, 10);
      const expiresAt = dayDate(addDays(workDay, p.compOffExpiryDays));
      if (b.status === "Approved") {
        const type = await tx.leaveType.findFirst({
          where: { companyId: ctx.companyId, compOff: true, active: true },
        });
        if (!type)
          fail("Create an active compensatory off leave type first.", 422);
        await tx.leaveLedger.create({
          data: {
            companyId: ctx.companyId,
            employeeId: r.employeeId,
            leaveTypeId: type!.id,
            year: Number(workDay.slice(0, 4)),
            kind: "COMP_OFF",
            days: r.days,
            expiresAt,
            note: `Worked on ${workDay}`,
            refId: r.id,
            createdBy: ctx.userId,
          },
        });
      }
      const saved = await tx.compOffRequest.update({
        where: { id: r.id },
        data: {
          status: b.status,
          reviewNote: b.note,
          reviewedBy: ctx.userId,
          reviewedAt: new Date(),
          ...(b.status === "Approved" ? { expiresAt } : {}),
        },
      });
      await audit(
        tx,
        ctx,
        `COMP_OFF_${b.status.toUpperCase()}`,
        "leave",
        r.id,
        { status: r.status },
        { status: b.status, note: b.note },
        ip(req),
      );
      return saved;
    });
  }

  // Year-end carry-forward up to each type's cap. Safe to run again.
  if (resource === "leave-carry-forward" && method === "POST") {
    requirePermission(ctx, "timeoff.manage");
    const b = carryForwardSchema.parse(await json(req));
    if (b.fromYear >= Number((await today(ctx.companyId)).slice(0, 4)))
      fail("Carry forward a year that has ended.", 422);
    const { carried, employees } = await carryForward(ctx, b.fromYear);
    await db.$transaction((tx) =>
      audit(
        tx,
        ctx,
        "LEAVE_CARRY_FORWARD",
        "leave",
        undefined,
        undefined,
        { fromYear: b.fromYear, carried, employees },
        ip(req),
      ),
    );
    return { carried, employees };
  }

  if (resource === "leave-encash" && method === "POST") {
    requirePermission(ctx, "timeoff.manage");
    const b = encashSchema.parse(await json(req));
    return lock(ctx, async (tx) => {
      const type = await tx.leaveType.findFirst({
        where: { id: b.leaveTypeId, companyId: ctx.companyId },
      });
      if (!type) return fail("Leave type not found.", 404);
      if (!type.encashable) fail("This leave type cannot be encashed.", 422);
      if (
        !(await tx.employee.findFirst({
          where: { id: b.employeeId, companyId: ctx.companyId },
        }))
      )
        fail("Employee not found.", 404);
      const balance = (await balances(ctx, b.employeeId, b.year, tx)).find(
        (t) => t.id === type.id,
      )!;
      if (balance.encashed + b.days > type.encashMax)
        fail(
          `At most ${type.encashMax} days of this type can be encashed in a year.`,
          422,
        );
      if (b.days > balance.remaining)
        fail("Not enough balance to encash.", 422);
      const entry = await tx.leaveLedger.create({
        data: {
          companyId: ctx.companyId,
          employeeId: b.employeeId,
          leaveTypeId: type.id,
          year: b.year,
          kind: "ENCASHMENT",
          days: -b.days,
          note: b.note || "Encashed",
          createdBy: ctx.userId,
        },
      });
      await audit(
        tx,
        ctx,
        "LEAVE_ENCASH",
        "leave",
        entry.id,
        undefined,
        { employeeId: b.employeeId, leaveType: type.name, days: b.days },
        ip(req),
      );
      return entry;
    });
  }

  // Bulk balance adjustments (spec §78).
  if (resource === "leave-adjust" && method === "POST") {
    requirePermission(ctx, "timeoff.manage");
    const b = adjustmentSchema.parse(await json(req, 200000));
    return lock(ctx, async (tx) => {
      const employees = [...new Set(b.entries.map((x) => x.employeeId))];
      const types = [...new Set(b.entries.map((x) => x.leaveTypeId))];
      if (
        (await tx.employee.count({
          where: { companyId: ctx.companyId, id: { in: employees } },
        })) !== employees.length ||
        (await tx.leaveType.count({
          where: { companyId: ctx.companyId, id: { in: types } },
        })) !== types.length
      )
        fail("Employee or leave type not found.", 404);
      await tx.leaveLedger.createMany({
        data: b.entries.map((x) => ({
          companyId: ctx.companyId,
          employeeId: x.employeeId,
          leaveTypeId: x.leaveTypeId,
          year: x.year,
          kind: "ADJUSTMENT",
          days: x.days,
          note: x.note,
          createdBy: ctx.userId,
        })),
      });
      await audit(
        tx,
        ctx,
        "LEAVE_ADJUST",
        "leave",
        undefined,
        undefined,
        { entries: b.entries.length },
        ip(req),
      );
      return { adjusted: b.entries.length };
    });
  }

  if (resource === "leave-ledger" && method === "GET") {
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const own = !employeeId;
    requirePermission(ctx, own ? "timeoff.self" : "timeoff.manage");
    const e = own ? await me(ctx) : null;
    return db.leaveLedger.findMany({
      where: {
        companyId: ctx.companyId,
        employeeId: e?.id ?? employeeId!,
        ...(req.nextUrl.searchParams.get("year")
          ? { year: Number(req.nextUrl.searchParams.get("year")) }
          : {}),
      },
      include: { leaveType: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 200,
    });
  }
  return null;
}

// Year-end carry forward, safe to repeat (each credit has a unique refId).
// Called by HR and by the scheduled year-end job.
export async function carryForward(
  ctx: Pick<Context, "companyId" | "userId">,
  fromYear: number,
) {
  const types = await db.leaveType.findMany({
    where: {
      companyId: ctx.companyId,
      carryForwardMax: { gt: 0 },
      compOff: false,
      paid: true,
    },
  });
  if (!types.length) return { carried: 0, employees: 0 };
  let carried = 0,
    employees = 0,
    cursor: string | undefined;
  for (;;) {
    const batch = await db.employee.findMany({
      where: {
        companyId: ctx.companyId,
        status: { not: "Inactive" },
        joinedAt: { lte: dayDate(`${fromYear}-12-31`) },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    cursor = batch.at(-1)!.id;
    for (const e of batch) {
      employees++;
      await lock(ctx, async (tx) => {
        const year = await balances(ctx, e.id, fromYear, tx);
        for (const t of types) {
          const refId = `carry:${fromYear}:${e.id}:${t.id}`;
          if (
            await tx.leaveLedger.findFirst({
              where: {
                companyId: ctx.companyId,
                kind: "CARRY_FORWARD",
                refId,
              },
            })
          )
            continue;
          const left = year.find((x) => x.id === t.id)?.remaining ?? 0;
          const days = Math.min(Math.max(left, 0), t.carryForwardMax);
          if (!days) continue;
          await tx.leaveLedger.create({
            data: {
              companyId: ctx.companyId,
              employeeId: e.id,
              leaveTypeId: t.id,
              year: fromYear + 1,
              kind: "CARRY_FORWARD",
              days,
              note: `Carried forward from ${fromYear}`,
              refId,
              createdBy: ctx.userId,
            },
          });
          carried++;
        }
      });
    }
  }
  return { carried, employees };
}
