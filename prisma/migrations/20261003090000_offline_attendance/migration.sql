ALTER TABLE "attendance_punches" ADD COLUMN "clientEventId" TEXT, ADD COLUMN "clientPayloadHash" TEXT;
CREATE UNIQUE INDEX "attendance_punches_companyId_employeeId_clientEventId_key" ON "attendance_punches"("companyId", "employeeId", "clientEventId");
