-- Phase 10: learning and development.
-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'CLASSROOM',
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "provider" TEXT,
    "certificationValidMonths" INTEGER,
    "passScore" INTEGER,
    "skills" TEXT[],
    "skillLevel" INTEGER NOT NULL DEFAULT 3,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "employeeId" TEXT,
    "organization" TEXT,
    "expertise" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "trainerId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "openEnrollment" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_enrollments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENROLLED',
    "selfEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "attendedAt" TIMESTAMP(3),
    "score" INTEGER,
    "passed" BOOLEAN,
    "completedAt" TIMESTAMP(3),
    "certificateNo" TEXT,
    "certifiedOn" DATE,
    "expiresOn" DATE,
    "remindedAt" TIMESTAMP(3),
    "enrolledBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 3,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "courseId" TEXT,
    "verifiedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_companyId_code_key" ON "courses"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_id_companyId_key" ON "courses"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "trainers_id_companyId_key" ON "trainers"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "trainers_employeeId_companyId_key" ON "trainers"("employeeId", "companyId");

-- CreateIndex
CREATE INDEX "training_sessions_companyId_startsAt_idx" ON "training_sessions"("companyId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "training_sessions_id_companyId_key" ON "training_sessions"("id", "companyId");

-- CreateIndex
CREATE INDEX "training_enrollments_companyId_employeeId_idx" ON "training_enrollments"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "training_enrollments_companyId_expiresOn_idx" ON "training_enrollments"("companyId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "training_enrollments_sessionId_employeeId_key" ON "training_enrollments"("sessionId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_skills_companyId_skill_idx" ON "employee_skills"("companyId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skills_employeeId_skill_key" ON "employee_skills"("employeeId", "skill");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_courseId_companyId_fkey" FOREIGN KEY ("courseId", "companyId") REFERENCES "courses"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_trainerId_companyId_fkey" FOREIGN KEY ("trainerId", "companyId") REFERENCES "trainers"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_sessionId_companyId_fkey" FOREIGN KEY ("sessionId", "companyId") REFERENCES "training_sessions"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses" ADD CONSTRAINT "courses_values_check"
  CHECK ("mode" IN ('CLASSROOM','ONLINE','ON_THE_JOB','EXTERNAL')
    AND "durationHours" > 0
    AND ("certificationValidMonths" IS NULL OR "certificationValidMonths" BETWEEN 1 AND 120)
    AND ("passScore" IS NULL OR "passScore" BETWEEN 0 AND 100)
    AND "skillLevel" BETWEEN 1 AND 5);
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_values_check"
  CHECK ("endsAt" > "startsAt" AND "capacity" BETWEEN 1 AND 1000
    AND "status" IN ('SCHEDULED','COMPLETED','CANCELLED'));
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_values_check"
  CHECK ("status" IN ('ENROLLED','ATTENDED','ABSENT','COMPLETED','FAILED','CANCELLED')
    AND ("score" IS NULL OR "score" BETWEEN 0 AND 100));
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_level_check"
  CHECK ("level" BETWEEN 1 AND 5);

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "courses"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "trainers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "trainers"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "training_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "training_sessions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "training_enrollments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "training_enrollments"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "employee_skills" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_skills"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Permissions: HR manages training; every employee sees their own.
INSERT INTO "permissions" ("key", "description") VALUES
('training.manage', 'Manage courses, trainers, sessions, enrollment, certifications and skills'),
('training.self', 'View own training, certifications and skills, and join open sessions')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'training.manage' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Owner','Company Admin','HR Manager','HR Executive')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT rp."roleId", 'training.self' FROM "role_permissions" rp
WHERE rp."permissionKey" = 'profile.read'
ON CONFLICT DO NOTHING;

-- Plans that include performance also include training.
UPDATE "subscription_plans" SET "features" = array_append("features", 'training')
WHERE 'performance' = ANY("features") AND NOT ('training' = ANY("features"));
