import type { Prisma } from "@prisma/client";
import type { db } from "../../src/lib/db";

// Attendance evidence blocks deleting its attendance row, so tests unlink
// punches, verification logs and requests before removing attendance.
export async function deleteAttendance(
  tx: Prisma.TransactionClient | typeof db,
  where: Prisma.AttendanceWhereInput,
) {
  const ids = (
    await tx.attendance.findMany({ where, select: { id: true } })
  ).map((a) => a.id);
  if (!ids.length) return;
  const linked = {
    where: { attendanceId: { in: ids } },
    data: { attendanceId: null },
  };
  await tx.attendancePunch.updateMany(linked);
  await tx.geofenceEvent.updateMany(linked);
  await tx.faceVerificationLog.updateMany(linked);
  await tx.attendanceRegularization.updateMany(linked);
  await tx.compOffRequest.updateMany(linked);
  await tx.attendance.deleteMany({ where: { id: { in: ids } } });
}
