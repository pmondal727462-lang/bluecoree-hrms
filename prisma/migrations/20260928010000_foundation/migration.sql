-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "company_settings" (
    "companyId" TEXT NOT NULL,
    "legalName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "payrollCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "payrollCutoffDay" INTEGER,
    "logoData" BYTEA,
    "logoType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "employee_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_settlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitType" TEXT NOT NULL,
    "resignationDate" DATE,
    "lastWorkingDay" DATE NOT NULL,
    "reason" TEXT,
    "noticeDays" INTEGER NOT NULL DEFAULT 0,
    "noticeServedDays" INTEGER NOT NULL DEFAULT 0,
    "pendingSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaveEncashment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gratuity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noticeRecovery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_history_companyId_employeeId_effectiveDate_idx" ON "employee_history"("companyId", "employeeId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "exit_settlements_employeeId_key" ON "exit_settlements"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "exit_settlements_employeeId_companyId_key" ON "exit_settlements"("employeeId", "companyId");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;


-- New built-in roles for existing companies.
INSERT INTO "roles" ("id", "companyId", "name", "system")
SELECT gen_random_uuid()::text, c."id", r.name, true
FROM "companies" c CROSS JOIN (VALUES ('Company Owner'), ('SaaS Admin')) AS r(name)
ON CONFLICT ("companyId", "name") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND r."name" = 'Company Owner'
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND r."name" = 'SaaS Admin'
  AND p."key" IN ('dashboard.read','company.read','audit.read','support.use','profile.read','profile.write')
ON CONFLICT DO NOTHING;
