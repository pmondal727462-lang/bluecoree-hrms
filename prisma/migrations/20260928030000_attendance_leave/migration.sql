-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "approvedOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyExitMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "offDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtimeReviewedAt" TIMESTAMP(3),
ADD COLUMN     "overtimeReviewedBy" TEXT,
ADD COLUMN     "overtimeStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "scheduledEnd" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PRESENT';

-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "compOffEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "compOffExpiryDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "multiplePunchesAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optionalHolidayLimit" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "overtimeRequiresApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "holidays" ADD COLUMN     "optional" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "approvals" JSONB,
ADD COLUMN     "halfDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "session" TEXT,
ALTER COLUMN "days" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "accrual" TEXT NOT NULL DEFAULT 'ANNUAL',
ADD COLUMN     "approvalLevels" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "carryForwardMax" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "compOff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "encashMax" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "encashable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "halfDayAllowed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "earlyExitGraceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "halfDayMinutes" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "minimumMinutes" INTEGER,
ADD COLUMN     "overtimeAfterMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "splitEndMinute" INTEGER,
ADD COLUMN     "splitStartMinute" INTEGER;

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Web',
    "deviceId" TEXT,
    "location" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "shiftId" TEXT,
    "weeklyOff" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_ledger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION,
    "expiresAt" DATE,
    "note" TEXT,
    "refId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_off_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attendanceId" TEXT,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comp_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_selections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_punches_companyId_employeeId_punchedAt_idx" ON "attendance_punches"("companyId", "employeeId", "punchedAt");

-- CreateIndex
CREATE INDEX "attendance_punches_attendanceId_idx" ON "attendance_punches"("attendanceId");

-- CreateIndex
CREATE INDEX "rosters_companyId_workDate_idx" ON "rosters"("companyId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "rosters_companyId_employeeId_workDate_key" ON "rosters"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "leave_ledger_companyId_employeeId_year_idx" ON "leave_ledger"("companyId", "employeeId", "year");

-- CreateIndex
CREATE INDEX "leave_ledger_companyId_kind_refId_idx" ON "leave_ledger"("companyId", "kind", "refId");

-- CreateIndex
CREATE INDEX "comp_off_requests_companyId_status_idx" ON "comp_off_requests"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comp_off_requests_companyId_employeeId_workDate_key" ON "comp_off_requests"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_selections_companyId_employeeId_holidayId_key" ON "holiday_selections"("companyId", "employeeId", "holidayId");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_id_companyId_key" ON "holidays"("id", "companyId");

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_shiftId_companyId_fkey" FOREIGN KEY ("shiftId", "companyId") REFERENCES "shifts"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leaveTypeId_companyId_fkey" FOREIGN KEY ("leaveTypeId", "companyId") REFERENCES "leave_types"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_selections" ADD CONSTRAINT "holiday_selections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_selections" ADD CONSTRAINT "holiday_selections_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_selections" ADD CONSTRAINT "holiday_selections_holidayId_companyId_fkey" FOREIGN KEY ("holidayId", "companyId") REFERENCES "holidays"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

