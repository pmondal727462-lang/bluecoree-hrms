import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { json, rateLimit, type Context } from "@/modules/auth/service";
import { dayDate, localDay } from "@/modules/time/rules";

export const wishEmojis = ["🎂", "🎉", "👏", "💐", "❤️"] as const;
async function todayEvents(ctx: Context) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
    select: { timezone: true },
  });
  const today = localDay(new Date(), company.timezone);
  const [year, month, day] = today.split("-").map(Number);
  // Only names and event types leave this service, never birth years/ages.
  const people = await db.$queryRaw<
    {
      id: string;
      firstName: string;
      lastName: string;
      userId: string | null;
      birthday: boolean;
      anniversary: boolean;
      years: number;
    }[]
  >`
    SELECT "id", "firstName", "lastName", "userId",
      (EXTRACT(MONTH FROM "dateOfBirth") = ${month} AND EXTRACT(DAY FROM "dateOfBirth") = ${day}) AS birthday,
      (EXTRACT(MONTH FROM "joinedAt") = ${month} AND EXTRACT(DAY FROM "joinedAt") = ${day} AND EXTRACT(YEAR FROM "joinedAt") < ${year}) AS anniversary,
      (${year} - EXTRACT(YEAR FROM "joinedAt"))::int AS years
    FROM employees WHERE "companyId" = ${ctx.companyId} AND "status" IN ('Active', 'Probation', 'On notice')
      AND ((EXTRACT(MONTH FROM "dateOfBirth") = ${month} AND EXTRACT(DAY FROM "dateOfBirth") = ${day})
      OR (EXTRACT(MONTH FROM "joinedAt") = ${month} AND EXTRACT(DAY FROM "joinedAt") = ${day} AND EXTRACT(YEAR FROM "joinedAt") < ${year}))`;
  return {
    today,
    events: people.flatMap((p) => [
      ...(p.birthday
        ? [
            {
              employeeId: p.id,
              userId: p.userId,
              name: `${p.firstName} ${p.lastName}`,
              kind: "BIRTHDAY",
              years: null,
            },
          ]
        : []),
      ...(p.anniversary
        ? [
            {
              employeeId: p.id,
              userId: p.userId,
              name: `${p.firstName} ${p.lastName}`,
              kind: "WORK_ANNIVERSARY",
              years: p.years,
            },
          ]
        : []),
    ]),
  };
}
export async function celebrations(req: NextRequest, ctx: Context) {
  const { today, events } = await todayEvents(ctx);
  if (req.method === "GET") {
    const wishes = await db.celebrationWish.findMany({
      where: { companyId: ctx.companyId, date: dayDate(today) },
      select: { employeeId: true, kind: true, emoji: true, userId: true },
    });
    return {
      today,
      events: events.map(({ userId: _userId, ...event }) => {
        const entries = wishes.filter(
          (w) => w.employeeId === event.employeeId && w.kind === event.kind,
        );
        return {
          ...event,
          wishes: wishEmojis.map((emoji) => ({
            emoji,
            count: entries.filter((w) => w.emoji === emoji).length,
          })),
          myWish: entries.find((w) => w.userId === ctx.userId)?.emoji ?? null,
        };
      }),
    };
  }
  if (req.method !== "POST") throw new AppError(405, "Method not allowed.");
  await rateLimit(`wish:${ctx.userId}`, 100);
  const b = z
    .object({
      employeeId: z.string(),
      kind: z.enum(["BIRTHDAY", "WORK_ANNIVERSARY"]),
      emoji: z.enum(wishEmojis),
    })
    .strict()
    .parse(await json(req));
  const event = events.find(
    (e) => e.employeeId === b.employeeId && e.kind === b.kind,
  );
  if (!event)
    throw new AppError(404, "This celebration is not available today.");
  const key = {
    companyId: ctx.companyId,
    employeeId: b.employeeId,
    userId: ctx.userId,
    kind: b.kind,
    date: dayDate(today),
  };
  await db.$transaction(async (tx) => {
    const created = await tx.celebrationWish.createMany({
      data: [{ ...key, emoji: b.emoji }],
      skipDuplicates: true,
    });
    if (!created.count)
      await tx.celebrationWish.update({
        where: { companyId_employeeId_userId_kind_date: key },
        data: { emoji: b.emoji },
      });
    if (created.count && event.userId && event.userId !== ctx.userId)
      await tx.notification.create({
        data: {
          companyId: ctx.companyId,
          userId: event.userId,
          event: "celebration.wish",
          title: `${b.emoji} A wish from ${ctx.name}`,
          body: `${ctx.name} wished you a happy ${b.kind === "BIRTHDAY" ? "birthday" : "work anniversary"}.`,
          link: "/home",
        },
      });
  });
  return { saved: true };
}
