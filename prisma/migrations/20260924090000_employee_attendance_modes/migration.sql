ALTER TABLE "employees"
  ADD COLUMN "attendanceMode" TEXT NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN "fieldTrackingAllowed" BOOLEAN NOT NULL DEFAULT false;
