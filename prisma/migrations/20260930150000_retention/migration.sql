-- Phase 17: data retention policies, runs and legal hold.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cutoff" DATE NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "affected" INTEGER NOT NULL,
    "runBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_companyId_category_key" ON "retention_policies"("companyId", "category");

-- CreateIndex
CREATE INDEX "retention_runs_companyId_createdAt_idx" ON "retention_runs"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_values_check"
  CHECK ("category" IN ('attendance','audit_logs','login_history','applications','documents','exited_employees')
    AND "retainDays" BETWEEN 30 AND 36500);

ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "retention_policies"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "retention_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "retention_runs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
