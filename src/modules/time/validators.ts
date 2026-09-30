import { z } from "zod";
export const day = z.iso.date();
const name = z.string().trim().min(1).max(100);
export const location = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
  })
  .strict();
export const punchSchema = z
  .object({
    location: location.optional(),
    faceSample: z.string().max(2_000_000).optional(),
    deviceId: z.string().trim().min(8).max(200).optional(),
    offline: z
      .object({
        eventId: z.uuid(),
        direction: z.enum(["IN", "OUT"]),
        capturedAt: z.iso.datetime({ offset: true }),
        permit: z.string().min(20).max(3000),
      })
      .strict()
      .optional(),
  })
  .strict();
export const fieldTrackingStartSchema = z
  .object({
    deviceId: z.string().trim().min(8).max(200),
    consent: z.literal(true),
  })
  .strict();
export const fieldTrackingPointSchema = z
  .object({
    sessionId: z.string().min(1),
    deviceId: z.string().trim().min(8).max(200),
    location,
  })
  .strict();
export const policySchema = z
  .object({
    gpsTrackingEnabled: z.boolean().optional(),
    fieldTrackingEnabled: z.boolean().optional(),
    fieldTrackingIntervalSeconds: z.number().int().min(15).max(300).optional(),
    fieldTrackingMaxMinutes: z.number().int().min(15).max(1440).optional(),
    faceAttendanceEnabled: z.literal(true).optional(),
    overtimeRequiresApproval: z.boolean().optional(),
    singlePunchStatus: z
      .enum(["MISSED_PUNCH", "PRESENT", "ABSENT", "HALF_DAY"])
      .optional(),
    faceLivenessRequired: z.literal(true).optional(),
    faceConfidenceThreshold: z.literal(0.8).optional(),
    faceMaxFailedAttempts: z.literal(5).optional(),
    faceLockoutMinutes: z.literal(15).optional(),
    // Face verification is mandatory; legacy WEB fallback cannot be enabled.
    faceFallback: z.literal("NONE").optional(),
    compOffEnabled: z.boolean().optional(),
    compOffExpiryDays: z.number().int().min(1).max(365).optional(),
    optionalHolidayLimit: z.number().int().min(0).max(30).optional(),
    geofenceEnabled: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radiusMeters: z.number().int().min(50).max(10000),
  })
  .strict()
  .refine(
    (v) => !v.geofenceEnabled || (v.latitude !== null && v.longitude !== null),
    "Set coordinates before enabling the geofence",
  );
const minuteOfDay = z.number().int().min(0).max(1439);
const span = (from: number, to: number) => (to - from + 1440) % 1440;
// FIXED covers day and night shifts (a night shift ends after midnight);
// rotation between shifts is planned with rosters. FLEXIBLE requires the
// minimum hours instead of fixed times; SPLIT adds a second segment.
export const shiftKinds = ["FIXED", "FLEXIBLE", "SPLIT"] as const;
export const shiftSchema = z
  .object({
    name,
    kind: z.enum(shiftKinds).default("FIXED"),
    startMinute: minuteOfDay,
    endMinute: minuteOfDay,
    splitStartMinute: minuteOfDay.nullable().default(null),
    splitEndMinute: minuteOfDay.nullable().default(null),
    graceMinutes: z.number().int().min(0).max(120),
    breakMinutes: z.number().int().min(0).max(240),
    minimumMinutes: z.number().int().min(30).max(1440).nullable().default(null),
    halfDayMinutes: z.number().int().min(30).max(1440).nullable().default(null),
    earlyExitGraceMinutes: z.number().int().min(0).max(240).default(0),
    overtimeAfterMinutes: z.number().int().min(0).max(720).default(0),
    active: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) =>
      v.startMinute !== v.endMinute &&
      v.breakMinutes <
        span(v.startMinute, v.endMinute) +
          (v.kind === "SPLIT" &&
          v.splitStartMinute != null &&
          v.splitEndMinute != null
            ? span(v.splitStartMinute, v.splitEndMinute)
            : 0),
    "Shift must have a positive duration longer than its break",
  )
  .refine(
    (v) =>
      v.kind !== "SPLIT" ||
      (v.splitStartMinute != null &&
        v.splitEndMinute != null &&
        v.splitStartMinute !== v.splitEndMinute &&
        span(v.startMinute, v.splitStartMinute) >
          span(v.startMinute, v.endMinute)),
    "A split shift needs a second segment that starts after the first ends",
  )
  .refine(
    (v) => v.kind !== "FLEXIBLE" || v.minimumMinutes != null,
    "A flexible shift needs its minimum working minutes",
  )
  .refine(
    (v) =>
      v.halfDayMinutes == null ||
      v.minimumMinutes == null ||
      v.halfDayMinutes < v.minimumMinutes,
    "Half-day minutes must be less than the minimum working minutes",
  );
// Roster: per employee and date, a shift or a weekly off. Neither clears the
// entry, so the employee's default shift applies again.
export const rosterSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            employeeId: z.string().min(1),
            workDate: day,
            shiftId: z.string().min(1).nullable().default(null),
            weeklyOff: z.boolean().default(false),
            note: z.string().trim().max(200).nullable().default(null),
          })
          .strict()
          .refine(
            (e) => !(e.weeklyOff && e.shiftId),
            "Choose a shift or a weekly off, not both",
          ),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const overtimeReviewSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    minutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict();
export const holidaySchema = z
  .object({ name, date: day, optional: z.boolean().default(false) })
  .strict();
// Leave rules per type. MONTHLY accrual credits annualDays / 12 each month;
// unpaid types (loss of pay) are not limited by a balance.
export const leaveTypeSchema = z
  .object({
    name,
    annualDays: z.number().int().min(0).max(366),
    paid: z.boolean(),
    active: z.boolean().default(true),
    accrual: z.enum(["ANNUAL", "MONTHLY"]).default("ANNUAL"),
    carryForwardMax: z.number().int().min(0).max(366).default(0),
    encashable: z.boolean().default(false),
    encashMax: z.number().int().min(0).max(366).default(0),
    halfDayAllowed: z.boolean().default(true),
    approvalLevels: z.number().int().min(1).max(2).default(1),
    compOff: z.boolean().default(false),
  })
  .strict();
export const compOffRequestSchema = z
  .object({
    workDate: day,
    days: z.union([z.literal(0.5), z.literal(1)]),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const carryForwardSchema = z
  .object({ fromYear: z.number().int().min(2000).max(2100) })
  .strict();
export const encashSchema = z
  .object({
    employeeId: z.string().min(1),
    leaveTypeId: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    days: z.number().min(0.5).max(366).multipleOf(0.5),
    note: z.string().trim().max(300).default(""),
  })
  .strict();
export const adjustmentSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            employeeId: z.string().min(1),
            leaveTypeId: z.string().min(1),
            year: z.number().int().min(2000).max(2100),
            days: z
              .number()
              .min(-366)
              .max(366)
              .multipleOf(0.5)
              .refine((v) => v !== 0, "Days cannot be zero"),
            note: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const leaveSchema = z
  .object({
    leaveTypeId: z.string().min(1),
    startDate: day,
    endDate: day,
    reason: z.string().trim().min(3).max(500),
    halfDay: z.boolean().default(false),
    session: z.enum(["FIRST", "SECOND"]).nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      v.startDate.slice(0, 4) === v.endDate.slice(0, 4),
    "Use an ordered range within one calendar year",
  );
export const correctionSchema = z
  .object({
    employeeId: z.string().min(1),
    checkIn: z.iso.datetime({ offset: true }),
    checkOut: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const listSchema = z.object({
  from: day.optional(),
  to: day.optional(),
  employeeId: z.string().optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).default(""),
  scope: z.enum(["own", "team", "company"]).default("own"),
  source: z
    .enum([
      "Web",
      "Mobile",
      "Face",
      "Face fallback",
      "Biometric",
      "Manual",
      "Regularization",
      "Device CSV",
      "CSV import",
    ])
    .optional(),
  overtimeStatus: z
    .enum(["NONE", "PENDING", "APPROVED", "REJECTED"])
    .optional(),
});
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm time");
// HR manual attendance with local clock times; a check-out earlier than the
// check-in falls on the next day.
export const manualAttendanceSchema = z
  .object({
    employeeId: z.string().min(1),
    workDate: day,
    checkIn: clock,
    checkOut: clock,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const regularizationSchema = z
  .object({
    workDate: day,
    checkIn: clock.optional(),
    checkOut: clock,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const regularizationReviewSchema = z
  .object({
    status: z.enum(["Approved", "Rejected", "Cancelled"]),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export const locationTypes = [
  "HEAD_OFFICE",
  "BRANCH_OFFICE",
  "FACTORY",
  "WAREHOUSE",
  "CLIENT_SITE",
  "REMOTE",
] as const;
export const attendanceLocationSchema = z
  .object({
    name,
    type: z.enum(locationTypes),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(20).max(10000),
    address: z.string().trim().max(500).optional(),
    active: z.boolean().default(true),
  })
  .strict();
export const employeeLocationsSchema = z
  .object({
    employeeId: z.string().min(1),
    locationIds: z.array(z.string().min(1)).max(50),
  })
  .strict();
