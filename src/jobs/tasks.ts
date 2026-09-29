import { db, withSystem, withTenant } from "@/lib/db";
import { logger } from "@/lib/errors";
import { deliverDue } from "@/modules/integrations/outbound";
import { syncDueDevices } from "@/modules/biometric/service";
import { trainingReminders } from "@/modules/training/service";
import { billingReminders } from "@/modules/saas/billing";
import { runRetention, retentionCategories } from "@/modules/auth/retention";
import { purgeExpiredAI } from "@/modules/ai/service";
import { carryForward } from "@/modules/time/leave-admin";
import { runBackup } from "@/modules/platform/backup";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { localDay } from "@/modules/time/rules";
import { deliverPendingLeadNotifications } from "@/modules/saas/lead-notifications";

// Scheduled work (spec §66). Each task is idempotent, so a missed or
// repeated run is harmless. Patterns are cron in UTC.
const activeCompanies = () =>
  withSystem(() =>
    db.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, timezone: true },
    }),
  );
const eachCompany = async <T>(
  fn: (c: { id: string; timezone: string }) => Promise<T>,
) => {
  const out: T[] = [];
  for (const c of await activeCompanies())
    try {
      out.push(await withTenant(c.id, () => fn(c)));
    } catch (error) {
      logger.error(
        { companyId: c.id, error: String(error) },
        "Job failed for company",
      );
    }
  return out;
};
const sum = (rows: Record<string, number>[]) =>
  rows.reduce<Record<string, number>>((acc, r) => {
    for (const [k, v] of Object.entries(r)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
const day = 86400000;

// Documents expiring in 30, 7 or 1 days, sent once on each of those days.
async function documentExpiry(c: { id: string; timezone: string }) {
  const today = new Date(`${localDay(new Date(), c.timezone)}T00:00:00Z`);
  const targets = [30, 7, 1].map((d) => new Date(today.getTime() + d * day));
  const docs = await db.document.findMany({
    where: {
      companyId: c.id,
      expiresOn: { in: targets },
      status: { not: "REJECTED" },
    },
    select: {
      title: true,
      expiresOn: true,
      employee: { select: { userId: true, firstName: true, lastName: true } },
    },
  });
  const hr = docs.length
    ? await usersWithPermission(c.id, "documents.manage")
    : [];
  for (const d of docs)
    await notify(
      c.id,
      [d.employee?.userId, ...hr],
      "document.expiring",
      {
        title: d.title,
        employee: d.employee
          ? `${d.employee.firstName} ${d.employee.lastName}`
          : "the company",
        expiresOn: d.expiresOn!.toISOString().slice(0, 10),
      },
      "/documents",
    );
  return { documents: docs.length };
}

// Birthday and work-anniversary greetings on the company's local date.
async function greetings(c: { id: string; timezone: string }) {
  const today = localDay(new Date(), c.timezone);
  const [y, m, d] = today.split("-").map(Number);
  const since = new Date(`${today}T00:00:00Z`);
  const people = await db.$queryRaw<
    { userId: string; joined: boolean; years: number }[]
  >`
    SELECT "userId",
      (EXTRACT(MONTH FROM "joinedAt") = ${m} AND EXTRACT(DAY FROM "joinedAt") = ${d} AND EXTRACT(YEAR FROM "joinedAt") < ${y}) AS joined,
      (${y} - EXTRACT(YEAR FROM "joinedAt"))::int AS years
    FROM "employees"
    WHERE "companyId" = ${c.id} AND "status" <> 'Inactive' AND "userId" IS NOT NULL
      AND ((EXTRACT(MONTH FROM "dateOfBirth") = ${m} AND EXTRACT(DAY FROM "dateOfBirth") = ${d})
        OR (EXTRACT(MONTH FROM "joinedAt") = ${m} AND EXTRACT(DAY FROM "joinedAt") = ${d} AND EXTRACT(YEAR FROM "joinedAt") < ${y}))`;
  let sent = 0;
  for (const p of people) {
    const event = p.joined ? "anniversary" : "birthday";
    const already = await db.notification.count({
      where: {
        companyId: c.id,
        userId: p.userId,
        event,
        createdAt: { gte: since },
      },
    });
    if (already) continue;
    await notify(c.id, [p.userId], event, { years: p.years }, "/home");
    sent++;
  }
  return { greetings: sent };
}

// Carry forward the previous year's leave during the first week of January.
async function yearEnd(c: { id: string; timezone: string }) {
  const today = localDay(new Date(), c.timezone);
  if (!/^\d{4}-01-0[1-7]$/.test(today)) return { carried: 0 };
  const r = await carryForward(
    { companyId: c.id, userId: "system" },
    Number(today.slice(0, 4)) - 1,
  );
  return { carried: r.carried };
}

async function retention(c: { id: string }) {
  const policies = await db.retentionPolicy.findMany({
    where: { companyId: c.id, enabled: true },
  });
  let affected = 0;
  for (const p of policies)
    try {
      affected += (
        await runRetention(
          c.id,
          p.category as keyof typeof retentionCategories,
          false,
          "system",
        )
      ).affected;
    } catch (error) {
      // A legal hold or a policy below the minimum is reported, not fatal.
      logger.warn(
        { companyId: c.id, category: p.category, error: String(error) },
        "Retention skipped",
      );
    }
  return { removed: affected };
}

// Online payment orders never completed within 7 days are closed.
async function stalePayments() {
  const r = await withSystem(() =>
    db.payment.updateMany({
      where: {
        status: "CREATED",
        provider: "RAZORPAY",
        createdAt: { lt: new Date(Date.now() - 7 * day) },
      },
      data: {
        status: "FAILED",
        failureReason: "Checkout not completed within 7 days",
      },
    }),
  );
  return { expired: r.count };
}

export const tasks: Record<
  string,
  { pattern: string; run: () => Promise<Record<string, number>> }
> = {
  "contact-leads": {
    pattern: "*/5 * * * *",
    run: deliverPendingLeadNotifications,
  },
  webhooks: { pattern: "* * * * *", run: () => deliverDue(undefined, 500) },
  "biometric-sync": { pattern: "*/5 * * * *", run: () => syncDueDevices() },
  "training-reminders": {
    pattern: "15 * * * *",
    run: async () => sum(await eachCompany((c) => trainingReminders(c.id))),
  },
  "billing-reminders": { pattern: "30 0 * * *", run: () => billingReminders() },
  "document-expiry": {
    pattern: "30 1 * * *",
    run: async () => sum(await eachCompany(documentExpiry)),
  },
  greetings: {
    pattern: "0 * * * *",
    run: async () => sum(await eachCompany(greetings)),
  },
  "leave-year-end": {
    pattern: "0 2 * * *",
    run: async () => sum(await eachCompany(yearEnd)),
  },
  retention: {
    pattern: "30 21 * * *",
    run: async () => sum(await eachCompany(retention)),
  },
  "ai-retention": {
    pattern: "0 22 * * *",
    run: async () => {
      await purgeExpiredAI();
      return { runs: 1 };
    },
  },
  "stale-payments": { pattern: "45 * * * *", run: stalePayments },
  "backup-daily": {
    pattern: "30 20 * * *",
    run: async () => {
      await runBackup("DAILY");
      return { backups: 1 };
    },
  },
  "backup-weekly": {
    pattern: "0 21 * * 0",
    run: async () => {
      await runBackup("WEEKLY", { restoreTest: true });
      return { backups: 1 };
    },
  },
};

export async function runTask(name: string) {
  const task = tasks[name];
  if (!task) throw new Error(`Unknown job: ${name}`);
  const started = Date.now();
  try {
    const result = await task.run();
    logger.info(
      { job: name, ms: Date.now() - started, result },
      "Job finished",
    );
    return result;
  } catch (error) {
    logger.error(
      { job: name, ms: Date.now() - started, error: String(error) },
      "Job failed",
    );
    throw error;
  }
}
