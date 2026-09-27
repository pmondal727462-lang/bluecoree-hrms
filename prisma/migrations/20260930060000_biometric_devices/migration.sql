BEGIN;

-- Biometric devices, enrolment mappings, raw punches and sync logs (spec
-- section 18), plus the per-plan device limit (section 48).
ALTER TABLE "subscription_plans" ADD COLUMN     "deviceLimit" INTEGER;
CREATE TABLE "attendance_devices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT,
    "serialNumber" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "locationId" TEXT,
    "timezone" TEXT,
    "endpoint" TEXT,
    "username" TEXT,
    "secretEncrypted" TEXT,
    "pushTokenHash" TEXT,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoMapByCode" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "pendingCommand" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastPunchAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "device_user_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_user_mappings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "device_punches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "directionHint" TEXT,
    "verifyMode" TEXT,
    "raw" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "employeeId" TEXT,
    "attendanceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_punches_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "device_sync_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "received" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "unmapped" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "device_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_devices_pushTokenHash_key" ON "attendance_devices"("pushTokenHash");
CREATE INDEX "attendance_devices_companyId_idx" ON "attendance_devices"("companyId");
CREATE UNIQUE INDEX "attendance_devices_vendor_serialNumber_key" ON "attendance_devices"("vendor", "serialNumber");
CREATE UNIQUE INDEX "attendance_devices_id_companyId_key" ON "attendance_devices"("id", "companyId");
CREATE INDEX "device_user_mappings_companyId_employeeId_idx" ON "device_user_mappings"("companyId", "employeeId");
CREATE UNIQUE INDEX "device_user_mappings_companyId_deviceUserId_key" ON "device_user_mappings"("companyId", "deviceUserId");
CREATE INDEX "device_punches_companyId_status_nextAttemptAt_idx" ON "device_punches"("companyId", "status", "nextAttemptAt");
CREATE INDEX "device_punches_companyId_deviceId_punchedAt_idx" ON "device_punches"("companyId", "deviceId", "punchedAt");
CREATE UNIQUE INDEX "device_punches_deviceId_deviceUserId_punchedAt_key" ON "device_punches"("deviceId", "deviceUserId", "punchedAt");
CREATE INDEX "device_sync_logs_companyId_deviceId_startedAt_idx" ON "device_sync_logs"("companyId", "deviceId", "startedAt");
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "attendance_locations"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "device_user_mappings" ADD CONSTRAINT "device_user_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_user_mappings" ADD CONSTRAINT "device_user_mappings_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_deviceId_companyId_fkey" FOREIGN KEY ("deviceId", "companyId") REFERENCES "attendance_devices"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "device_sync_logs" ADD CONSTRAINT "device_sync_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_sync_logs" ADD CONSTRAINT "device_sync_logs_deviceId_companyId_fkey" FOREIGN KEY ("deviceId", "companyId") REFERENCES "attendance_devices"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_devices"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "device_user_mappings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "device_user_mappings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "device_punches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "device_punches"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "device_sync_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "device_sync_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

COMMIT;
