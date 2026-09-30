ALTER TABLE "company_settings"
  ADD COLUMN "salaryPeriodMode" TEXT NOT NULL DEFAULT 'CALENDAR_MONTH',
  ADD COLUMN "salaryBoundaryDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "company_settings" ADD CONSTRAINT "salary_period_policy_valid"
  CHECK ("salaryPeriodMode" IN ('CALENDAR_MONTH', 'START_DAY', 'END_DAY') AND "salaryBoundaryDay" BETWEEN 1 AND 31);

ALTER TABLE "payroll_runs"
  ADD COLUMN "periodStart" DATE,
  ADD COLUMN "periodEnd" DATE;
-- Older runs were calculated as calendar months; preserve their original dates.
UPDATE "payroll_runs" SET
  "periodStart" = ("period" || '-01')::date,
  "periodEnd" = (("period" || '-01')::date + INTERVAL '1 month - 1 day')::date;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_run_dates_valid"
  CHECK (("periodStart" IS NULL AND "periodEnd" IS NULL) OR
    ("periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodStart" <= "periodEnd"));
CREATE INDEX "payroll_runs_companyId_periodStart_periodEnd_idx" ON "payroll_runs" ("companyId", "periodStart", "periodEnd");
