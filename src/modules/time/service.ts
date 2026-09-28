import { createHash } from "node:crypto";
import { effectiveAttendanceStatus } from "./single-punch";
import {
  assertPayrollOpen,
  assertPayrollOpenRange,
} from "@/modules/payroll/compute";
import { balances, employeeHolidays } from "./leave-balance";
import { leaveAdminRoute } from "./leave-admin";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  requirePermission,
  rateLimit,
  type Context,
} from "@/modules/auth/service";
import {
  addDays,
  completeDay,
  localMinute,
  dayDate,
  distanceMeters,
  duration,
  localDay,
  shiftSnapshot,
  workingDays,
  zonedTime,
} from "./rules";
import {
  attendanceLocationSchema,
  correctionSchema,
  employeeLocationsSchema,
  day,
  fieldTrackingPointSchema,
  fieldTrackingStartSchema,
  holidaySchema,
  leaveSchema,
  leaveTypeSchema,
  listSchema,
  policySchema,
  punchSchema,
  regularizationReviewSchema,
  regularizationSchema,
  rosterSchema,
  overtimeReviewSchema,
  manualAttendanceSchema,
  shiftSchema,
} from "./validators";
import { verifyFace } from "@/modules/face/service";
import { requireFeature } from "@/modules/saas/service";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { notify, usersWithPermission } from "@/modules/notifications/service";

type Tx = Prisma.TransactionClient;
export const eligible = ["Active", "Probation", "On notice"];
const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  userId: true,
  branchId: true,
  attendanceMode: true,
  fieldTrackingAllowed: true,
  faceRequired: true,
  branch: { select: { id: true, name: true } },
} as const;
const fail = (message: string, status = 409): never => {
  throw new AppError(status, message);
};
async function own(ctx: Context, tx: Tx = db) {
  const e = await tx.employee.findFirst({
    where: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      status: { in: eligible },
    },
    include: { shift: true },
  });
  if (!e)
    return fail(
      "Your account needs a linked active employee record. Contact HR.",
      403,
    );
  return e;
}
async function employee(tx: Tx, ctx: Context, id: string) {
  const e = await tx.employee.findFirst({
    where: { id, companyId: ctx.companyId, status: { in: eligible } },
    include: { shift: true },
  });
  if (!e) return fail("Active employee not found.", 404);
  return e;
}
// Serializes Phase 2 mutations per company, including overlap and balance checks.
async function mutate<T>(ctx: Context, run: (tx: Tx) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.companyId}))::text`;
      return run(tx);
    },
    { timeout: 20000 },
  );
}
type ShiftRow = Prisma.ShiftGetPayload<object>;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
// The shift for a work date: a roster entry for that date (a shift or a
// weekly off) wins over the employee's default shift.
export async function shiftForDate(
  tx: Tx,
  companyId: string,
  e: { id: string; shift: ShiftRow | null },
  workDate: Date,
) {
  const r = await tx.rosterEntry.findFirst({
    where: { companyId, employeeId: e.id, workDate },
    include: { shift: true },
  });
  if (r) return r.weeklyOff || !r.shift?.active ? null : r.shift;
  return e.shift?.active ? e.shift : null;
}
// Work date, shift and off-day status for a punch at `at`. A rostered or
// default overnight shift from the previous day still running wins.
// Rostered weekly offs, non-working weekdays (without a rostered shift) and
// company holidays are off days.
export async function dayPlan(
  tx: Tx,
  companyId: string,
  e: { id: string; shift: ShiftRow | null },
  at: Date,
) {
  const c = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, workingDays: true },
  });
  const today = localDay(at, c.timezone),
    yesterday = addDays(today, -1);
  const entries = await tx.rosterEntry.findMany({
    where: {
      companyId,
      employeeId: e.id,
      workDate: { in: [dayDate(yesterday), dayDate(today)] },
    },
    include: { shift: true },
  });
  const forDay = (day: string) => {
    const r = entries.find((x) => dayKey(x.workDate) === day);
    return r
      ? {
          shift: !r.weeklyOff && r.shift?.active ? r.shift : null,
          weeklyOff: r.weeklyOff,
          rostered: true,
        }
      : {
          shift: e.shift?.active ? e.shift : null,
          weeklyOff: false,
          rostered: false,
        };
  };
  const previous = forDay(yesterday);
  const carried =
    !!previous.shift &&
    previous.shift.endMinute < previous.shift.startMinute &&
    localMinute(at, c.timezone) < previous.shift.endMinute;
  const day = carried ? yesterday : today;
  const plan = carried ? previous : forDay(day);
  const offDay =
    plan.weeklyOff ||
    (!plan.rostered && !c.workingDays.includes(dayDate(day).getUTCDay())) ||
    !!(await tx.holiday.findFirst({
      where: { companyId, date: dayDate(day), optional: false },
    }));
  return { day, shift: plan.shift, offDay, timezone: c.timezone };
}
// Matches the policy column default: overtime needs approval unless turned off.
// Face lockout and fallback settings, with the column defaults.
export async function faceRules(tx: Tx, companyId: string) {
  const p = await tx.attendancePolicy.findUnique({
    where: { companyId },
    select: {
      faceMaxFailedAttempts: true,
      faceLockoutMinutes: true,
      faceFallback: true,
    },
  });
  return {
    maxFailed: p?.faceMaxFailedAttempts ?? 5,
    lockoutMinutes: p?.faceLockoutMinutes ?? 15,
    fallback: p?.faceFallback ?? "NONE",
  };
}
export async function overtimeNeedsApproval(tx: Tx, companyId: string) {
  return (
    (
      await tx.attendancePolicy.findUnique({
        where: { companyId },
        select: { overtimeRequiresApproval: true },
      })
    )?.overtimeRequiresApproval ?? true
  );
}
function access(ctx: Context) {
  if (
    ![
      "attendance.self",
      "attendance.read",
      "timeoff.self",
      "timeoff.manage",
      "time.configure",
    ].some((p) => ctx.permissions.includes(p))
  )
    fail("You do not have access to time management.", 403);
}
async function policy(tx: Tx, companyId: string, branchId?: string | null) {
  const base = (await tx.attendancePolicy.findUnique({
    where: { companyId },
  })) ?? {
    companyId,
    gpsTrackingEnabled: false,
    fieldTrackingEnabled: false,
    fieldTrackingIntervalSeconds: 30,
    fieldTrackingMaxMinutes: 720,
    faceAttendanceEnabled: false,
    faceLivenessRequired: true,
    faceConfidenceThreshold: 0.8,
    overtimeRequiresApproval: true,
    geofenceEnabled: false,
    latitude: null,
    longitude: null,
    radiusMeters: 200,
  };
  if (branchId) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId },
    });
    if (branch?.geofenceEnabled)
      return {
        companyId,
        gpsTrackingEnabled: base.gpsTrackingEnabled,
        fieldTrackingEnabled: base.fieldTrackingEnabled,
        fieldTrackingIntervalSeconds: base.fieldTrackingIntervalSeconds,
        fieldTrackingMaxMinutes: base.fieldTrackingMaxMinutes,
        faceAttendanceEnabled: base.faceAttendanceEnabled,
        faceLivenessRequired: base.faceLivenessRequired,
        faceConfidenceThreshold: base.faceConfidenceThreshold,
        geofenceEnabled: true,
        latitude: branch.latitude,
        longitude: branch.longitude,
        radiusMeters: branch.radiusMeters,
        locationName: branch.name,
      };
  }
  return base;
}
function assignedLocations(tx: Tx, companyId: string, employeeId: string) {
  return tx.attendanceLocation.findMany({
    where: { companyId, active: true, employees: { some: { employeeId } } },
    orderBy: { name: "asc" },
  });
}
type PunchMeta = {
  employeeId: string;
  eventType: string;
  deviceId?: string;
  ip: string;
};
async function checkLocation(
  tx: Tx,
  companyId: string,
  loc: z.infer<typeof punchSchema>["location"] | undefined,
  branchId: string | null | undefined,
  attendanceMode: string,
  meta: PunchMeta,
) {
  const base = await policy(tx, companyId, branchId);
  if (attendanceMode === "OPEN") return undefined;
  // Assigned attendance locations replace the company or branch area.
  const assigned =
    attendanceMode === "GPS"
      ? []
      : await assignedLocations(tx, companyId, meta.employeeId);
  const p =
    attendanceMode === "GPS"
      ? { ...base, gpsTrackingEnabled: true, geofenceEnabled: false }
      : attendanceMode === "GEOFENCE"
        ? { ...base, geofenceEnabled: true }
        : base;
  const geofence = p.geofenceEnabled || assigned.length > 0;
  if (
    !assigned.length &&
    p.geofenceEnabled &&
    (p.latitude === null || p.longitude === null)
  )
    fail(
      "This employee requires a geofence, but no attendance area is configured.",
      422,
    );
  if ((p.gpsTrackingEnabled || geofence) && !loc)
    fail("Location permission is required to check in or out.", 422);
  if (!loc || (!p.gpsTrackingEnabled && !geofence)) return undefined;
  const zones = (
    assigned.length
      ? assigned
      : geofence
        ? [
            {
              id: null,
              name:
                "locationName" in p
                  ? String(p.locationName)
                  : "Company attendance area",
              latitude: p.latitude!,
              longitude: p.longitude!,
              radiusMeters: p.radiusMeters,
            },
          ]
        : []
  )
    .map((z) => ({ ...z, distance: distanceMeters(loc, z) }))
    .sort((a, b) => a.distance - b.distance);
  const zone = zones.find((z) => z.distance <= z.radiusMeters) ?? zones[0];
  const event = {
    companyId,
    employeeId: meta.employeeId,
    latitude: loc.latitude,
    longitude: loc.longitude,
    accuracy: loc.accuracy,
    locationId: zone?.id ?? null,
    locationName: zone?.name ?? null,
    distanceMeters: zone ? Math.round(zone.distance) : null,
    inside: !!zone && zone.distance <= zone.radiusMeters,
    deviceId: meta.deviceId,
    ip: meta.ip,
  };
  if (geofence) {
    const [reason, message, status] =
      loc.accuracy > zone.radiusMeters
        ? [
            "LOW_ACCURACY",
            "Location accuracy is too low. Retry with GPS enabled.",
            422,
          ]
        : !event.inside
          ? [
              "OUTSIDE_AREA",
              "You are outside the configured attendance area.",
              403,
            ]
          : [];
    if (reason) {
      // Rejections are kept even though the punch transaction rolls back.
      await db.geofenceEvent.create({
        data: { ...event, eventType: meta.eventType, accepted: false, reason },
      });
      fail(message as string, status as number);
    }
  }
  return {
    event,
    recorded: {
      ...loc,
      recordedAt: new Date().toISOString(),
      deviceId: meta.deviceId ?? null,
      ip: meta.ip,
      ...(geofence
        ? {
            locationName: zone.name,
            distanceMeters: event.distanceMeters,
            radiusMeters: zone.radiusMeters,
          }
        : {}),
    },
  };
}
export async function overlapsLeave(
  tx: Tx,
  companyId: string,
  employeeId: string,
  workDate: Date,
) {
  return tx.leaveRequest.findFirst({
    where: {
      companyId,
      employeeId,
      status: "Approved",
      startDate: { lte: workDate },
      endDate: { gte: workDate },
    },
  });
}
async function attendanceConflict(
  tx: Tx,
  companyId: string,
  employeeId: string,
  startDate: Date,
  endDate: Date,
) {
  return tx.attendance.findFirst({
    where: {
      companyId,
      employeeId,
      workDate: { gte: startDate, lte: endDate },
    },
  });
}
async function summary(ctx: Context) {
  access(ctx);
  const company = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
  });
  const today = localDay(new Date(), company.timezone);
  const e = await db.employee.findFirst({
    where: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      status: { in: eligible },
    },
    select: { ...employeeSelect, shift: true },
  });
  const assigned = e ? await assignedLocations(db, ctx.companyId, e.id) : [];
  const [p, shifts, holidays, leaveTypes, open, current] = await Promise.all([
    policy(db, ctx.companyId),
    db.shift.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: "asc" },
    }),
    db.holiday.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { date: "asc" },
    }),
    db.leaveType.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: "asc" },
    }),
    e
      ? db.attendance.findFirst({
          where: { companyId: ctx.companyId, employeeId: e.id, checkOut: null },
        })
      : null,
    e
      ? db.attendance.findFirst({
          where: {
            companyId: ctx.companyId,
            employeeId: e.id,
            workDate: dayDate(today),
          },
        })
      : null,
  ]);
  return {
    today,
    timezone: company.timezone,
    workingDays: company.workingDays,
    employee: e,
    policy: p,
    faceRules: await faceRules(db, ctx.companyId),
    employeePolicy: e
      ? {
          ...(await policy(db, ctx.companyId, e.branchId)),
          ...(e.attendanceMode === "OPEN"
            ? { gpsTrackingEnabled: false, geofenceEnabled: false }
            : e.attendanceMode === "GPS"
              ? { gpsTrackingEnabled: true, geofenceEnabled: false }
              : e.attendanceMode === "GEOFENCE" || assigned.length
                ? { geofenceEnabled: true }
                : {}),
        }
      : await policy(db, ctx.companyId),
    assignedLocations: assigned.map(({ id, name, type }) => ({
      id,
      name,
      type,
    })),
    locations: await db.branch.findMany({
      where: { companyId: ctx.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    shifts,
    holidays,
    leaveTypes,
    open,
    current,
  };
}
async function punch(req: NextRequest, ctx: Context, action: string) {
  requirePermission(ctx, "attendance.self");
  const b = punchSchema.parse(await json(req, 400000));
  if (b.faceSample || action === "face-punch")
    await rateLimit(`face-punch:${ctx.userId}`, 20);
  return mutate(ctx, async (tx) => {
    const e = await own(ctx, tx);
    const p = await policy(tx, ctx.companyId, e.branchId);
    let faceResult: { confidence: number; livenessPassed: boolean } | null =
      null;
    const faceNeeded =
      p.faceAttendanceEnabled || e.faceRequired || action === "face-punch";
    const rules = faceNeeded ? await faceRules(tx, ctx.companyId) : null;
    // With a fallback policy, plain check-in/out without a face sample is
    // allowed and labelled; face scans are still verified when sent.
    const fallback =
      faceNeeded &&
      action !== "face-punch" &&
      !b.faceSample &&
      rules?.fallback === "WEB";
    const sampleHash = b.faceSample
      ? createHash("sha256").update(b.faceSample).digest("hex")
      : null;
    if (faceNeeded && !fallback) {
      await requireFeature(ctx.companyId, "face");
      const since = new Date(Date.now() - rules!.lockoutMinutes * 60000);
      const failures = await db.faceVerificationLog.count({
        where: {
          companyId: ctx.companyId,
          employeeId: e.id,
          status: "FAILED",
          createdAt: { gte: since },
        },
      });
      if (failures >= rules!.maxFailed)
        throw new AppError(
          429,
          `Too many failed face scans. Try again after ${rules!.lockoutMinutes} minutes${rules!.fallback === "WEB" ? " or check in without face" : " or ask HR"}.`,
          "FACE_LOCKED",
        );
      if (!b.faceSample)
        throw new AppError(
          422,
          "Face verification is required for this employee.",
        );
      const profile = await tx.faceProfile.findFirst({
        where: { companyId: ctx.companyId, employeeId: e.id, active: true },
      });
      if (!profile)
        throw new AppError(
          422,
          "Face registration is required before attendance can be marked.",
        );
      // A frame that was already submitted is a replay, not a live scan.
      if (
        sampleHash &&
        (await db.faceVerificationLog.findFirst({
          where: { companyId: ctx.companyId, employeeId: e.id, sampleHash },
          select: { id: true },
        }))
      ) {
        await db.faceVerificationLog.create({
          data: {
            companyId: ctx.companyId,
            employeeId: e.id,
            status: "FAILED",
            reason: "REPLAYED_SAMPLE",
            deviceId: b.deviceId,
            ip: ip(req),
          },
        });
        throw new AppError(
          403,
          "This face image was already used. Scan again.",
          "FACE_REPLAYED",
        );
      }
      try {
        faceResult = await verifyFace(
          profile.templateCiphertext,
          b.faceSample,
          p.faceConfidenceThreshold,
          p.faceLivenessRequired,
        );
      } catch (error) {
        // Persist failure metadata independently of the rolled-back attendance transaction.
        await db.faceVerificationLog.create({
          data: {
            companyId: ctx.companyId,
            employeeId: e.id,
            status:
              error instanceof AppError && error.status === 503
                ? "REVIEW_REQUIRED"
                : "FAILED",
            reason:
              error instanceof AppError ? error.code : "VERIFICATION_ERROR",
            deviceId: b.deviceId,
            ip: ip(req),
            sampleHash,
          },
        });
        throw error;
      }
    }
    const located = await checkLocation(
      tx,
      ctx.companyId,
      b.location,
      e.branchId,
      e.attendanceMode,
      {
        employeeId: e.id,
        eventType: action.toUpperCase().replace("-", "_"),
        deviceId: b.deviceId,
        ip: ip(req),
      },
    );
    const recordedLocation = located?.recorded;
    const now = new Date();
    const plan = await dayPlan(tx, ctx.companyId, e, now);
    let viaFace = false;
    let open = await tx.attendance.findFirst({
      where: { companyId: ctx.companyId, employeeId: e.id, checkOut: null },
    });
    // A day still open from an earlier date that already has a pending missed
    // punch request is set aside for HR (no hours until reviewed), so it does
    // not block today's attendance. Approval writes the requested times;
    // rejection or withdrawal marks it absent.
    if (open) {
      if (
        dayKey(open.workDate) !== plan.day &&
        (await tx.attendanceRegularization.findFirst({
          where: {
            companyId: ctx.companyId,
            employeeId: e.id,
            workDate: open.workDate,
            status: "Pending",
          },
        }))
      ) {
        await tx.attendance.update({
          where: { id: open.id },
          data: pendingReview(open.checkIn),
        });
        open = null;
      }
    }
    if (action === "face-punch") {
      const workDate = dayDate(plan.day);
      if (open && open.workDate.getTime() !== workDate.getTime())
        throw new AppError(
          409,
          "Previous workday is still open. Submit a missed punch request for it or ask HR to correct it.",
        );
      open ??= await tx.attendance.findFirst({
        where: { companyId: ctx.companyId, employeeId: e.id, workDate },
      });
      if (
        open &&
        now.getTime() - (open.checkOut ?? open.checkIn).getTime() < 60000
      )
        throw new AppError(
          409,
          "Wait at least one minute between attendance scans.",
        );
      action = open ? "check-out" : "check-in";
      viaFace = true;
    }
    let saved;
    const source = viaFace
      ? "Face"
      : fallback
        ? "Face fallback"
        : req.nextUrl.pathname.startsWith("/api/v1/")
          ? "Mobile"
          : "Web";
    if (action === "check-in") {
      if (open) fail("You are already checked in. Check out first.");
      const snapshot = {
        ...shiftSnapshot(now, plan.timezone, plan.shift, plan.day),
        ...(plan.offDay ? { lateMinutes: 0 } : {}),
      };
      if (snapshot.workDate < e.joinedAt)
        fail("Attendance cannot precede your joining date.");
      if (await overlapsLeave(tx, ctx.companyId, e.id, snapshot.workDate))
        fail(
          "You have approved leave for this date. Contact HR to cancel it first.",
        );
      if (
        await attendanceConflict(
          tx,
          ctx.companyId,
          e.id,
          snapshot.workDate,
          snapshot.workDate,
        )
      )
        fail(
          "Attendance is already recorded for this work date. Contact HR for a correction.",
        );
      saved = await tx.attendance.create({
        data: {
          companyId: ctx.companyId,
          employeeId: e.id,
          checkIn: now,
          source,
          offDay: plan.offDay,
          ...snapshot,
          ...(recordedLocation
            ? { checkInLocation: recordedLocation as Prisma.InputJsonValue }
            : {}),
        },
      });
    } else {
      if (!open) return fail("You are not checked in.");
      if (now.getTime() - open.checkIn.getTime() > 36 * 3600000)
        fail(
          "This check-in is over 36 hours old. Submit a missed punch request or ask HR to correct it.",
        );
      saved = await tx.attendance.update({
        where: { id: open.id },
        data: {
          checkOut: now,
          ...completeDay({
            checkIn: open.checkIn,
            checkOut: now,
            breakMinutes: open.breakMinutes,
            expectedMinutes: open.expectedMinutes,
            scheduledEnd: open.scheduledEnd,
            shift: await shiftForDate(tx, ctx.companyId, e, open.workDate),
            offDay: open.offDay,
            overtimeRequiresApproval: await overtimeNeedsApproval(
              tx,
              ctx.companyId,
            ),
          }),
          ...(recordedLocation
            ? { checkOutLocation: recordedLocation as Prisma.InputJsonValue }
            : {}),
        },
      });
      await tx.fieldTrackingSession.updateMany({
        where: {
          companyId: ctx.companyId,
          employeeId: e.id,
          status: "ACTIVE",
        },
        data: { status: "STOPPED", endedAt: now },
      });
    }
    await tx.attendancePunch.create({
      data: {
        companyId: ctx.companyId,
        employeeId: e.id,
        attendanceId: saved.id,
        punchedAt: now,
        direction: action === "check-in" ? "IN" : "OUT",
        source,
        deviceId: b.deviceId ?? null,
        ip: ip(req),
        ...(recordedLocation
          ? { location: recordedLocation as Prisma.InputJsonValue }
          : {}),
      },
    });
    await audit(
      tx,
      ctx,
      action.toUpperCase(),
      "attendance",
      saved.id,
      undefined,
      { employeeId: e.id, workDate: saved.workDate.toISOString() },
      ip(req),
    );
    if (located)
      await tx.geofenceEvent.create({
        data: {
          ...located.event,
          eventType: action.toUpperCase().replace("-", "_"),
          attendanceId: saved.id,
          accepted: true,
        },
      });
    await enqueueWebhook(
      tx,
      ctx.companyId,
      // A face punch is a check-in or a check-out depending on the record.
      saved.checkOut ? "attendance.checked_out" : "attendance.checked_in",
      {
        attendanceId: saved.id,
        employeeId: e.id,
        employeeCode: e.employeeCode,
        workDate: saved.workDate.toISOString().slice(0, 10),
        checkIn: saved.checkIn.toISOString(),
        checkOut: saved.checkOut?.toISOString() ?? null,
      },
    );
    if (faceResult)
      await tx.faceVerificationLog.create({
        data: {
          companyId: ctx.companyId,
          employeeId: e.id,
          attendanceId: saved.id,
          status: "SUCCESS",
          confidence: faceResult.confidence,
          livenessPassed: faceResult.livenessPassed,
          deviceId: b.deviceId,
          ip: ip(req),
          sampleHash,
        },
      });
    return saved;
  });
}

async function expireFieldSessions(companyId: string) {
  await db.fieldTrackingSession.updateMany({
    where: { companyId, status: "ACTIVE", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED", endedAt: new Date() },
  });
}

function fieldTrackingScope(ctx: Context, employeeId?: string) {
  if (ctx.permissions.includes("attendance.read"))
    return { companyId: ctx.companyId, ...(employeeId ? { employeeId } : {}) };
  if (ctx.permissions.includes("fieldtracking.read"))
    return {
      companyId: ctx.companyId,
      employee: {
        OR: [{ userId: ctx.userId }, { manager: { userId: ctx.userId } }],
      },
      ...(employeeId ? { employeeId } : {}),
    };
  return { companyId: ctx.companyId, employee: { userId: ctx.userId } };
}

async function fieldTracking(
  req: NextRequest,
  ctx: Context,
  action: "list" | "start" | "point" | "stop",
  id?: string,
) {
  await expireFieldSessions(ctx.companyId);
  if (action === "list") {
    const q = z
      .object({
        employeeId: z.string().optional(),
        sessionId: z.string().optional(),
        history: z.enum(["true", "false"]).default("false"),
      })
      .parse(Object.fromEntries(req.nextUrl.searchParams));
    const canRead =
      ctx.permissions.includes("fieldtracking.read") ||
      ctx.permissions.includes("attendance.read");
    if (!canRead) requirePermission(ctx, "attendance.self");
    const where = {
      ...fieldTrackingScope(ctx, q.employeeId),
      ...(q.sessionId ? { id: q.sessionId } : {}),
    };
    const sessions = await db.fieldTrackingSession.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            userId: true,
            branch: { select: { name: true } },
          },
        },
        points: {
          orderBy: { recordedAt: "desc" },
          take: q.history === "true" ? 500 : 1,
        },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
    return sessions.map((session) => ({
      id: session.id,
      employee: session.employee,
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      lastSeenAt: session.lastSeenAt,
      points: session.points,
    }));
  }
  if (action === "start") {
    requirePermission(ctx, "attendance.self");
    const b = fieldTrackingStartSchema.parse(await json(req));
    return mutate(ctx, async (tx) => {
      const p = await policy(tx, ctx.companyId);
      if (!p.fieldTrackingEnabled)
        fail("Live field tracking is not enabled by your company.", 403);
      const e = await own(ctx, tx);
      const openAttendance = await tx.attendance.findFirst({
        where: { companyId: ctx.companyId, employeeId: e.id, checkOut: null },
      });
      if (!openAttendance)
        fail("Check in before starting live field tracking.", 409);
      if (!e.fieldTrackingAllowed)
        fail(
          "Live field tracking is not enabled for your employee account.",
          403,
        );
      const existing = await tx.fieldTrackingSession.findFirst({
        where: { companyId: ctx.companyId, employeeId: e.id, status: "ACTIVE" },
      });
      if (existing)
        fail("You already have an active field tracking session.", 409);
      const now = new Date();
      const session = await tx.fieldTrackingSession.create({
        data: {
          companyId: ctx.companyId,
          employeeId: e.id,
          consentAt: now,
          startDeviceId: b.deviceId,
          startedAt: now,
          expiresAt: new Date(
            now.getTime() + p.fieldTrackingMaxMinutes * 60000,
          ),
        },
      });
      await audit(
        tx,
        ctx,
        "FIELD_TRACKING_START",
        "field-tracking",
        session.id,
        undefined,
        {
          employeeId: e.id,
          consentAt: now.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
        },
        ip(req),
      );
      return {
        id: session.id,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        intervalSeconds: p.fieldTrackingIntervalSeconds,
      };
    });
  }
  if (action === "point") {
    requirePermission(ctx, "attendance.self");
    const b = fieldTrackingPointSchema.parse(await json(req));
    return mutate(ctx, async (tx) => {
      const e = await own(ctx, tx);
      const session = await tx.fieldTrackingSession.findFirst({
        where: {
          id: b.sessionId,
          companyId: ctx.companyId,
          employeeId: e.id,
          status: "ACTIVE",
        },
      });
      if (!session)
        throw new AppError(409, "Field tracking session is no longer active.");
      const now = new Date();
      if (session.expiresAt <= now) {
        await tx.fieldTrackingSession.update({
          where: { id: session.id },
          data: { status: "EXPIRED", endedAt: now },
        });
        fail("Field tracking session expired. Start a new session.", 409);
      }
      if (session.startDeviceId && session.startDeviceId !== b.deviceId)
        fail("This device is not the one that started tracking.", 403);
      if (
        session.lastSeenAt &&
        now.getTime() - session.lastSeenAt.getTime() < 5000
      )
        fail("Location updates are arriving too quickly.", 429);
      const branch = await tx.branch.findFirst({
        where: { id: e.branchId ?? "", companyId: ctx.companyId },
        select: { name: true },
      });
      const point = await tx.fieldTrackingPoint.create({
        data: {
          companyId: ctx.companyId,
          sessionId: session.id,
          employeeId: e.id,
          latitude: b.location.latitude,
          longitude: b.location.longitude,
          accuracy: b.location.accuracy,
          recordedAt: now,
          deviceId: b.deviceId,
          ip: ip(req),
          locationName: branch?.name,
        },
      });
      await tx.fieldTrackingSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      return point;
    });
  }
  if (action === "stop") {
    const session = await db.fieldTrackingSession.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { employee: { select: { userId: true } } },
    });
    if (!session) throw new AppError(404, "Field tracking session not found.");
    if (session.employee.userId !== ctx.userId)
      requirePermission(ctx, "fieldtracking.manage");
    if (session.status === "ACTIVE") {
      const now = new Date();
      await db.fieldTrackingSession.update({
        where: { id: session.id },
        data: { status: "STOPPED", endedAt: now },
      });
      await audit(
        db,
        ctx,
        "FIELD_TRACKING_STOP",
        "field-tracking",
        session.id,
        undefined,
        { stoppedBy: ctx.userId },
        ip(req),
      );
    }
    return { id: session.id, status: "STOPPED" };
  }
}
function range(q: ReturnType<typeof listSchema.parse>, today: string) {
  const from = q.from ?? today.slice(0, 7) + "-01",
    to = q.to ?? today;
  if (
    to < from ||
    dayDate(to).getTime() - dayDate(from).getTime() > 366 * 86400000
  )
    fail("Choose a date range of up to 366 days.", 422);
  return { gte: dayDate(from), lte: dayDate(to) };
}
async function listAttendance(req: NextRequest, ctx: Context) {
  const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const isCompany = q.scope === "company";
  requirePermission(ctx, isCompany ? "attendance.read" : "attendance.self");
  const e = isCompany ? null : await own(ctx);
  const c = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
    include: { attendancePolicy: true },
  });
  const where: Prisma.AttendanceWhereInput = {
    companyId: ctx.companyId,
    employeeId: e?.id ?? q.employeeId,
    workDate: range(q, localDay(new Date(), c.timezone)),
    ...(q.branchId ? { AND: [{ employee: { branchId: q.branchId } }] } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.overtimeStatus ? { overtimeStatus: q.overtimeStatus } : {}),
    ...(q.search
      ? {
          employee: {
            OR: [
              { firstName: { contains: q.search, mode: "insensitive" } },
              { lastName: { contains: q.search, mode: "insensitive" } },
              { employeeCode: { contains: q.search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
  const [items, total, totals] = await db.$transaction([
    db.attendance.findMany({
      where,
      include: {
        employee: { select: employeeSelect },
        _count: { select: { punches: true } },
      },
      orderBy: [{ workDate: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.attendance.count({ where }),
    db.attendance.aggregate({
      where,
      _sum: { workedMinutes: true, lateMinutes: true, overtimeMinutes: true },
    }),
  ]);
  return {
    items: items.map((a) => {
      const status = effectiveAttendanceStatus(
        a,
        c.attendancePolicy?.singlePunchStatus ?? "MISSED_PUNCH",
        localDay(new Date(), c.timezone),
      );
      return {
        ...a,
        status,
        singlePunchResolved:
          !a.checkOut &&
          status === "PRESENT" &&
          a.workDate < dayDate(localDay(new Date(), c.timezone)) &&
          (!a.scheduledEnd || a.scheduledEnd <= new Date()) &&
          a._count.punches <= 1,
      };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totals: totals._sum,
    timezone: c.timezone,
  };
}
async function roster(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "attendance.read");
  const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const c = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
    include: { attendancePolicy: true },
  });
  const today = localDay(new Date(), c.timezone),
    date = day.parse(req.nextUrl.searchParams.get("date") ?? today),
    at = dayDate(date);
  const where: Prisma.EmployeeWhereInput = {
    companyId: ctx.companyId,
    status: { in: eligible },
    joinedAt: { lte: at },
    ...(q.branchId ? { branchId: q.branchId } : {}),
    ...(q.search
      ? {
          OR: [
            { firstName: { contains: q.search, mode: "insensitive" } },
            { lastName: { contains: q.search, mode: "insensitive" } },
            { employeeCode: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [employees, total, holiday] = await Promise.all([
    db.employee.findMany({
      where,
      select: {
        ...employeeSelect,
        shift: true,
        attendance: {
          where: { workDate: at },
          include: { _count: { select: { punches: true } } },
        },
        rosterEntries: { where: { workDate: at }, include: { shift: true } },
        leaveRequests: {
          where: {
            status: "Approved",
            startDate: { lte: at },
            endDate: { gte: at },
          },
          select: { id: true },
        },
      },
      orderBy: { employeeCode: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.employee.count({ where }),
    db.holiday.findUnique({
      where: { companyId_date: { companyId: ctx.companyId, date: at } },
    }),
  ]);
  return {
    date,
    timezone: c.timezone,
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: employees.map(
      ({ attendance, leaveRequests, rosterEntries, ...e }) => {
        // The rostered shift or weekly off for the date replaces the default.
        const planned = rosterEntries[0];
        const a = attendance[0];
        const effective = a
          ? effectiveAttendanceStatus(
              a,
              c.attendancePolicy?.singlePunchStatus ?? "MISSED_PUNCH",
              today,
            )
          : null;
        return {
          ...e,
          shift: planned ? (planned.weeklyOff ? null : planned.shift) : e.shift,
          rostered: !!planned,
          attendance: a ? { ...a, status: effective } : null,
          status: a
            ? ((
                {
                  ABSENT: "Absent",
                  PENDING_REVIEW: "Awaiting HR review",
                  MISSED_PUNCH: "Missed punch",
                  HALF_DAY: "Half day",
                  SHORT: "Short",
                } as Record<string, string>
              )[effective!] ??
              (a.checkOut ||
              (date < today &&
                (!a.scheduledEnd || a.scheduledEnd <= new Date()) &&
                a._count.punches <= 1 &&
                effective === "PRESENT")
                ? "Present"
                : "Checked in"))
            : leaveRequests.length
              ? "On leave"
              : holiday
                ? "Holiday"
                : planned?.weeklyOff ||
                    (!planned && !c.workingDays.includes(at.getUTCDay()))
                  ? "Weekly off"
                  : date < today
                    ? "Absent"
                    : "Not checked in",
        };
      },
    ),
  };
}
async function saveCorrection(
  tx: Tx,
  ctx: Context,
  b: z.infer<typeof correctionSchema>,
  source: string,
  id?: string,
  keepCheckInLocation = false,
) {
  const e = await employee(tx, ctx, b.employeeId);
  const c = await tx.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
  });
  const checkIn = new Date(b.checkIn),
    checkOut = new Date(b.checkOut);
  if (
    checkOut <= checkIn ||
    checkOut > new Date() ||
    checkOut.getTime() - checkIn.getTime() > 36 * 3600000
  )
    fail(
      "Use past check-in/out times in order, no more than 36 hours apart.",
      422,
    );
  const plan = await dayPlan(tx, ctx.companyId, e, checkIn);
  const snapshot = {
    ...shiftSnapshot(checkIn, c.timezone, plan.shift, plan.day),
    ...(plan.offDay ? { lateMinutes: 0 } : {}),
  };
  if (snapshot.workDate < e.joinedAt)
    fail("Attendance cannot precede the joining date.", 422);
  await assertPayrollOpen(tx, ctx.companyId, snapshot.workDate);
  if (await overlapsLeave(tx, ctx.companyId, e.id, snapshot.workDate))
    fail("Attendance conflicts with approved leave.");
  const old = id
    ? await tx.attendance.findFirst({
        where: { id, companyId: ctx.companyId, employeeId: e.id },
      })
    : null;
  if (id && !old) fail("Attendance record not found.", 404);
  // Imported rows never overwrite an existing attendance record.
  if (
    !id &&
    (await attendanceConflict(
      tx,
      ctx.companyId,
      e.id,
      snapshot.workDate,
      snapshot.workDate,
    ))
  )
    fail(
      `Attendance already exists for ${e.employeeCode} on ${snapshot.workDate.toISOString().slice(0, 10)}.`,
    );
  const data = {
    ...snapshot,
    checkIn,
    checkOut,
    offDay: plan.offDay,
    ...completeDay({
      checkIn,
      checkOut,
      breakMinutes: snapshot.breakMinutes,
      expectedMinutes: snapshot.expectedMinutes,
      scheduledEnd: snapshot.scheduledEnd,
      shift: plan.shift,
      offDay: plan.offDay,
      overtimeRequiresApproval: await overtimeNeedsApproval(tx, ctx.companyId),
    }),
    overtimeReviewedBy: null,
    overtimeReviewedAt: null,
    source,
    correctionReason: b.reason,
  };
  const saved = old
    ? await tx.attendance.update({
        where: { id: old.id },
        data: {
          ...data,
          // A regularized check-out keeps the location of the unchanged, real check-in.
          checkInLocation:
            keepCheckInLocation &&
            old.checkInLocation &&
            old.checkIn.getTime() === checkIn.getTime()
              ? (old.checkInLocation as Prisma.InputJsonValue)
              : Prisma.DbNull,
          checkOutLocation: Prisma.DbNull,
        },
      })
    : await tx.attendance.create({
        data: { ...data, companyId: ctx.companyId, employeeId: e.id },
      });
  await audit(
    tx,
    ctx,
    old ? "CORRECT" : "ADD",
    "attendance",
    saved.id,
    old
      ? {
          checkIn: old.checkIn.toISOString(),
          checkOut: old.checkOut?.toISOString() ?? null,
        }
      : undefined,
    {
      reason: b.reason,
      source,
      employeeId: e.id,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
    },
  );
  return saved;
}
// HR approves (optionally fewer minutes) or rejects overtime awaiting review.
async function reviewOvertime(req: NextRequest, ctx: Context, id: string) {
  requirePermission(ctx, "attendance.manage");
  const b = overtimeReviewSchema.parse(await json(req));
  return mutate(ctx, async (tx) => {
    const a = await tx.attendance.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { employee: { select: { userId: true } } },
    });
    if (!a) return fail("Attendance record not found.", 404);
    if (a.overtimeStatus !== "PENDING")
      fail("This overtime is not awaiting review.");
    await assertPayrollOpen(tx, ctx.companyId, a.workDate);
    if (a.employee.userId === ctx.userId)
      fail("Another administrator must review your own overtime.", 403);
    const minutes =
      b.status === "APPROVED"
        ? Math.min(b.minutes ?? a.overtimeMinutes, a.overtimeMinutes)
        : 0;
    const saved = await tx.attendance.update({
      where: { id },
      data: {
        overtimeStatus: b.status,
        approvedOvertimeMinutes: minutes,
        overtimeReviewedBy: ctx.userId,
        overtimeReviewedAt: new Date(),
      },
    });
    await audit(
      tx,
      ctx,
      `OVERTIME_${b.status}`,
      "attendance",
      id,
      { overtimeMinutes: a.overtimeMinutes },
      { approvedOvertimeMinutes: minutes },
      ip(req),
    );
    return saved;
  });
}
const rosterQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).default(""),
  branchId: z.string().optional(),
});
// Planned shifts and weekly offs for up to 31 days, one page of employees.
async function listRosters(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "attendance.read");
  const q = rosterQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (q.to < q.from || addDays(q.from, 30) < q.to)
    fail("Choose a range of up to 31 days.", 422);
  const where: Prisma.EmployeeWhereInput = {
    companyId: ctx.companyId,
    status: { in: eligible },
    ...(q.branchId ? { branchId: q.branchId } : {}),
    ...(q.search
      ? {
          OR: [
            { firstName: { contains: q.search, mode: "insensitive" } },
            { lastName: { contains: q.search, mode: "insensitive" } },
            { employeeCode: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [employees, total] = await Promise.all([
    db.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        shift: { select: { id: true, name: true } },
        rosterEntries: {
          where: { workDate: { gte: dayDate(q.from), lte: dayDate(q.to) } },
          select: {
            workDate: true,
            shiftId: true,
            weeklyOff: true,
            note: true,
          },
        },
      },
      orderBy: [{ employeeCode: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.employee.count({ where }),
  ]);
  return {
    from: q.from,
    to: q.to,
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: employees.map(({ rosterEntries, ...e }) => ({
      ...e,
      entries: rosterEntries.map((r) => ({
        ...r,
        workDate: dayKey(r.workDate),
      })),
    })),
  };
}
// Sets or clears roster entries in bulk. Days that already have attendance
// keep their recorded shift; the roster applies to later punches.
async function saveRosters(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "time.configure");
  const b = rosterSchema.parse(await json(req, 200000));
  return mutate(ctx, async (tx) => {
    const employeeIds = [...new Set(b.entries.map((x) => x.employeeId))];
    const shiftIds = [
      ...new Set(b.entries.flatMap((x) => (x.shiftId ? [x.shiftId] : []))),
    ];
    const [employees, shifts] = await Promise.all([
      tx.employee.count({
        where: { companyId: ctx.companyId, id: { in: employeeIds } },
      }),
      tx.shift.count({
        where: { companyId: ctx.companyId, id: { in: shiftIds }, active: true },
      }),
    ]);
    if (employees !== employeeIds.length) fail("Employee not found.", 404);
    if (shifts !== shiftIds.length) fail("Active shift not found.", 404);
    let saved = 0,
      cleared = 0;
    for (const x of b.entries) {
      const key = {
        companyId_employeeId_workDate: {
          companyId: ctx.companyId,
          employeeId: x.employeeId,
          workDate: dayDate(x.workDate),
        },
      };
      if (!x.shiftId && !x.weeklyOff) {
        cleared += (
          await tx.rosterEntry.deleteMany({
            where: key.companyId_employeeId_workDate,
          })
        ).count;
        continue;
      }
      const data = { shiftId: x.shiftId, weeklyOff: x.weeklyOff, note: x.note };
      await tx.rosterEntry.upsert({
        where: key,
        create: {
          ...key.companyId_employeeId_workDate,
          ...data,
          createdBy: ctx.userId,
        },
        update: data,
      });
      saved++;
    }
    await audit(
      tx,
      ctx,
      "ROSTER_UPDATE",
      "rosters",
      undefined,
      undefined,
      { saved, cleared, employees: employeeIds.length },
      ip(req),
    );
    return { saved, cleared };
  });
}
async function correction(req: NextRequest, ctx: Context, id?: string) {
  requirePermission(ctx, "attendance.manage");
  const body = await json(req);
  // New manual entries may give a work date and local clock times instead
  // of full timestamps.
  if (!id && body && typeof body === "object" && "workDate" in body) {
    const m = manualAttendanceSchema.parse(body);
    const c = await db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
    });
    const checkIn = zonedTime(m.workDate, clockMinute(m.checkIn), c.timezone);
    let checkOut = zonedTime(m.workDate, clockMinute(m.checkOut), c.timezone);
    if (checkOut <= checkIn)
      checkOut = zonedTime(
        addDays(m.workDate, 1),
        clockMinute(m.checkOut),
        c.timezone,
      );
    return mutate(ctx, (tx) =>
      saveCorrection(
        tx,
        ctx,
        {
          employeeId: m.employeeId,
          checkIn: checkIn.toISOString(),
          checkOut: checkOut.toISOString(),
          reason: m.reason,
        },
        "Manual",
      ),
    );
  }
  const b = correctionSchema.parse(body);
  return mutate(ctx, (tx) => saveCorrection(tx, ctx, b, "Manual", id));
}
async function importAttendance(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "attendance.manage");
  const b = z
    .object({
      csv: z.string().min(1).max(50000),
      reason: z.string().trim().min(5).max(500),
    })
    .strict()
    .parse(await json(req));
  const lines = b.csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (lines.shift()?.trim() !== "employeeCode,checkIn,checkOut")
    fail("Expected CSV header: employeeCode,checkIn,checkOut", 422);
  if (!lines.length || lines.length > 100)
    fail("Import between 1 and 100 complete attendance rows at a time.", 422);
  const rows = lines.map((line, i) => {
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length !== 3 || parts.some((p) => p.includes('"')))
      fail(`Invalid CSV row ${i + 2}. Use three unquoted columns.`, 422);
    return {
      code: parts[0],
      checkIn: z.iso.datetime({ offset: true }).parse(parts[1]),
      checkOut: z.iso.datetime({ offset: true }).parse(parts[2]),
    };
  });
  return mutate(ctx, async (tx) => {
    for (const row of rows) {
      const e = await tx.employee.findUnique({
        where: {
          companyId_employeeCode: {
            companyId: ctx.companyId,
            employeeCode: row.code,
          },
        },
      });
      if (!e) fail(`Unknown employee code: ${row.code}`, 422);
      await saveCorrection(
        tx,
        ctx,
        {
          employeeId: e!.id,
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          reason: b.reason,
        },
        "Device CSV",
      );
    }
    return { imported: rows.length };
  });
}
// Request times as the company reads them, for notifications.
async function punchText(
  companyId: string,
  r: { workDate: Date; checkIn: Date; checkOut: Date },
) {
  const { timezone } = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return {
    workDate: r.workDate.toISOString().slice(0, 10),
    checkIn: time.format(r.checkIn),
    checkOut: time.format(r.checkOut),
  };
}
// Closes a day with no worked time: set aside while a missed punch request
// waits for HR, or marked absent. The database requires check-out after
// check-in, so these records end one second after it.
export const closedWithoutHours = (checkIn: Date) =>
  new Date(checkIn.getTime() + 1000);
// A day set aside while a missed punch request waits for HR.
const pendingReview = (checkIn: Date) => ({
  checkOut: closedWithoutHours(checkIn),
  workedMinutes: 0,
  lateMinutes: 0,
  overtimeMinutes: 0,
  earlyExitMinutes: 0,
  overtimeStatus: "NONE",
  approvedOvertimeMinutes: 0,
  status: "PENDING_REVIEW",
});
const clockMinute = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
async function requestRegularization(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "attendance.self");
  const b = regularizationSchema.parse(await json(req));
  return mutate(ctx, async (tx) => {
    const e = await own(ctx, tx),
      c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    const workDate = dayDate(b.workDate);
    if (b.workDate > localDay(new Date(), c.timezone) || workDate < e.joinedAt)
      fail("Choose a work date between your joining date and today.", 422);
    if (await overlapsLeave(tx, ctx.companyId, e.id, workDate))
      fail("You have approved leave for this date.");
    const existing = await tx.attendance.findFirst({
      where: { companyId: ctx.companyId, employeeId: e.id, workDate },
    });
    if (existing?.checkOut && existing.status !== "MISSED_PUNCH")
      fail(
        "Attendance for this date is already complete. Contact HR if it needs a correction.",
      );
    if (!existing && !b.checkIn)
      fail("Enter the check-in time you missed.", 422);
    // An open record keeps its real check-in; only the missed check-out is claimed.
    const checkIn =
      existing?.checkIn ??
      zonedTime(b.workDate, clockMinute(b.checkIn!), c.timezone);
    const inDay = localDay(checkIn, c.timezone);
    let checkOut = zonedTime(inDay, clockMinute(b.checkOut), c.timezone);
    if (checkOut <= checkIn)
      checkOut = zonedTime(
        addDays(inDay, 1),
        clockMinute(b.checkOut),
        c.timezone,
      );
    if (checkOut > new Date())
      fail("Check-out time cannot be in the future.", 422);
    if (!existing) {
      const actual = dayDate(
        (await dayPlan(tx, ctx.companyId, e, checkIn)).day,
      );
      if (actual.getTime() !== workDate.getTime())
        fail(
          `This check-in belongs to work date ${actual.toISOString().slice(0, 10)} under your shift.`,
          422,
        );
    }
    if (
      await tx.attendanceRegularization.findFirst({
        where: {
          companyId: ctx.companyId,
          employeeId: e.id,
          workDate,
          status: "Pending",
        },
      })
    )
      fail("A missed punch request for this date is already pending.");
    const saved = await tx.attendanceRegularization.create({
      data: {
        companyId: ctx.companyId,
        employeeId: e.id,
        workDate,
        checkIn,
        checkOut,
        reason: b.reason,
      },
    });
    await audit(
      tx,
      ctx,
      "REQUEST",
      "attendance_regularization",
      saved.id,
      undefined,
      {
        workDate: b.workDate,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
      },
      ip(req),
    );
    return saved;
  });
}
async function listRegularizations(req: NextRequest, ctx: Context) {
  const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const isCompany = q.scope === "company";
  requirePermission(ctx, isCompany ? "attendance.manage" : "attendance.self");
  const e = isCompany ? null : await own(ctx);
  const status = z
    .enum(["Pending", "Approved", "Rejected", "Cancelled"])
    .optional()
    .parse(req.nextUrl.searchParams.get("status") || undefined);
  const where: Prisma.AttendanceRegularizationWhereInput = {
    companyId: ctx.companyId,
    employeeId: e?.id ?? q.employeeId,
    ...(status ? { status } : {}),
  };
  const [items, total, c] = await Promise.all([
    db.attendanceRegularization.findMany({
      where,
      include: { employee: { select: employeeSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.attendanceRegularization.count({ where }),
    db.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
  ]);
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    timezone: c.timezone,
  };
}
async function reviewRegularization(
  req: NextRequest,
  ctx: Context,
  id: string,
) {
  const b = regularizationReviewSchema.parse(await json(req));
  if (b.status === "Cancelled") access(ctx);
  else requirePermission(ctx, "attendance.manage");
  return mutate(ctx, async (tx) => {
    const old = await tx.attendanceRegularization.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { employee: { select: { userId: true } } },
    });
    if (!old) return fail("Missed punch request not found.", 404);
    if (old.status !== "Pending")
      fail("This request has already been reviewed.");
    const mine = old.employee.userId === ctx.userId;
    if (b.status === "Cancelled") {
      if (
        !(mine && ctx.permissions.includes("attendance.self")) &&
        !ctx.permissions.includes("attendance.manage")
      )
        fail("You cannot cancel this request.", 403);
    } else if (mine)
      fail("Another HR administrator must review your own request.", 403);
    if (b.status !== "Cancelled")
      await assertPayrollOpen(tx, ctx.companyId, old.workDate);
    let attendanceId: string | null = null;
    if (b.status === "Approved") {
      const current = await tx.attendance.findFirst({
        where: {
          companyId: ctx.companyId,
          employeeId: old.employeeId,
          workDate: old.workDate,
        },
      });
      if (
        current?.checkOut &&
        !["PENDING_REVIEW", "MISSED_PUNCH"].includes(current.status)
      )
        fail(
          "Attendance for this date was completed after the request. Reject it or correct attendance directly.",
        );
      // Approval writes attendance through the audited HR correction path.
      const saved = await saveCorrection(
        tx,
        ctx,
        {
          employeeId: old.employeeId,
          checkIn: old.checkIn.toISOString(),
          checkOut: old.checkOut.toISOString(),
          reason: `Missed punch approved: ${old.reason}`.slice(0, 500),
        },
        "Regularization",
        current?.id,
        true,
      );
      attendanceId = saved.id;
    }
    if (b.status === "Rejected" || b.status === "Cancelled") {
      // Without an approved correction the day counts as absent. A record left
      // open by the missed check-out, or set aside for review, is closed as
      // absent with no hours; a day without any record is already absent. A
      // withdrawn request leaves a still-open day open for a later correction.
      const current = await tx.attendance.findFirst({
        where: {
          companyId: ctx.companyId,
          employeeId: old.employeeId,
          workDate: old.workDate,
          OR: [
            ...(b.status === "Rejected"
              ? [{ checkOut: null }, { status: "MISSED_PUNCH" }]
              : []),
            { status: "PENDING_REVIEW" },
          ],
        },
      });
      if (current)
        attendanceId = (
          await tx.attendance.update({
            where: { id: current.id },
            data: {
              checkOut: closedWithoutHours(current.checkIn),
              workedMinutes: 0,
              lateMinutes: 0,
              overtimeMinutes: 0,
              earlyExitMinutes: 0,
              overtimeStatus: "NONE",
              approvedOvertimeMinutes: 0,
              status: "ABSENT",
              correctionReason: `Missed punch ${
                b.status === "Rejected" ? "rejected" : "withdrawn"
              }${b.note ? `: ${b.note}` : ""}`.slice(0, 500),
            },
          })
        ).id;
    }
    const saved = await tx.attendanceRegularization.update({
      where: { id },
      data: {
        status: b.status,
        reviewNote: b.note,
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        attendanceId,
      },
    });
    await audit(
      tx,
      ctx,
      b.status.toUpperCase(),
      "attendance_regularization",
      id,
      { status: old.status },
      { status: b.status, note: b.note, attendanceId },
      ip(req),
    );
    return saved;
  });
}
async function locations(
  req: NextRequest,
  ctx: Context,
  resource: string,
  id?: string,
) {
  if (req.method === "GET" && resource === "locations") {
    if (
      !ctx.permissions.includes("time.configure") &&
      !ctx.permissions.includes("attendance.read")
    )
      fail("You cannot view attendance locations.", 403);
    const items = await db.attendanceLocation.findMany({
      where: { companyId: ctx.companyId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    });
    return items.map(({ _count, ...l }) => ({
      ...l,
      employeeCount: _count.employees,
    }));
  }
  requirePermission(ctx, "time.configure");
  if (resource === "employee-locations" && req.method === "GET") {
    const employeeId = z
      .string()
      .min(1)
      .parse(req.nextUrl.searchParams.get("employeeId"));
    return (
      await db.employeeLocation.findMany({
        where: { companyId: ctx.companyId, employeeId },
        select: { locationId: true },
      })
    ).map((l) => l.locationId);
  }
  if (resource === "employee-locations" && req.method === "PUT") {
    const b = employeeLocationsSchema.parse(await json(req));
    return mutate(ctx, async (tx) => {
      const e = await employee(tx, ctx, b.employeeId);
      const ids = [...new Set(b.locationIds)];
      if (
        (await tx.attendanceLocation.count({
          where: { companyId: ctx.companyId, id: { in: ids } },
        })) !== ids.length
      )
        fail("Attendance location not found.", 404);
      const old = await tx.employeeLocation.findMany({
        where: { companyId: ctx.companyId, employeeId: e.id },
        select: { locationId: true },
      });
      await tx.employeeLocation.deleteMany({
        where: { companyId: ctx.companyId, employeeId: e.id },
      });
      await tx.employeeLocation.createMany({
        data: ids.map((locationId) => ({
          companyId: ctx.companyId,
          employeeId: e.id,
          locationId,
        })),
      });
      await audit(
        tx,
        ctx,
        "ASSIGN_LOCATIONS",
        "attendance_locations",
        e.id,
        { locationIds: old.map((l) => l.locationId) },
        { locationIds: ids },
        ip(req),
      );
      return { employeeId: e.id, locationIds: ids };
    });
  }
  const b = attendanceLocationSchema.parse(await json(req));
  return mutate(ctx, async (tx) => {
    const old = id
      ? await tx.attendanceLocation.findFirst({
          where: { id, companyId: ctx.companyId },
        })
      : null;
    if (id && !old) fail("Attendance location not found.", 404);
    const saved = old
      ? await tx.attendanceLocation.update({ where: { id: old.id }, data: b })
      : await tx.attendanceLocation.create({
          data: { ...b, companyId: ctx.companyId },
        });
    await audit(
      tx,
      ctx,
      old ? "UPDATE" : "CREATE",
      "attendance_locations",
      saved.id,
      old ?? undefined,
      b,
      ip(req),
    );
    return saved;
  });
}
async function geofenceEvents(req: NextRequest, ctx: Context) {
  const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const isCompany = q.scope === "company";
  requirePermission(ctx, isCompany ? "attendance.read" : "attendance.self");
  const e = isCompany ? null : await own(ctx);
  const c = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
  });
  const r = range(q, localDay(new Date(), c.timezone));
  const where: Prisma.GeofenceEventWhereInput = {
    companyId: ctx.companyId,
    employeeId: e?.id ?? q.employeeId,
    createdAt: { gte: r.gte, lt: new Date(r.lte.getTime() + 2 * 86400000) },
  };
  const [items, total] = await db.$transaction([
    db.geofenceEvent.findMany({
      where,
      include: { employee: { select: employeeSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.geofenceEvent.count({ where }),
  ]);
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    timezone: c.timezone,
  };
}

// Balances include monthly accrual, carry-forward, adjustments, encashment
// and comp-off credits (leave-balance.ts).
export { balances };
async function listLeave(req: NextRequest, ctx: Context) {
  const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  requirePermission(
    ctx,
    q.scope === "company"
      ? "timeoff.manage"
      : q.scope === "team"
        ? "timeoff.team.read"
        : "timeoff.self",
  );
  const e = q.scope === "company" ? null : await own(ctx);
  const status = z
    .enum(["Pending", "Approved", "Rejected", "Cancelled"])
    .optional()
    .parse(req.nextUrl.searchParams.get("status") || undefined);
  // Managers see requests of their direct reports.
  const where: Prisma.LeaveRequestWhereInput = {
    companyId: ctx.companyId,
    ...(q.scope === "team"
      ? { employee: { managerId: e!.id } }
      : { employeeId: e?.id ?? q.employeeId }),
    ...(status ? { status } : {}),
  };
  const [items, total] = await db.$transaction([
    db.leaveRequest.findMany({
      where,
      include: { employee: { select: employeeSelect }, leaveType: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.leaveRequest.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}
async function requestLeave(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "timeoff.self");
  const b = leaveSchema.parse(await json(req));
  return mutate(ctx, async (tx) => {
    const e = await own(ctx, tx),
      c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (
      b.startDate < localDay(new Date(), c.timezone) ||
      dayDate(b.startDate) < e.joinedAt
    )
      fail(
        "Leave must start today or later and on or after your joining date.",
        422,
      );
    const startDate = dayDate(b.startDate),
      endDate = dayDate(b.endDate);
    const type = await tx.leaveType.findFirst({
      where: { id: b.leaveTypeId, companyId: ctx.companyId, active: true },
    });
    if (!type) return fail("Active leave type not found.", 404);
    if (b.halfDay) {
      if (b.startDate !== b.endDate || !b.session)
        fail("A half day covers one date and a first or second half.", 422);
      if (!type.halfDayAllowed)
        fail("This leave type cannot be taken as a half day.", 422);
    }
    const overlapping = await tx.leaveRequest.findMany({
      where: {
        companyId: ctx.companyId,
        employeeId: e.id,
        status: { in: ["Pending", "Approved"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    // The two halves of one date can be separate requests.
    if (
      overlapping.some(
        (o) => !(b.halfDay && o.halfDay && o.session !== b.session),
      )
    )
      fail("Leave dates overlap another pending or approved request.");
    if (
      !b.halfDay &&
      (await attendanceConflict(tx, ctx.companyId, e.id, startDate, endDate))
    )
      fail("Leave dates already have attendance recorded.");
    // Company holidays and the employee's chosen optional holidays.
    const holidays = await employeeHolidays(
      tx,
      ctx.companyId,
      e.id,
      startDate,
      endDate,
    );
    const working = workingDays(
      b.startDate,
      b.endDate,
      c.workingDays,
      holidays,
    );
    if (!working) fail("This range contains no working days.", 422);
    const days = b.halfDay ? 0.5 : working;
    // Unpaid leave (loss of pay) is not limited by a balance.
    if (type.paid) {
      const balance = (
        await balances(ctx, e.id, Number(b.startDate.slice(0, 4)), tx)
      ).find((t) => t.id === type.id)!;
      if (days > balance.remaining)
        fail("Insufficient leave balance, including pending requests.");
    }
    const saved = await tx.leaveRequest.create({
      data: {
        companyId: ctx.companyId,
        employeeId: e.id,
        leaveTypeId: type.id,
        startDate,
        endDate,
        days,
        reason: b.reason,
        halfDay: b.halfDay,
        session: b.halfDay ? b.session : null,
      },
    });
    await enqueueWebhook(tx, ctx.companyId, "leave.created", {
      id: saved.id,
      employeeId: e.id,
      employeeCode: e.employeeCode,
      leaveType: type.name,
      startDate: b.startDate,
      endDate: b.endDate,
      days,
    });
    await audit(
      tx,
      ctx,
      "REQUEST",
      "leave",
      saved.id,
      undefined,
      { days, startDate: b.startDate, endDate: b.endDate },
      ip(req),
    );
    return saved;
  });
}
async function reviewLeave(req: NextRequest, ctx: Context, id: string) {
  const b = z
    .object({
      status: z.enum(["Approved", "Rejected", "Cancelled"]),
      note: z.string().trim().max(500).default(""),
    })
    .strict()
    .parse(await json(req));
  if (b.status === "Cancelled") access(ctx);
  return mutate(ctx, async (tx) => {
    const old = await tx.leaveRequest.findFirst({
      where: { id, companyId: ctx.companyId },
      include: {
        employee: {
          select: {
            userId: true,
            manager: { select: { userId: true } },
          },
        },
        leaveType: { select: { approvalLevels: true } },
      },
    });
    if (!old) return fail("Leave request not found.", 404);
    const mine = old.employee.userId === ctx.userId;
    // Approving leave, or cancelling approved leave, changes paid days.
    if (b.status === "Approved" || old.status === "Approved")
      await assertPayrollOpenRange(
        tx,
        ctx.companyId,
        old.startDate,
        old.endDate,
      );
    if (b.status === "Cancelled") {
      if (
        !(mine && ctx.permissions.includes("timeoff.self")) &&
        !ctx.permissions.includes("timeoff.manage")
      )
        fail("You cannot cancel this request.", 403);
      if (!["Pending", "Approved"].includes(old.status))
        fail("This request is already closed.");
      const c = await tx.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
      });
      if (mine && old.startDate < dayDate(localDay(new Date(), c.timezone)))
        fail("Ask HR to cancel leave that has already started.");
    } else {
      if (mine)
        fail("Another HR administrator must review your own leave.", 403);
      if (old.status !== "Pending")
        fail("This request has already been reviewed.");
      // Two-level types: the reporting manager first, then HR. Without a
      // manager login, HR's approval is final.
      const managerUser = old.employee.manager?.userId ?? null;
      const twoLevel = old.leaveType.approvalLevels > 1 && !!managerUser;
      const hr = ctx.permissions.includes("timeoff.manage");
      const isManager = managerUser === ctx.userId;
      if (!hr && !(twoLevel && old.level === 1 && isManager))
        fail("You do not have permission for this action.", 403);
      const history = Array.isArray(old.approvals)
        ? (old.approvals as Prisma.JsonArray)
        : [];
      if (
        old.level > 1 &&
        history.some(
          (h) =>
            !!h &&
            typeof h === "object" &&
            (h as { by?: string }).by === ctx.userId,
        )
      )
        fail("A different person must give the final approval.", 403);
      if (b.status === "Approved" && twoLevel && old.level === 1) {
        const next = await tx.leaveRequest.update({
          where: { id },
          data: {
            level: 2,
            approvals: [
              ...history,
              {
                level: 1,
                by: ctx.userId,
                name: ctx.name,
                at: new Date().toISOString(),
                note: b.note,
              },
            ],
          },
        });
        await audit(
          tx,
          ctx,
          "APPROVE_LEVEL_1",
          "leave",
          id,
          { level: 1 },
          { level: 2, note: b.note },
          ip(req),
        );
        return next;
      }
      if (
        b.status === "Approved" &&
        (await attendanceConflict(
          tx,
          ctx.companyId,
          old.employeeId,
          old.startDate,
          old.endDate,
        ))
      )
        fail(
          "Attendance now exists for these dates. Reject or cancel this request.",
        );
    }
    const saved = await tx.leaveRequest.update({
      where: { id },
      data: {
        status: b.status,
        reviewNote: b.note,
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        ...(b.status !== "Cancelled"
          ? {
              approvals: [
                ...(Array.isArray(old.approvals)
                  ? (old.approvals as Prisma.JsonArray)
                  : []),
                {
                  level: old.level,
                  by: ctx.userId,
                  name: ctx.name,
                  at: new Date().toISOString(),
                  status: b.status,
                  note: b.note,
                },
              ],
            }
          : {}),
      },
    });
    if (b.status !== "Cancelled")
      await enqueueWebhook(
        tx,
        ctx.companyId,
        b.status === "Approved" ? "leave.approved" : "leave.rejected",
        {
          id,
          employeeId: old.employeeId,
          startDate: old.startDate.toISOString().slice(0, 10),
          endDate: old.endDate.toISOString().slice(0, 10),
          days: old.days,
        },
      );
    await audit(
      tx,
      ctx,
      b.status.toUpperCase(),
      "leave",
      id,
      { status: old.status },
      { status: b.status, note: b.note },
      ip(req),
    );
    return saved;
  });
}

async function configure(
  req: NextRequest,
  ctx: Context,
  resource: string,
  id?: string,
) {
  requirePermission(ctx, "time.configure");
  const raw = req.method === "DELETE" ? undefined : await json(req);
  return mutate(ctx, async (tx) => {
    let result: { id?: string };
    if (resource === "policy" && req.method === "PUT") {
      const b = policySchema.parse(raw);
      await tx.attendancePolicy.upsert({
        where: { companyId: ctx.companyId },
        create: { companyId: ctx.companyId, ...b },
        update: b,
      });
      result = {};
    } else if (resource === "assign-shift" && req.method === "PUT") {
      const b = z
        .object({
          employeeId: z.string().min(1),
          shiftId: z.string().nullable(),
        })
        .strict()
        .parse(raw);
      await employee(tx, ctx, b.employeeId);
      if (
        b.shiftId &&
        !(await tx.shift.findFirst({
          where: { id: b.shiftId, companyId: ctx.companyId, active: true },
        }))
      )
        fail("Active shift not found.", 404);
      await tx.employee.update({
        where: { id: b.employeeId },
        data: { shiftId: b.shiftId },
      });
      result = { id: b.employeeId };
    } else if (resource === "shifts") {
      if (
        id &&
        !(await tx.shift.findFirst({ where: { id, companyId: ctx.companyId } }))
      )
        fail("Shift not found.", 404);
      const b = shiftSchema.parse(raw);
      result = id
        ? await tx.shift.update({ where: { id }, data: b })
        : await tx.shift.create({ data: { companyId: ctx.companyId, ...b } });
    } else if (resource === "leave-types") {
      if (
        id &&
        !(await tx.leaveType.findFirst({
          where: { id, companyId: ctx.companyId },
        }))
      )
        fail("Leave type not found.", 404);
      const b = leaveTypeSchema.parse(raw);
      // Existing entitlements are stable; add a new type for a different allowance.
      if (
        id &&
        (await tx.leaveRequest.count({
          where: { companyId: ctx.companyId, leaveTypeId: id },
        }))
      ) {
        const old = await tx.leaveType.findUniqueOrThrow({ where: { id } });
        if (old.annualDays !== b.annualDays || old.paid !== b.paid)
          fail(
            "This leave type is in use. Its allowance and paid status cannot be changed.",
          );
      }
      result = id
        ? await tx.leaveType.update({ where: { id }, data: b })
        : await tx.leaveType.create({
            data: { companyId: ctx.companyId, ...b },
          });
    } else if (resource === "holidays") {
      const old = id
        ? await tx.holiday.findFirst({
            where: { id, companyId: ctx.companyId },
          })
        : null;
      if (id && !old) fail("Holiday not found.", 404);
      const b = req.method === "DELETE" ? null : holidaySchema.parse(raw);
      const affected = [old?.date, b ? dayDate(b.date) : undefined].filter(
        (d): d is Date => !!d,
      );
      if (
        await tx.leaveRequest.findFirst({
          where: {
            companyId: ctx.companyId,
            status: { in: ["Pending", "Approved"] },
            OR: affected.map((d) => ({
              startDate: { lte: d },
              endDate: { gte: d },
            })),
          },
        })
      )
        fail(
          "This date is included in pending or approved leave. Resolve those requests before changing the holiday.",
        );
      if (req.method === "DELETE") {
        await tx.holiday.delete({ where: { id: id! } });
        result = { id };
      } else {
        const data = {
          name: b!.name,
          date: dayDate(b!.date),
          optional: b!.optional,
        };
        result = id
          ? await tx.holiday.update({ where: { id }, data })
          : await tx.holiday.create({
              data: { companyId: ctx.companyId, ...data },
            });
      }
    } else return fail("Endpoint not found.", 404);
    await audit(
      tx,
      ctx,
      req.method,
      "time-" + resource,
      result.id,
      undefined,
      raw as Prisma.InputJsonValue | undefined,
      ip(req),
    );
    return { success: true, ...result };
  });
}

export async function timeRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const resource = path[1],
    id = path[2],
    method = req.method;
  if (path.length > 3) return fail("Endpoint not found.", 404);
  const leaveAdmin = await leaveAdminRoute(req, ctx, resource, id);
  if (leaveAdmin !== null) return leaveAdmin;
  if (!id && resource === "summary" && method === "GET") return summary(ctx);
  if (resource === "field-tracking" && !id && method === "GET")
    return fieldTracking(req, ctx, "list");
  if (resource === "field-tracking" && !id && method === "POST")
    return fieldTracking(req, ctx, "start");
  if (resource === "field-tracking" && id === "location" && method === "POST")
    return fieldTracking(req, ctx, "point");
  if (resource === "field-tracking" && id && method === "DELETE")
    return fieldTracking(req, ctx, "stop", id);
  if (!id && resource === "attendance" && method === "GET")
    return listAttendance(req, ctx);
  if (!id && resource === "roster" && method === "GET") return roster(req, ctx);
  if (!id && resource === "rosters" && method === "GET")
    return listRosters(req, ctx);
  if (!id && resource === "rosters" && method === "PUT")
    return saveRosters(req, ctx);
  if (id && resource === "overtime" && method === "PUT")
    return reviewOvertime(req, ctx, id);
  if (
    !id &&
    ["check-in", "check-out", "face-punch"].includes(resource) &&
    method === "POST"
  )
    return punch(req, ctx, resource);
  if (
    resource === "attendance" &&
    ((!id && method === "POST") || (id && method === "PUT"))
  )
    return correction(req, ctx, id);
  if (!id && resource === "import" && method === "POST")
    return importAttendance(req, ctx);
  if (
    (resource === "locations" &&
      ((!id && ["GET", "POST"].includes(method)) ||
        (!!id && method === "PUT"))) ||
    (!id &&
      resource === "employee-locations" &&
      ["GET", "PUT"].includes(method))
  )
    return locations(req, ctx, resource, id);
  if (!id && resource === "geofence-events" && method === "GET")
    return geofenceEvents(req, ctx);
  if (!id && resource === "regularizations" && method === "GET")
    return listRegularizations(req, ctx);
  if (!id && resource === "regularizations" && method === "POST") {
    const saved = await requestRegularization(req, ctx);
    const e = await db.employee.findUniqueOrThrow({
      where: { id: saved.employeeId },
      include: { manager: { select: { userId: true } } },
    });
    await notify(
      ctx.companyId,
      [
        e.manager?.userId,
        ...(await usersWithPermission(ctx.companyId, "attendance.manage")),
      ].filter((u) => u !== ctx.userId),
      "attendance.regularization_submitted",
      {
        employee: `${e.firstName} ${e.lastName}`,
        ...(await punchText(ctx.companyId, saved)),
        reason: saved.reason,
      },
      "/attendance",
    );
    return saved;
  }
  if (id && resource === "regularizations" && method === "PUT") {
    const saved = await reviewRegularization(req, ctx, id);
    if (["Approved", "Rejected"].includes(saved.status)) {
      const e = await db.employee.findUniqueOrThrow({
        where: { id: saved.employeeId },
        select: { userId: true },
      });
      await notify(
        ctx.companyId,
        [e.userId],
        saved.status === "Approved"
          ? "attendance.regularization_approved"
          : "attendance.regularization_rejected",
        {
          ...(await punchText(ctx.companyId, saved)),
          note: saved.reviewNote ?? "",
        },
        "/attendance",
      );
    }
    return saved;
  }
  if (!id && resource === "leave" && method === "GET")
    return listLeave(req, ctx);
  if (!id && resource === "leave" && method === "POST") {
    const saved = await requestLeave(req, ctx);
    const e = await db.employee.findUniqueOrThrow({
      where: { id: saved.employeeId },
      include: {
        manager: { select: { userId: true } },
        user: { select: { name: true } },
      },
    });
    const type = await db.leaveType.findUniqueOrThrow({
      where: { id: saved.leaveTypeId },
    });
    await notify(
      ctx.companyId,
      [
        e.manager?.userId,
        ...(await usersWithPermission(ctx.companyId, "timeoff.manage")),
      ].filter((u) => u !== ctx.userId),
      "leave.submitted",
      {
        employee: `${e.firstName} ${e.lastName}`,
        days: saved.days,
        leaveType: type.name,
        startDate: saved.startDate.toISOString().slice(0, 10),
        endDate: saved.endDate.toISOString().slice(0, 10),
      },
      "/leave",
    );
    return saved;
  }
  if (id && resource === "leave" && method === "PUT") {
    const saved = await reviewLeave(req, ctx, id);
    if (["Approved", "Rejected"].includes(saved.status)) {
      const e = await db.employee.findUniqueOrThrow({
        where: { id: saved.employeeId },
        select: { userId: true },
      });
      const type = await db.leaveType.findUniqueOrThrow({
        where: { id: saved.leaveTypeId },
      });
      await notify(
        ctx.companyId,
        [e.userId],
        saved.status === "Approved" ? "leave.approved" : "leave.rejected",
        {
          leaveType: type.name,
          startDate: saved.startDate.toISOString().slice(0, 10),
          endDate: saved.endDate.toISOString().slice(0, 10),
          note: saved.reviewNote ?? "",
        },
        "/leave",
      );
    }
    return saved;
  }
  if (!id && resource === "balances" && method === "GET") {
    requirePermission(ctx, "timeoff.self");
    const e = await own(ctx),
      c = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    const year = z.coerce
      .number()
      .int()
      .min(2000)
      .max(2200)
      .parse(
        req.nextUrl.searchParams.get("year") ??
          localDay(new Date(), c.timezone).slice(0, 4),
      );
    return balances(ctx, e.id, year);
  }
  if (!id && resource === "employees" && method === "GET") {
    if (
      !ctx.permissions.includes("time.configure") &&
      !ctx.permissions.includes("attendance.manage")
    )
      fail("You cannot manage employee time records.", 403);
    const q = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const where = {
      companyId: ctx.companyId,
      status: { in: eligible },
      OR: [
        { firstName: { contains: q.search, mode: "insensitive" as const } },
        { lastName: { contains: q.search, mode: "insensitive" as const } },
        { employeeCode: { contains: q.search, mode: "insensitive" as const } },
      ],
    };
    return {
      items: await db.employee.findMany({
        where,
        select: { ...employeeSelect, shiftId: true },
        orderBy: { employeeCode: "asc" },
        take: 50,
      }),
      total: await db.employee.count({ where }),
    };
  }
  if (
    (!id &&
      ["policy", "assign-shift"].includes(resource) &&
      method === "PUT") ||
    (["shifts", "leave-types", "holidays"].includes(resource) &&
      ((!id && method === "POST") ||
        (!!id && method === "PUT") ||
        (!!id && resource === "holidays" && method === "DELETE")))
  )
    return configure(req, ctx, resource, id);
  return fail("Endpoint not found.", 404);
}
