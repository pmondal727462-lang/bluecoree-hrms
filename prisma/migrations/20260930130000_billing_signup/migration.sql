-- Phase 15: billing (add-ons, coupons, GST invoices, payments, refunds), signup and contact leads.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingState" TEXT,
ADD COLUMN     "onboardingDismissedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "locationLimit" INTEGER,
ADD COLUMN     "minimumMonthly" DECIMAL(12,2),
ADD COLUMN     "priceAnnual" DECIMAL(12,2),
ADD COLUMN     "pricePerEmployeeAnnual" DECIMAL(12,2),
ADD COLUMN     "pricePerEmployeeMonthly" DECIMAL(12,2),
ADD COLUMN     "public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "renewalReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "trialReminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "add_ons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "feature" TEXT,
    "priceMonthly" DECIMAL(12,2) NOT NULL,
    "priceAnnual" DECIMAL(12,2) NOT NULL,
    "perEmployee" BOOLEAN NOT NULL DEFAULT false,
    "extraStorageMb" INTEGER,
    "extraAiRequests" INTEGER,
    "extraApiCalls" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_add_ons" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "subscription_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" DECIMAL(5,2),
    "amountOff" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "planCodes" TEXT[],
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "financialYear" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("financialYear")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "employees" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "couponCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "billingName" TEXT NOT NULL,
    "billingGstin" TEXT,
    "billingAddress" TEXT,
    "billingState" TEXT,
    "placeOfSupply" TEXT,
    "dueDate" DATE NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "reference" TEXT,
    "failureReason" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_requests" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "companyId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "employees" INTEGER,
    "message" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "add_ons_code_key" ON "add_ons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_add_ons_companyId_addOnId_key" ON "subscription_add_ons"("companyId", "addOnId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_companyId_issuedAt_idx" ON "invoices"("companyId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_companyId_key" ON "invoices"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerOrderId_key" ON "payments"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_companyId_createdAt_idx" ON "payments"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_companyId_key" ON "payments"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerRefundId_key" ON "refunds"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "signup_requests_tokenHash_key" ON "signup_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "signup_requests_email_idx" ON "signup_requests"("email");

-- AddForeignKey
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "invoices"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "invoices"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_companyId_fkey" FOREIGN KEY ("paymentId", "companyId") REFERENCES "payments"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cycle_check"
  CHECK ("billingCycle" IN ('MONTHLY','ANNUAL'));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_values_check"
  CHECK ("status" IN ('ISSUED','PAID','VOID','REFUNDED','PARTIALLY_REFUNDED')
    AND "billingCycle" IN ('MONTHLY','ANNUAL')
    AND "total" >= 0 AND "discount" >= 0 AND "refundedAmount" >= 0
    AND "refundedAmount" <= "total");
ALTER TABLE "payments" ADD CONSTRAINT "payments_values_check"
  CHECK ("status" IN ('CREATED','CAPTURED','FAILED','REFUNDED') AND "amount" >= 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_values_check"
  CHECK ("status" IN ('PENDING','PROCESSED','FAILED') AND "amount" > 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_values_check"
  CHECK (("percentOff" IS NULL) <> ("amountOff" IS NULL)
    AND ("percentOff" IS NULL OR "percentOff" BETWEEN 0 AND 100)
    AND ("amountOff" IS NULL OR "amountOff" >= 0));
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_quantity_check"
  CHECK ("quantity" >= 1);

ALTER TABLE "subscription_add_ons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscription_add_ons"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invoices"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payments"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "refunds"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Annual price defaults to ten months where only a monthly price was set.
UPDATE "subscription_plans" SET "priceAnnual" = "priceMonthly" * 10
WHERE "priceAnnual" IS NULL AND "priceMonthly" IS NOT NULL;

-- Starter add-ons; the Super Admin edits prices and availability.
INSERT INTO "add_ons" ("id", "code", "name", "description", "feature", "priceMonthly", "priceAnnual", "perEmployee", "extraStorageMb", "updatedAt") VALUES
('addon_biometric', 'BIOMETRIC', 'Biometric devices', 'Connect attendance terminals', 'biometric', 999, 9990, false, NULL, CURRENT_TIMESTAMP),
('addon_ai', 'AI_COPILOT', 'AI Copilot', 'HR Copilot questions and drafting', 'ai', 20, 200, true, NULL, CURRENT_TIMESTAMP),
('addon_payroll', 'ADVANCED_PAYROLL', 'Advanced payroll', 'Statutory payroll, loans and payslips', 'payroll', 30, 300, true, NULL, CURRENT_TIMESTAMP),
('addon_recruitment', 'RECRUITMENT', 'Recruitment', 'Careers page, pipeline and offers', 'recruitment', 1999, 19990, false, NULL, CURRENT_TIMESTAMP),
('addon_whitelabel', 'WHITE_LABEL', 'White label', 'Your brand, domain and emails', 'whitelabel', 2999, 29990, false, NULL, CURRENT_TIMESTAMP),
('addon_api', 'API', 'API access', 'Public API, webhooks and integrations', 'api', 1499, 14990, false, NULL, CURRENT_TIMESTAMP),
('addon_storage', 'EXTRA_STORAGE', 'Extra storage (10 GB)', 'Additional document storage per unit', NULL, 499, 4990, false, 10240, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
