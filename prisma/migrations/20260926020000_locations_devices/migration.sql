-- CreateTable
CREATE TABLE "attendance_locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HEAD_OFFICE',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance_locations" (
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_attendance_locations_pkey" PRIMARY KEY ("employeeId","locationId")
);

-- CreateTable
CREATE TABLE "geofence_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "locationId" TEXT,
    "locationName" TEXT,
    "eventType" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "distanceMeters" INTEGER,
    "inside" BOOLEAN NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "reason" TEXT,
    "deviceId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_locations_companyId_name_key" ON "attendance_locations"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_locations_id_companyId_key" ON "attendance_locations"("id", "companyId");

-- CreateIndex
CREATE INDEX "employee_attendance_locations_companyId_locationId_idx" ON "employee_attendance_locations"("companyId", "locationId");

-- CreateIndex
CREATE INDEX "geofence_events_companyId_employeeId_createdAt_idx" ON "geofence_events"("companyId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "geofence_events_companyId_createdAt_idx" ON "geofence_events"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_sessions_sessionId_key" ON "mobile_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "mobile_sessions_companyId_userId_idx" ON "mobile_sessions"("companyId", "userId");

-- CreateIndex
CREATE INDEX "mobile_sessions_deviceId_idx" ON "mobile_sessions"("deviceId");

-- AddForeignKey
ALTER TABLE "attendance_locations" ADD CONSTRAINT "attendance_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_locations" ADD CONSTRAINT "employee_attendance_locations_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_locations" ADD CONSTRAINT "employee_attendance_locations_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "attendance_locations"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "attendance_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "employee_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Grant the new device administration permission to built-in administrator roles.
INSERT INTO "permissions" ("key", "description") VALUES
('devices.manage', 'View, deactivate and sign out company mobile devices')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'devices.manage' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Admin','HR Manager')
ON CONFLICT DO NOTHING;
