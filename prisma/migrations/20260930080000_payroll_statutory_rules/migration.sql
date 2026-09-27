BEGIN;

-- Effective-dated statutory rules, payroll review/approval, variable earnings,
-- loans and advances (spec sections 22-24).
ALTER TABLE "salary_structures" ADD COLUMN     "conveyance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "payroll_runs" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBy" TEXT;
ALTER TABLE "payroll_run_items" ADD COLUMN     "absentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "advanceDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "encashmentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "encashmentPay" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "incentive" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "loanDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "otherEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtimePay" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE TABLE "statutory_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "state" TEXT,
    "ruleType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "employeeRate" DOUBLE PRECISION,
    "employerRate" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "ceiling" DOUBLE PRECISION,
    "calculationMethod" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "statutory_rules_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_loans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principal" DOUBLE PRECISION NOT NULL,
    "instalment" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "startPeriod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "statutory_rules_ruleType_country_effectiveFrom_idx" ON "statutory_rules"("ruleType", "country", "effectiveFrom");
CREATE INDEX "statutory_rules_companyId_ruleType_idx" ON "statutory_rules"("companyId", "ruleType");
CREATE INDEX "employee_loans_companyId_employeeId_status_idx" ON "employee_loans"("companyId", "employeeId", "status");
CREATE UNIQUE INDEX "employee_loans_id_companyId_key" ON "employee_loans"("id", "companyId");
CREATE UNIQUE INDEX "loan_repayments_loanId_runId_key" ON "loan_repayments"("loanId", "runId");
ALTER TABLE "statutory_rules" ADD CONSTRAINT "statutory_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_companyId_fkey" FOREIGN KEY ("loanId", "companyId") REFERENCES "employee_loans"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_runId_companyId_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "payroll_runs"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security. Platform default rules (no company) are readable by
-- every tenant; tenants can only write their own rules.
ALTER TABLE "statutory_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "statutory_rules"
  USING ("companyId" IS NULL OR "companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "employee_loans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_loans"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "loan_repayments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "loan_repayments"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Platform defaults for FY 2025-26. Verify with a payroll adviser; update by
-- adding rules with a later effective date rather than editing these.
INSERT INTO "statutory_rules" ("id","ruleType","name","effectiveFrom","employeeRate","employerRate","ceiling","threshold","calculationMethod","config","updatedAt") VALUES
(gen_random_uuid()::text,'PF','Employees'' Provident Fund','2025-04-01',12,12,15000,NULL,'PERCENT_OF_BASIC','{"epsRate":8.33,"edliRate":0.5,"adminRate":0.5,"capAtCeiling":true}',CURRENT_TIMESTAMP),
(gen_random_uuid()::text,'ESI','Employees'' State Insurance','2025-04-01',0.75,3.25,NULL,21000,'PERCENT_OF_GROSS','{}',CURRENT_TIMESTAMP),
(gen_random_uuid()::text,'INCOME_TAX','Income tax - new regime','2025-04-01',NULL,NULL,NULL,NULL,'SLAB','{"regime":"NEW","standardDeduction":75000,"rebateLimit":1200000,"marginalRelief":true,"cessRate":4,"surchargeCap":25,"slabs":[{"upTo":400000,"rate":0},{"upTo":800000,"rate":5},{"upTo":1200000,"rate":10},{"upTo":1600000,"rate":15},{"upTo":2000000,"rate":20},{"upTo":2400000,"rate":25},{"upTo":null,"rate":30}]}',CURRENT_TIMESTAMP),
(gen_random_uuid()::text,'INCOME_TAX','Income tax - old regime','2025-04-01',NULL,NULL,NULL,NULL,'SLAB','{"regime":"OLD","standardDeduction":50000,"rebateLimit":500000,"marginalRelief":false,"cessRate":4,"surchargeCap":37,"slabs":[{"upTo":250000,"rate":0},{"upTo":500000,"rate":5},{"upTo":1000000,"rate":20},{"upTo":null,"rate":30}]}',CURRENT_TIMESTAMP);
INSERT INTO "statutory_rules" ("id","state","ruleType","name","effectiveFrom","calculationMethod","config","updatedAt") VALUES
(gen_random_uuid()::text,'Maharashtra','PT','Professional tax - Maharashtra','2025-04-01','SLAB','{"slabs":[{"min":0,"max":7500,"amount":0},{"min":7500.01,"max":10000,"amount":175},{"min":10000.01,"max":null,"amount":200,"februaryAmount":300}]}',CURRENT_TIMESTAMP),
(gen_random_uuid()::text,'West Bengal','PT','Professional tax - West Bengal','2025-04-01','SLAB','{"slabs":[{"min":0,"max":10000,"amount":0},{"min":10000.01,"max":15000,"amount":110},{"min":15000.01,"max":25000,"amount":130},{"min":25000.01,"max":40000,"amount":150},{"min":40000.01,"max":null,"amount":200}]}',CURRENT_TIMESTAMP);

-- Rates a company had customised in its statutory settings become company
-- rules from the start, so its payroll is unchanged.
INSERT INTO "statutory_rules" ("id","companyId","ruleType","name","effectiveFrom","employeeRate","employerRate","ceiling","calculationMethod","config","updatedAt")
SELECT gen_random_uuid()::text, s."companyId", 'PF', 'Provident Fund (company)', '2000-01-01',
  (s."config"->>'pfEmployeeRate')::float, (s."config"->>'pfEmployerRate')::float, (s."config"->>'pfWageCeiling')::float,
  'PERCENT_OF_BASIC',
  jsonb_build_object('epsRate',(s."config"->>'epsRate')::float,'edliRate',(s."config"->>'edliRate')::float,'adminRate',(s."config"->>'pfAdminRate')::float,'capAtCeiling',(s."config"->>'pfCapAtCeiling')::boolean),
  CURRENT_TIMESTAMP
FROM "statutory_settings" s
WHERE s."config" ? 'pfEmployeeRate' AND (
  (s."config"->>'pfEmployeeRate')::float <> 12 OR (s."config"->>'pfEmployerRate')::float <> 12 OR
  (s."config"->>'pfWageCeiling')::float <> 15000 OR (s."config"->>'epsRate')::float <> 8.33 OR
  (s."config"->>'edliRate')::float <> 0.5 OR (s."config"->>'pfAdminRate')::float <> 0.5 OR
  (s."config"->>'pfCapAtCeiling')::boolean IS DISTINCT FROM true);
INSERT INTO "statutory_rules" ("id","companyId","ruleType","name","effectiveFrom","employeeRate","employerRate","threshold","calculationMethod","updatedAt")
SELECT gen_random_uuid()::text, s."companyId", 'ESI', 'State Insurance (company)', '2000-01-01',
  (s."config"->>'esiEmployeeRate')::float, (s."config"->>'esiEmployerRate')::float, (s."config"->>'esiWageThreshold')::float,
  'PERCENT_OF_GROSS', CURRENT_TIMESTAMP
FROM "statutory_settings" s
WHERE s."config" ? 'esiEmployeeRate' AND (
  (s."config"->>'esiEmployeeRate')::float <> 0.75 OR (s."config"->>'esiEmployerRate')::float <> 3.25 OR
  (s."config"->>'esiWageThreshold')::float <> 21000);
INSERT INTO "statutory_rules" ("id","companyId","state","ruleType","name","effectiveFrom","calculationMethod","config","updatedAt")
SELECT gen_random_uuid()::text, s."companyId", s."ptState", 'PT', 'Professional tax (company)', '2000-01-01', 'SLAB',
  jsonb_build_object('slabs', s."config"->'ptSlabs'), CURRENT_TIMESTAMP
FROM "statutory_settings" s
WHERE jsonb_typeof(s."config"->'ptSlabs') = 'array' AND jsonb_array_length(s."config"->'ptSlabs') > 0;

-- Payroll approval is separate from preparation.
INSERT INTO "permissions" ("key", "description") VALUES
('payroll.approve', 'Approve reviewed payroll runs for processing')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'payroll.approve' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Owner','Company Admin','Finance Manager')
ON CONFLICT DO NOTHING;

COMMIT;
