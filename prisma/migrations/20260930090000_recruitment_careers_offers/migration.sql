-- Phase 8: public careers page settings, candidate consent and job offers.
-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "consentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "careersEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "careersIntro" TEXT;

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "designationId" TEXT,
    "departmentId" TEXT,
    "annualCtc" DOUBLE PRECISION NOT NULL,
    "joiningDate" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "tokenHash" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offers_tokenHash_key" ON "offers"("tokenHash");

-- CreateIndex
CREATE INDEX "offers_companyId_candidateId_idx" ON "offers"("companyId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_id_companyId_key" ON "offers"("id", "companyId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_candidateId_companyId_fkey" FOREIGN KEY ("candidateId", "companyId") REFERENCES "candidates"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_designationId_companyId_fkey" FOREIGN KEY ("designationId", "companyId") REFERENCES "designations"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "offers" ADD CONSTRAINT "offers_status_check"
  CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','DECLINED','WITHDRAWN'));
ALTER TABLE "offers" ADD CONSTRAINT "offers_dates_check"
  CHECK ("expiresOn" <= "joiningDate" + 365 AND "annualCtc" >= 0);

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "offers"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
