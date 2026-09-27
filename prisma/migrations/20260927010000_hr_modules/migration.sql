-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "breakdown" JSONB;

-- CreateTable
CREATE TABLE "statutory_settings" (
    "companyId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "ptState" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basic" DOUBLE PRECISION NOT NULL,
    "hra" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT true,
    "ptApplicable" BOOLEAN NOT NULL DEFAULT true,
    "taxRegime" TEXT NOT NULL DEFAULT 'NEW',
    "section80C" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "section80D" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hraExemption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totals" JSONB,
    "createdBy" TEXT NOT NULL,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "lopDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidDays" DOUBLE PRECISION NOT NULL,
    "earnings" JSONB NOT NULL,
    "gross" DOUBLE PRECISION NOT NULL,
    "pfWage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "epsWage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfEmployerEpf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfEmployerEps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "edli" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfAdmin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "esiWage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "esiEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "esiEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reimbursements" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL,
    "netPay" DOUBLE PRECISION NOT NULL,
    "employerCost" DOUBLE PRECISION NOT NULL,
    "details" JSONB,
    "payslipId" TEXT,

    CONSTRAINT "payroll_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limitPerClaim" DOUBLE PRECISION,
    "requiresReceipt" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "merchant" TEXT,
    "description" TEXT NOT NULL,
    "receiptName" TEXT,
    "receiptType" TEXT,
    "receiptSize" INTEGER,
    "receiptData" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "payrollRunId" TEXT,
    "reimbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "location" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'Full time',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "hiringManagerId" TEXT,
    "closesOn" DATE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "currentCompany" TEXT,
    "experienceYears" DOUBLE PRECISION,
    "expectedSalary" DOUBLE PRECISION,
    "stage" TEXT NOT NULL DEFAULT 'APPLIED',
    "rating" INTEGER,
    "notes" TEXT,
    "resumeName" TEXT,
    "resumeType" TEXT,
    "resumeSize" INTEGER,
    "resumeData" BYTEA,
    "hiredEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "interviewerName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "mode" TEXT NOT NULL DEFAULT 'VIDEO',
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "rating" INTEGER,
    "recommendation" TEXT,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selfReview" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GOAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT,
    "target" TEXT,
    "unit" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "actual" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT,
    "selfRating" INTEGER,
    "selfComments" TEXT,
    "managerRating" INTEGER,
    "managerComments" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "developmentPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SELF',
    "selfSubmittedAt" TIMESTAMP(3),
    "managerSubmittedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "text" TEXT NOT NULL,
    "visibleToEmployee" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataset" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_employeeId_key" ON "salary_structures"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_employeeId_companyId_key" ON "salary_structures"("employeeId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_companyId_period_key" ON "payroll_runs"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_id_companyId_key" ON "payroll_runs"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_items_payslipId_key" ON "payroll_run_items"("payslipId");

-- CreateIndex
CREATE INDEX "payroll_run_items_companyId_employeeId_idx" ON "payroll_run_items"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_items_runId_employeeId_key" ON "payroll_run_items"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_companyId_name_key" ON "expense_categories"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_id_companyId_key" ON "expense_categories"("id", "companyId");

-- CreateIndex
CREATE INDEX "expense_claims_companyId_status_idx" ON "expense_claims"("companyId", "status");

-- CreateIndex
CREATE INDEX "expense_claims_companyId_employeeId_idx" ON "expense_claims"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "job_openings_companyId_status_idx" ON "job_openings"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_id_companyId_key" ON "job_openings"("id", "companyId");

-- CreateIndex
CREATE INDEX "candidates_companyId_stage_idx" ON "candidates"("companyId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_jobId_email_key" ON "candidates"("jobId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_id_companyId_key" ON "candidates"("id", "companyId");

-- CreateIndex
CREATE INDEX "candidate_events_candidateId_createdAt_idx" ON "candidate_events"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "interviews_companyId_interviewerId_scheduledAt_idx" ON "interviews"("companyId", "interviewerId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycles_id_companyId_key" ON "review_cycles"("id", "companyId");

-- CreateIndex
CREATE INDEX "goals_companyId_employeeId_idx" ON "goals"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_cycleId_employeeId_key" ON "performance_reviews"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "feedback_companyId_employeeId_idx" ON "feedback"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "report_definitions_companyId_idx" ON "report_definitions"("companyId");

-- AddForeignKey
ALTER TABLE "statutory_settings" ADD CONSTRAINT "statutory_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_runId_companyId_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "payroll_runs"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_categoryId_companyId_fkey" FOREIGN KEY ("categoryId", "companyId") REFERENCES "expense_categories"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_jobId_companyId_fkey" FOREIGN KEY ("jobId", "companyId") REFERENCES "job_openings"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_events" ADD CONSTRAINT "candidate_events_candidateId_companyId_fkey" FOREIGN KEY ("candidateId", "companyId") REFERENCES "candidates"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidateId_companyId_fkey" FOREIGN KEY ("candidateId", "companyId") REFERENCES "candidates"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycleId_companyId_fkey" FOREIGN KEY ("cycleId", "companyId") REFERENCES "review_cycles"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- New module permissions for built-in roles. Custom roles need explicit grants.
INSERT INTO "permissions" ("key", "description") VALUES
('recruitment.manage', 'Manage job openings, candidates and hiring'),
('recruitment.interview', 'View assigned interviews and submit feedback'),
('performance.manage', 'Manage review cycles, goals and reviews for all employees'),
('performance.team', 'Set goals and review direct reports'),
('performance.self', 'View own goals and complete self reviews'),
('expenses.self', 'Submit and track own expense claims'),
('expenses.approve', 'Approve direct reports'' expense claims'),
('expenses.manage', 'Manage expense categories, approvals and reimbursements'),
('reports.custom', 'Build and run custom reports on permitted data')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND (
  (r."name" IN ('Super Admin','Company Admin') AND p."key" IN ('recruitment.manage','recruitment.interview','performance.manage','performance.team','performance.self','expenses.self','expenses.approve','expenses.manage','reports.custom'))
  OR (r."name" = 'HR Manager' AND p."key" IN ('recruitment.manage','recruitment.interview','performance.manage','performance.team','performance.self','expenses.self','expenses.approve','expenses.manage','reports.custom'))
  OR (r."name" = 'HR Executive' AND p."key" IN ('recruitment.manage','recruitment.interview','performance.self','expenses.self'))
  OR (r."name" IN ('Payroll Manager','Finance Manager') AND p."key" IN ('expenses.manage','expenses.self','performance.self','reports.custom'))
  OR (r."name" IN ('Department Manager','Team Leader') AND p."key" IN ('performance.team','performance.self','expenses.approve','expenses.self','recruitment.interview'))
  OR (r."name" = 'Recruiter' AND p."key" IN ('recruitment.manage','recruitment.interview','performance.self','expenses.self'))
  OR (r."name" IN ('Employee','Auditor') AND p."key" IN ('performance.self','expenses.self'))
  OR (r."name" = 'Auditor' AND p."key" = 'reports.custom')
)
ON CONFLICT DO NOTHING;

-- Plans that include every module gain the new modules.
UPDATE "subscription_plans"
SET "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['recruitment','performance','expenses']))
WHERE "code" IN ('FREE_TRIAL','PROFESSIONAL','ENTERPRISE');
