-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "employeeLimit" INTEGER,
    "adminLimit" INTEGER,
    "storageLimitMb" INTEGER,
    "apiCallLimitMonthly" INTEGER,
    "aiRequestLimitMonthly" INTEGER,
    "features" TEXT[],
    "trialDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trialStartsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_usage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_branding" (
    "companyId" TEXT NOT NULL,
    "brandName" TEXT,
    "portalTitle" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "loginMessage" TEXT,
    "emailFooter" TEXT,
    "payslipFooter" TEXT,
    "logoData" BYTEA,
    "logoType" TEXT,
    "customDomain" TEXT,
    "domainToken" TEXT,
    "domainVerifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_branding_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_companyId_key" ON "subscriptions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_usage_companyId_metric_period_key" ON "subscription_usage"("companyId", "metric", "period");

-- CreateIndex
CREATE UNIQUE INDEX "company_branding_customDomain_key" ON "company_branding"("customDomain");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_usage" ADD CONSTRAINT "subscription_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_branding" ADD CONSTRAINT "company_branding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plans start without prices or numeric limits (NULL = unlimited); a Super
-- Admin sets commercial terms. Feature lists are editable per plan.
INSERT INTO "subscription_plans" ("id","code","name","description","features","trialDays","sortOrder","updatedAt") VALUES
('plan_free_trial','FREE_TRIAL','Free Trial','Full evaluation access for a limited period.',ARRAY['attendance','payroll','ai','mobile','biometric','reports','api'],15,0,CURRENT_TIMESTAMP),
('plan_basic','BASIC','Basic','Core HR, attendance, leave and mobile access.',ARRAY['attendance','mobile','reports'],NULL,1,CURRENT_TIMESTAMP),
('plan_professional','PROFESSIONAL','Professional','Adds payroll, AI, biometric import and API access.',ARRAY['attendance','payroll','ai','mobile','biometric','reports','api'],NULL,2,CURRENT_TIMESTAMP),
('plan_enterprise','ENTERPRISE','Enterprise','All modules including white-label branding.',ARRAY['attendance','payroll','ai','mobile','biometric','reports','api','whitelabel'],NULL,3,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Existing companies keep full access: active Enterprise with no end date.
INSERT INTO "subscriptions" ("id","companyId","planId","status","currentPeriodStart","notes","updatedAt")
SELECT 'sub_' || c."id", c."id", 'plan_enterprise', 'ACTIVE', CURRENT_TIMESTAMP, 'Created for an existing company when subscriptions were introduced.', CURRENT_TIMESTAMP
FROM "companies" c
ON CONFLICT ("companyId") DO NOTHING;

INSERT INTO "permissions" ("key", "description") VALUES
('support.use', 'Create and follow company support tickets')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'support.use' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Admin','HR Manager')
ON CONFLICT DO NOTHING;
