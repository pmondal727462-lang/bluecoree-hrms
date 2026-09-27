-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "shiftId" TEXT;

-- CreateTable
CREATE TABLE "attendance_policies" (
    "companyId" TEXT NOT NULL,
    "geofenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "expectedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "shiftName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Web',
    "checkInLocation" JSONB,
    "checkOutLocation" JSONB,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "annualDays" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_id_companyId_key" ON "shifts"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_companyId_name_key" ON "shifts"("companyId", "name");

-- CreateIndex
CREATE INDEX "attendance_companyId_workDate_idx" ON "attendance"("companyId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_companyId_employeeId_workDate_key" ON "attendance"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_companyId_date_key" ON "holidays"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_id_companyId_key" ON "leave_types"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_companyId_name_key" ON "leave_types"("companyId", "name");

-- CreateIndex
CREATE INDEX "leave_requests_companyId_employeeId_startDate_idx" ON "leave_requests"("companyId", "employeeId", "startDate");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_shiftId_companyId_fkey" FOREIGN KEY ("shiftId", "companyId") REFERENCES "shifts"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_companyId_fkey" FOREIGN KEY ("leaveTypeId", "companyId") REFERENCES "leave_types"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent two open sessions and invalid stored intervals even under concurrent callers.
CREATE UNIQUE INDEX "attendance_one_open_employee" ON "attendance" ("companyId", "employeeId") WHERE "checkOut" IS NULL;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_ordered_times" CHECK ("checkOut" IS NULL OR "checkOut" > "checkIn");
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_valid_status" CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_valid_dates" CHECK ("endDate" >= "startDate" AND days > 0);
INSERT INTO permissions (key, description) VALUES
('attendance.self', 'Check in/out and view own attendance'),
('attendance.read', 'View company attendance reports'),
('attendance.manage', 'Correct and import company attendance'),
('timeoff.self', 'Request leave and view own balances'),
('timeoff.manage', 'Review company leave requests'),
('time.configure', 'Manage shifts, holidays, leave types and geofencing')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions ("roleId", "permissionKey")
SELECT r.id, p.key FROM roles r CROSS JOIN permissions p
WHERE r.system = true AND (
(p.key IN ('attendance.self','timeoff.self') AND r.name IN ('Super Admin','Company Admin','HR Manager','HR Executive','Payroll Manager','Finance Manager','Department Manager','Team Leader','Employee','Recruiter','Auditor')) OR
(p.key = 'attendance.read' AND r.name IN ('Super Admin','Company Admin','HR Manager','HR Executive','Payroll Manager','Auditor')) OR
(p.key IN ('attendance.manage','timeoff.manage') AND r.name IN ('Super Admin','Company Admin','HR Manager','HR Executive')) OR
(p.key = 'time.configure' AND r.name IN ('Super Admin','Company Admin','HR Manager')))
ON CONFLICT DO NOTHING;
