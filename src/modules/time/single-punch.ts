// Apply the policy only to past days, without inventing checkout times/hours.
export function effectiveAttendanceStatus(
  row: {
    workDate: Date;
    checkOut: Date | null;
    status: string;
    scheduledEnd?: Date | null;
    _count?: { punches: number };
  },
  policy: string,
  today: string,
  now = new Date(),
) {
  if (
    row.checkOut ||
    row.workDate.toISOString().slice(0, 10) >= today ||
    (row.scheduledEnd && row.scheduledEnd > now) ||
    (row._count?.punches ?? 1) > 1 ||
    !["PRESENT", "MISSED_PUNCH"].includes(row.status)
  )
    return row.status;
  return ["PRESENT", "ABSENT", "HALF_DAY"].includes(policy)
    ? policy
    : "MISSED_PUNCH";
}
