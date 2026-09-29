import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";

export function deductedBreakMinutes(
  scheduled: number,
  breaks: { startedAt: Date; endedAt: Date | null }[],
  end: Date,
) {
  const actual = Math.floor(
    breaks.reduce(
      (ms, b) =>
        ms + Math.max(0, (b.endedAt ?? end).getTime() - b.startedAt.getTime()),
      0,
    ) / 60000,
  );
  // The scheduled deduction is the minimum. Recorded breaks are never added
  // on top of it: only longer actual unpaid breaks increase the deduction.
  return Math.max(scheduled, actual);
}
export async function finalizeWork(
  tx: Prisma.TransactionClient,
  companyId: string,
  attendanceId: string,
  checkIn: Date,
  checkOut: Date,
  scheduled: number,
) {
  const where = { companyId, attendanceId };
  const [breaks, logs] = await Promise.all([
    tx.attendanceBreak.findMany({ where }),
    tx.workLog.findMany({ where }),
  ]);
  if (
    [...breaks, ...logs].some(
      (r) =>
        r.startedAt < checkIn ||
        r.startedAt > checkOut ||
        (r.endedAt && r.endedAt > checkOut),
    )
  )
    throw new AppError(
      409,
      "These attendance times exclude recorded job or break activity. Review the activity evidence before correcting attendance.",
    );
  await tx.attendanceBreak.updateMany({
    where: { ...where, endedAt: null },
    data: { endedAt: checkOut },
  });
  await tx.workLog.updateMany({
    where: { ...where, endedAt: null },
    data: { endedAt: checkOut },
  });
  return deductedBreakMinutes(scheduled, breaks, checkOut);
}
