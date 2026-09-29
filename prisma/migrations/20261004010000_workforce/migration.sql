-- CreateTable
CREATE TABLE "work_agencies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_contracts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "branchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_breaks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_agencies_id_companyId_key" ON "work_agencies"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "work_agencies_companyId_name_key" ON "work_agencies"("companyId", "name");

-- CreateIndex
CREATE INDEX "worker_contracts_companyId_employeeId_startsOn_idx" ON "worker_contracts"("companyId", "employeeId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "work_jobs_id_companyId_key" ON "work_jobs"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "work_jobs_companyId_code_key" ON "work_jobs"("companyId", "code");

-- CreateIndex
CREATE INDEX "work_assignments_companyId_employeeId_startsAt_idx" ON "work_assignments"("companyId", "employeeId", "startsAt");

-- CreateIndex
CREATE INDEX "work_logs_companyId_employeeId_startedAt_idx" ON "work_logs"("companyId", "employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "attendance_breaks_companyId_employeeId_startedAt_idx" ON "attendance_breaks"("companyId", "employeeId", "startedAt");

-- AddForeignKey
ALTER TABLE "work_agencies" ADD CONSTRAINT "work_agencies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_contracts" ADD CONSTRAINT "worker_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_contracts" ADD CONSTRAINT "worker_contracts_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_contracts" ADD CONSTRAINT "worker_contracts_agencyId_companyId_fkey" FOREIGN KEY ("agencyId", "companyId") REFERENCES "work_agencies"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_branchId_companyId_fkey" FOREIGN KEY ("branchId", "companyId") REFERENCES "branches"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_jobId_companyId_fkey" FOREIGN KEY ("jobId", "companyId") REFERENCES "work_jobs"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_jobId_companyId_fkey" FOREIGN KEY ("jobId", "companyId") REFERENCES "work_jobs"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "one_running_job_per_employee" ON "work_logs"("companyId","employeeId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "one_running_break_per_employee" ON "attendance_breaks"("companyId","employeeId") WHERE "endedAt" IS NULL;
ALTER TABLE "work_logs" ADD CONSTRAINT "job_time_order" CHECK ("endedAt" IS NULL OR "endedAt">="startedAt");
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "break_time_order" CHECK ("endedAt" IS NULL OR "endedAt">="startedAt");
ALTER TABLE "work_assignments" ADD CONSTRAINT "assignment_time_order" CHECK ("endsAt">"startsAt");
ALTER TABLE "work_assignments" ADD CONSTRAINT "assignment_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "worker_contracts" ADD CONSTRAINT "contract_date_order" CHECK ("endsOn">="startsOn");
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['work_jobs','work_assignments','work_logs','work_agencies','worker_contracts','attendance_breaks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("companyId" = current_setting(''app.company_id'',true)) WITH CHECK ("companyId" = current_setting(''app.company_id'',true))',t);
  END LOOP;
END $$;
UPDATE "subscription_plans" SET "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['jobtracking'])) WHERE "code" IN ('BASIC','PROFESSIONAL','FREE_TRIAL','ENTERPRISE');
UPDATE "subscription_plans" SET "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['workplanning','contractors'])) WHERE "code" IN ('PROFESSIONAL','FREE_TRIAL','ENTERPRISE');
