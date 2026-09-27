-- Phase 9: configurable rating scale, peer reviews, calibration and OKR key results.
-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "calibratedAt" TIMESTAMP(3),
ADD COLUMN     "calibratedBy" TEXT,
ADD COLUMN     "calibrationNote" TEXT,
ADD COLUMN     "finalRating" INTEGER;

-- AlterTable
ALTER TABLE "review_cycles" ADD COLUMN     "peerReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ratingLabels" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "ratingScale" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "peer_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "rating" INTEGER,
    "comments" TEXT,
    "requestedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "peer_reviews_companyId_reviewerEmployeeId_status_idx" ON "peer_reviews"("companyId", "reviewerEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "peer_reviews_reviewId_reviewerEmployeeId_key" ON "peer_reviews"("reviewId", "reviewerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "goals_id_companyId_key" ON "goals"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_id_companyId_key" ON "performance_reviews"("id", "companyId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentId_companyId_fkey" FOREIGN KEY ("parentId", "companyId") REFERENCES "goals"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewId_companyId_fkey" FOREIGN KEY ("reviewId", "companyId") REFERENCES "performance_reviews"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewerEmployeeId_companyId_fkey" FOREIGN KEY ("reviewerEmployeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_rating_scale_check"
  CHECK ("ratingScale" BETWEEN 3 AND 10);
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_status_check"
  CHECK ("status" IN ('REQUESTED','SUBMITTED','DECLINED'));

ALTER TABLE "peer_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "peer_reviews"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
