-- Face attendance: failed-scan lockout, fallback policy and replay detection.
ALTER TABLE "attendance_policies" ADD COLUMN     "faceFallback" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "faceLockoutMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "faceMaxFailedAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "face_verification_logs" ADD COLUMN     "sampleHash" TEXT;
CREATE INDEX "face_verification_logs_employeeId_sampleHash_idx" ON "face_verification_logs"("employeeId", "sampleHash");
