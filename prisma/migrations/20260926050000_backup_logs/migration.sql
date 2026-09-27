-- CreateTable
CREATE TABLE "backup_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "location" TEXT,
    "checksum" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "restoreTestedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_logs_startedAt_idx" ON "backup_logs"("startedAt");

