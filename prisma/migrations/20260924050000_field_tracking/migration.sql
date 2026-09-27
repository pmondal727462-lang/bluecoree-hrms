ALTER TABLE "attendance_policies"
  ADD COLUMN "fieldTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fieldTrackingIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "fieldTrackingMaxMinutes" INTEGER NOT NULL DEFAULT 720;

INSERT INTO "permissions" ("key", "description") VALUES
('fieldtracking.read', 'View live locations for permitted field employees'),
('fieldtracking.manage', 'Configure and stop field tracking sessions')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND p."key" IN ('fieldtracking.read','fieldtracking.manage')
AND (r."name" IN ('Super Admin','Company Admin','HR Manager') OR (r."name" IN ('HR Executive','Department Manager','Team Leader') AND p."key" = 'fieldtracking.read'))
ON CONFLICT DO NOTHING;

CREATE TABLE "field_tracking_sessions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "consentAt" TIMESTAMP(3) NOT NULL,
  "startDeviceId" TEXT,
  CONSTRAINT "field_tracking_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "field_tracking_points" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deviceId" TEXT,
  "ip" TEXT,
  "locationName" TEXT,
  CONSTRAINT "field_tracking_points_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "field_tracking_sessions_id_companyId_key" ON "field_tracking_sessions"("id","companyId");
CREATE INDEX "field_tracking_sessions_companyId_status_expiresAt_idx" ON "field_tracking_sessions"("companyId","status","expiresAt");
CREATE INDEX "field_tracking_sessions_companyId_employeeId_startedAt_idx" ON "field_tracking_sessions"("companyId","employeeId","startedAt");
CREATE INDEX "field_tracking_points_companyId_sessionId_recordedAt_idx" ON "field_tracking_points"("companyId","sessionId","recordedAt");
CREATE INDEX "field_tracking_points_companyId_employeeId_recordedAt_idx" ON "field_tracking_points"("companyId","employeeId","recordedAt");
ALTER TABLE "field_tracking_sessions" ADD CONSTRAINT "field_tracking_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_tracking_sessions" ADD CONSTRAINT "field_tracking_sessions_employeeId_companyId_fkey" FOREIGN KEY ("employeeId","companyId") REFERENCES "employees"("id","companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_tracking_points" ADD CONSTRAINT "field_tracking_points_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_tracking_points" ADD CONSTRAINT "field_tracking_points_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "field_tracking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_tracking_points" ADD CONSTRAINT "field_tracking_points_employeeId_companyId_fkey" FOREIGN KEY ("employeeId","companyId") REFERENCES "employees"("id","companyId") ON DELETE CASCADE ON UPDATE CASCADE;
