import { Prisma } from "@prisma/client";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeDay, dayDate, shiftSnapshot } from "@/modules/time/rules";
import {
  closedWithoutHours,
  dayPlan,
  eligible,
  overlapsLeave,
  overtimeNeedsApproval,
} from "@/modules/time/service";
import type { RawPunch } from "./connectors";

type Tx = Prisma.TransactionClient;
type Device = {
  id: string;
  companyId: string;
  serialNumber: string;
  autoMapByCode: boolean;
};
export type SyncTrigger = "PUSH" | "MANUAL" | "SCHEDULED" | "RETRY";
type Outcome =
  "PROCESSED" | "UNMAPPED" | "IGNORED" | "REJECTED" | "FAILED" | "PENDING";
const maxAttempts = 8;
// Days HR has set, or that wait for a missed-punch decision, are not changed
// by device punches.
const locked = (a: { source: string; status: string }) =>
  ["Manual", "Regularization"].includes(a.source) ||
  ["ABSENT", "PENDING_REVIEW"].includes(a.status) ||
  (a.status === "MISSED_PUNCH" && a.source !== "Biometric");

// Stores punches (duplicates are skipped), applies them to attendance and
// records a sync log. Call within the device company's tenant scope.
export async function ingest(
  device: Device,
  punches: RawPunch[],
  trigger: SyncTrigger,
  rejected = 0,
) {
  const log = await db.deviceSyncLog.create({
    data: {
      companyId: device.companyId,
      deviceId: device.id,
      trigger,
      received: punches.length + rejected,
    },
  });
  try {
    const inserted = punches.length
      ? (
          await db.devicePunch.createMany({
            data: punches.map((p) => ({
              companyId: device.companyId,
              deviceId: device.id,
              deviceUserId: p.deviceUserId,
              punchedAt: p.punchedAt,
              directionHint: p.directionHint ?? null,
              verifyMode: p.verifyMode ?? null,
              ...(p.raw ? { raw: p.raw as Prisma.InputJsonValue } : {}),
            })),
            skipDuplicates: true,
          })
        ).count
      : 0;
    const result = await processPending(device.companyId, {
      deviceId: device.id,
    });
    const now = new Date();
    const latest = punches.reduce<Date | null>(
      (m, p) => (!m || p.punchedAt > m ? p.punchedAt : m),
      null,
    );
    await db.attendanceDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        lastSyncAt: now,
        lastError: null,
        ...(latest ? { lastPunchAt: latest } : {}),
      },
    });
    return db.deviceSyncLog.update({
      where: { id: log.id },
      data: {
        status: result.failed || rejected ? "PARTIAL" : "SUCCESS",
        inserted,
        duplicates: punches.length - inserted,
        processed: result.processed,
        unmapped: result.unmapped,
        failed: result.failed + rejected,
        finishedAt: now,
      },
    });
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Sync failed"
    ).slice(0, 300);
    await db.deviceSyncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    await db.attendanceDevice.update({
      where: { id: device.id },
      data: { lastError: message },
    });
    throw error;
  }
}

// Applies waiting punches in time order. Unmapped punches are retried only
// when asked (after a mapping change, a manual retry or the scheduled job).
export async function processPending(
  companyId: string,
  options: {
    deviceId?: string;
    includeUnmapped?: boolean;
    deviceUserIds?: string[];
    limit?: number;
  } = {},
) {
  const now = new Date();
  const punches = await db.devicePunch.findMany({
    where: {
      companyId,
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      ...(options.deviceUserIds
        ? { deviceUserId: { in: options.deviceUserIds } }
        : {}),
      OR: [
        { status: "PENDING" },
        { status: "FAILED", nextAttemptAt: { lte: now } },
        ...(options.includeUnmapped ? [{ status: "UNMAPPED" }] : []),
      ],
    },
    include: {
      device: {
        select: { id: true, serialNumber: true, autoMapByCode: true },
      },
    },
    orderBy: [{ punchedAt: "asc" }, { id: "asc" }],
    take: options.limit ?? 2000,
  });
  const counts = {
    processed: 0,
    unmapped: 0,
    ignored: 0,
    rejected: 0,
    failed: 0,
  };
  for (const p of punches) {
    let outcome: Outcome;
    try {
      outcome = await db.$transaction(
        async (tx) => {
          // Serialized with web, mobile and face punches of the company.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))::text`;
          return applyPunch(tx, companyId, p);
        },
        { timeout: 20000 },
      );
    } catch (error) {
      const attempts = p.attempts + 1;
      await db.devicePunch.update({
        where: { id: p.id },
        data: {
          status: "FAILED",
          attempts,
          reason: (error instanceof Error ? error.message : "Error").slice(
            0,
            300,
          ),
          nextAttemptAt:
            attempts >= maxAttempts
              ? null
              : new Date(Date.now() + Math.min(2 ** attempts, 60) * 60000),
        },
      });
      outcome = "FAILED";
    }
    if (outcome === "PROCESSED") counts.processed++;
    else if (outcome === "UNMAPPED") counts.unmapped++;
    else if (outcome === "IGNORED") counts.ignored++;
    else if (outcome === "REJECTED") counts.rejected++;
    else if (outcome === "FAILED") counts.failed++;
  }
  return counts;
}

async function applyPunch(
  tx: Tx,
  companyId: string,
  p: Prisma.DevicePunchGetPayload<{
    include: {
      device: { select: { id: true; serialNumber: true; autoMapByCode: true } };
    };
  }>,
): Promise<Outcome> {
  const mark = async (
    status: Outcome,
    reason: string | null,
    extra: { employeeId?: string; attendanceId?: string } = {},
  ) => {
    await tx.devicePunch.update({
      where: { id: p.id },
      data: {
        status,
        reason,
        ...extra,
        nextAttemptAt: null,
        processedAt: new Date(),
      },
    });
    return status;
  };
  const mapping = await tx.deviceUserMapping.findUnique({
    where: {
      companyId_deviceUserId: { companyId, deviceUserId: p.deviceUserId },
    },
    include: { employee: { include: { shift: true } } },
  });
  const e =
    mapping?.employee ??
    (p.device.autoMapByCode
      ? await tx.employee.findFirst({
          where: {
            companyId,
            employeeCode: { equals: p.deviceUserId, mode: "insensitive" },
          },
          include: { shift: true },
        })
      : null);
  if (!e)
    return mark("UNMAPPED", "No employee is mapped to this device user ID.");
  if (!eligible.includes(e.status))
    return mark("REJECTED", "The employee is not active.", {
      employeeId: e.id,
    });
  const at = p.punchedAt;
  const plan = await dayPlan(tx, companyId, e, at);
  const workDate = dayDate(plan.day);
  if (workDate < e.joinedAt)
    return mark("REJECTED", "The punch is before the joining date.", {
      employeeId: e.id,
    });
  if (await overlapsLeave(tx, companyId, e.id, workDate))
    return mark("REJECTED", "The employee has approved leave on this date.", {
      employeeId: e.id,
    });
  const closed = await tx.payrollRun.findFirst({
    where: {
      companyId,
      period: plan.day.slice(0, 7),
      status: { in: ["SUBMITTED", "APPROVED", "PROCESSED"] },
    },
    select: { id: true },
  });
  if (closed)
    return mark(
      "IGNORED",
      "Payroll for this month is under review or processed.",
      { employeeId: e.id },
    );
  const existing = await tx.attendance.findFirst({
    where: { companyId, employeeId: e.id, workDate },
  });
  if (existing && locked(existing))
    return mark(
      "IGNORED",
      "Attendance for this date was set by HR or is under review.",
      { employeeId: e.id, attendanceId: existing.id },
    );
  const snapshot = (checkIn: Date) => ({
    ...shiftSnapshot(checkIn, plan.timezone, plan.shift, plan.day),
    ...(plan.offDay ? { lateMinutes: 0 } : {}),
  });
  const rules = async (checkIn: Date, checkOut: Date) => {
    const s = snapshot(checkIn);
    return completeDay({
      checkIn,
      checkOut,
      breakMinutes: s.breakMinutes,
      expectedMinutes: s.expectedMinutes,
      scheduledEnd: s.scheduledEnd,
      shift: plan.shift,
      offDay: plan.offDay,
      overtimeRequiresApproval: await overtimeNeedsApproval(tx, companyId),
    });
  };
  const missing = (checkIn: Date) => ({
    checkOut: closedWithoutHours(checkIn),
    workedMinutes: 0,
    overtimeMinutes: 0,
    earlyExitMinutes: 0,
    overtimeStatus: "NONE",
    approvedOvertimeMinutes: 0,
    status: "MISSED_PUNCH",
    correctionReason:
      "Check-out punch missing. Submit a missed punch request to correct it.",
  });
  let saved;
  let direction: "IN" | "OUT";
  if (!existing) {
    // Only one open day per employee: an earlier day still open lost its
    // check-out punch. A punch older than the open day is itself incomplete.
    const open = await tx.attendance.findFirst({
      where: { companyId, employeeId: e.id, checkOut: null },
    });
    if (open && open.workDate < workDate)
      await tx.attendance.update({
        where: { id: open.id },
        data: missing(open.checkIn),
      });
    saved = await tx.attendance.create({
      data: {
        companyId,
        employeeId: e.id,
        checkIn: at,
        source: "Biometric",
        offDay: plan.offDay,
        ...snapshot(at),
        ...(open && open.workDate > workDate ? missing(at) : {}),
      },
    });
    direction = "IN";
  } else {
    const times = [existing.checkIn, existing.checkOut, at]
      .filter((t): t is Date => !!t)
      .filter(
        (t) => existing.status !== "MISSED_PUNCH" || t !== existing.checkOut,
      );
    if (
      existing.checkIn.getTime() === at.getTime() ||
      (existing.status !== "MISSED_PUNCH" &&
        existing.checkOut?.getTime() === at.getTime())
    )
      return mark("IGNORED", "Already applied.", {
        employeeId: e.id,
        attendanceId: existing.id,
      });
    const checkIn = new Date(Math.min(...times.map((t) => t.getTime())));
    const last = new Date(Math.max(...times.map((t) => t.getTime())));
    // Punches within a minute of each other are one scan.
    const checkOut = last.getTime() - checkIn.getTime() >= 60000 ? last : null;
    if (!checkOut && !existing.checkOut)
      return mark("IGNORED", "Within a minute of another punch.", {
        employeeId: e.id,
        attendanceId: existing.id,
      });
    saved = await tx.attendance.update({
      where: { id: existing.id },
      data: {
        checkIn,
        ...snapshot(checkIn),
        offDay: plan.offDay,
        ...(checkOut
          ? {
              checkOut,
              ...(await rules(checkIn, checkOut)),
              correctionReason: null,
            }
          : {}),
      },
    });
    direction = at.getTime() === checkIn.getTime() ? "IN" : "OUT";
  }
  await enqueueWebhook(
    tx,
    companyId,
    direction === "IN" ? "attendance.checked_in" : "attendance.checked_out",
    {
      attendanceId: saved.id,
      employeeId: e.id,
      workDate: saved.workDate.toISOString().slice(0, 10),
      checkIn: saved.checkIn.toISOString(),
      checkOut: saved.checkOut?.toISOString() ?? null,
      source: "Biometric",
    },
  );
  await tx.attendancePunch.create({
    data: {
      companyId,
      employeeId: e.id,
      attendanceId: saved.id,
      punchedAt: at,
      direction,
      source: "Biometric",
      deviceId: p.device.serialNumber,
    },
  });
  return mark("PROCESSED", null, { employeeId: e.id, attendanceId: saved.id });
}

// Guard for push endpoints: a device may restrict which IPs can post for it.
export function allowedIp(list: string[], ip: string) {
  if (!list.length) return true;
  if (!list.includes(ip))
    throw new AppError(403, "This device is not allowed from this address.");
  return true;
}
