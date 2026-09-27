-- Every punch records the client IP alongside its device and location.
ALTER TABLE "attendance_punches" ADD COLUMN "ip" TEXT;
