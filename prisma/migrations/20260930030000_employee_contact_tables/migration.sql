BEGIN;

-- Addresses, emergency contacts and bank accounts move into their own
-- tenant-scoped tables (spec section 62). Existing JSON values are copied
-- before the old columns are dropped; bank details stay encrypted and are
-- moved by scripts/backfill-bank-accounts.ts.
CREATE TABLE "employee_addresses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pin" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_addresses_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_emergency_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_emergency_contacts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountEncrypted" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "holderName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_addresses_companyId_idx" ON "employee_addresses"("companyId");
CREATE UNIQUE INDEX "employee_addresses_employeeId_type_key" ON "employee_addresses"("employeeId", "type");
CREATE INDEX "employee_emergency_contacts_companyId_employeeId_idx" ON "employee_emergency_contacts"("companyId", "employeeId");
CREATE INDEX "employee_bank_accounts_companyId_employeeId_active_idx" ON "employee_bank_accounts"("companyId", "employeeId", "active");
ALTER TABLE "employee_addresses" ADD CONSTRAINT "employee_addresses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_addresses" ADD CONSTRAINT "employee_addresses_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_emergency_contacts" ADD CONSTRAINT "employee_emergency_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_emergency_contacts" ADD CONSTRAINT "employee_emergency_contacts_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, as for every company-owned table.
ALTER TABLE "employee_addresses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_addresses"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_emergency_contacts"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "employee_bank_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_bank_accounts"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Copy existing values. The old JSON held one address set (current and
-- permanent lines sharing city/state/PIN/country) and one emergency contact.
INSERT INTO "employee_addresses" ("id", "companyId", "employeeId", "type", "line", "city", "state", "pin", "country", "updatedAt")
SELECT gen_random_uuid()::text, e."companyId", e."id", 'CURRENT',
       NULLIF(btrim(e."address"->>'current'), ''), NULLIF(btrim(e."address"->>'city'), ''),
       NULLIF(btrim(e."address"->>'state'), ''), NULLIF(btrim(e."address"->>'pin'), ''),
       NULLIF(btrim(e."address"->>'country'), ''), CURRENT_TIMESTAMP
FROM "employees" e
WHERE jsonb_typeof(e."address"::jsonb) = 'object'
  AND COALESCE(NULLIF(btrim(e."address"->>'current'), ''), NULLIF(btrim(e."address"->>'city'), ''),
               NULLIF(btrim(e."address"->>'state'), ''), NULLIF(btrim(e."address"->>'pin'), ''),
               NULLIF(btrim(e."address"->>'country'), '')) IS NOT NULL;
INSERT INTO "employee_addresses" ("id", "companyId", "employeeId", "type", "line", "updatedAt")
SELECT gen_random_uuid()::text, e."companyId", e."id", 'PERMANENT',
       btrim(e."address"->>'permanent'), CURRENT_TIMESTAMP
FROM "employees" e
WHERE jsonb_typeof(e."address"::jsonb) = 'object'
  AND NULLIF(btrim(e."address"->>'permanent'), '') IS NOT NULL;
INSERT INTO "employee_emergency_contacts" ("id", "companyId", "employeeId", "name", "relationship", "phone", "isPrimary", "updatedAt")
SELECT gen_random_uuid()::text, e."companyId", e."id",
       COALESCE(NULLIF(btrim(e."emergencyContact"->>'name'), ''), 'Emergency contact'),
       NULLIF(btrim(e."emergencyContact"->>'relationship'), ''),
       NULLIF(btrim(e."emergencyContact"->>'phone'), ''), true, CURRENT_TIMESTAMP
FROM "employees" e
WHERE jsonb_typeof(e."emergencyContact"::jsonb) = 'object'
  AND COALESCE(NULLIF(btrim(e."emergencyContact"->>'name'), ''),
               NULLIF(btrim(e."emergencyContact"->>'phone'), '')) IS NOT NULL;

ALTER TABLE "employees" DROP COLUMN "address", DROP COLUMN "emergencyContact";

COMMIT;
