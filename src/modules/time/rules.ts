export function localDay(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function localMinute(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value)
  );
}
export function dayDate(day: string) {
  return new Date(day + "T00:00:00.000Z");
}
export function addDays(day: string, count: number) {
  return new Date(dayDate(day).getTime() + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
export type ShiftRules = {
  name: string;
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  breakMinutes: number;
  kind?: string;
  splitStartMinute?: number | null;
  splitEndMinute?: number | null;
  minimumMinutes?: number | null;
  halfDayMinutes?: number | null;
  earlyExitGraceMinutes?: number;
  overtimeAfterMinutes?: number;
};
const span = (from: number, to: number) => (to - from + 1440) % 1440;
// Scheduled minutes of a shift, excluding its break. A split shift adds its
// second segment; a flexible shift uses its minimum hours when set.
export function expectedMinutes(shift: ShiftRules) {
  let total = span(shift.startMinute, shift.endMinute);
  if (
    shift.kind === "SPLIT" &&
    shift.splitStartMinute != null &&
    shift.splitEndMinute != null
  )
    total += span(shift.splitStartMinute, shift.splitEndMinute);
  total -= shift.breakMinutes;
  return shift.kind === "FLEXIBLE" && shift.minimumMinutes
    ? shift.minimumMinutes
    : total;
}
// Minute (from the work date's midnight) at which the shift ends.
function endOffset(shift: ShiftRules) {
  const last =
    shift.kind === "SPLIT" && shift.splitEndMinute != null
      ? shift.splitEndMinute
      : shift.endMinute;
  return last <= shift.startMinute ? last + 1440 : last;
}
// Work date and scheduled figures for a punch. `workDay` fixes the work date
// when it is already known (a rostered shift); otherwise an overnight shift
// before its end time belongs to the previous day.
export function shiftSnapshot(
  now: Date,
  timezone: string,
  shift?: ShiftRules | null,
  workDay?: string,
) {
  let day = workDay ?? localDay(now, timezone);
  const minute = localMinute(now, timezone);
  if (
    !workDay &&
    shift &&
    shift.endMinute < shift.startMinute &&
    minute < shift.endMinute
  )
    day = addDays(day, -1);
  const elapsed = shift
    ? minute - shift.startMinute + (day < localDay(now, timezone) ? 1440 : 0)
    : 0;
  const flexible = shift?.kind === "FLEXIBLE";
  return {
    workDate: dayDate(day),
    shiftName: shift?.name ?? null,
    breakMinutes: shift?.breakMinutes ?? 0,
    expectedMinutes: shift ? expectedMinutes(shift) : 0,
    lateMinutes:
      shift && !flexible && elapsed > shift.graceMinutes
        ? Math.max(0, elapsed)
        : 0,
    scheduledEnd:
      shift && !flexible ? zonedTime(day, endOffset(shift), timezone) : null,
  };
}
export function duration(
  checkIn: Date,
  checkOut: Date,
  breakMinutes: number,
  expectedMinutes: number,
  overtimeAfterMinutes = 0,
) {
  const workedMinutes = Math.max(
    0,
    Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000) - breakMinutes,
  );
  return {
    workedMinutes,
    overtimeMinutes: overtime(
      workedMinutes,
      expectedMinutes,
      overtimeAfterMinutes,
    ),
  };
}
export function overtime(
  workedMinutes: number,
  expectedMinutes: number,
  afterMinutes = 0,
) {
  const extra = expectedMinutes ? workedMinutes - expectedMinutes : 0;
  return extra > afterMinutes ? extra : 0;
}
// Worked minutes across several in/out pairs. Time spent out between pairs
// counts towards the shift's break allowance.
export function workedFromPunches(
  punches: { punchedAt: Date; direction: string }[],
  breakMinutes: number,
  until?: Date,
) {
  let worked = 0,
    gaps = 0,
    inAt: Date | null = null,
    outAt: Date | null = null;
  for (const p of punches) {
    if (p.direction === "IN" && !inAt) {
      if (outAt) gaps += (p.punchedAt.getTime() - outAt.getTime()) / 60000;
      inAt = p.punchedAt;
    } else if (p.direction === "OUT" && inAt) {
      worked += (p.punchedAt.getTime() - inAt.getTime()) / 60000;
      inAt = null;
      outAt = p.punchedAt;
    }
  }
  if (inAt && until) worked += (until.getTime() - inAt.getTime()) / 60000;
  return Math.max(
    0,
    Math.floor(worked - Math.max(0, breakMinutes - Math.floor(gaps))),
  );
}
// Day status from worked minutes: full day at the shift minimum (or its
// expected minutes), half day at the half-day threshold (or half of that).
export function dayStatus(
  workedMinutes: number,
  expected: number,
  shift?: ShiftRules | null,
) {
  if (!shift || !expected) return "PRESENT";
  const full = shift.minimumMinutes ?? expected;
  const half = shift.halfDayMinutes ?? Math.floor(full / 2);
  return workedMinutes >= full
    ? "PRESENT"
    : workedMinutes >= half
      ? "HALF_DAY"
      : "SHORT";
}
export function earlyExit(
  checkOut: Date,
  scheduledEnd: Date | null,
  graceMinutes = 0,
) {
  if (!scheduledEnd) return 0;
  const early = Math.floor(
    (scheduledEnd.getTime() - checkOut.getTime()) / 60000,
  );
  return early > graceMinutes ? early : 0;
}
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function workingDays(
  start: string,
  end: string,
  weekdays: number[],
  holidays: string[],
) {
  const excluded = new Set(holidays);
  let days = 0;
  for (let day = start; day <= end; day = addDays(day, 1))
    if (weekdays.includes(dayDate(day).getUTCDay()) && !excluded.has(day))
      days++;
  return days;
}
// Converts a company-local calendar day and minute of day to an instant.
export function zonedTime(day: string, minute: number, timezone: string) {
  const wall = dayDate(day).getTime() + minute * 60000;
  const offset = (at: number) => {
    const d = new Date(at);
    return (
      dayDate(localDay(d, timezone)).getTime() +
      localMinute(d, timezone) * 60000 -
      Math.floor(at / 60000) * 60000
    );
  };
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}

// Everything derived when a day is completed (check-out, correction or an
// approved missed punch): worked time, overtime after the shift threshold,
// early exit, day status and overtime approval. Work on a weekly off or
// holiday is all overtime and is never an early exit.
export function completeDay(input: {
  checkIn: Date;
  checkOut: Date;
  breakMinutes: number;
  expectedMinutes: number;
  scheduledEnd: Date | null;
  shift: ShiftRules | null;
  offDay: boolean;
  overtimeRequiresApproval: boolean;
}) {
  const { workedMinutes } = duration(
    input.checkIn,
    input.checkOut,
    input.breakMinutes,
    input.expectedMinutes,
  );
  const overtimeMinutes = input.offDay
    ? workedMinutes
    : overtime(
        workedMinutes,
        input.expectedMinutes,
        input.shift?.overtimeAfterMinutes ?? 0,
      );
  return {
    workedMinutes,
    overtimeMinutes,
    earlyExitMinutes: input.offDay
      ? 0
      : earlyExit(
          input.checkOut,
          input.scheduledEnd,
          input.shift?.earlyExitGraceMinutes ?? 0,
        ),
    status: input.offDay
      ? "PRESENT"
      : dayStatus(workedMinutes, input.expectedMinutes, input.shift),
    overtimeStatus: !overtimeMinutes
      ? "NONE"
      : input.overtimeRequiresApproval
        ? "PENDING"
        : "APPROVED",
    approvedOvertimeMinutes:
      overtimeMinutes && !input.overtimeRequiresApproval ? overtimeMinutes : 0,
  };
}
