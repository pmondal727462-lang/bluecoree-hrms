-- Phase 11: asset management and two-level expense approval.
-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN     "managerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "managerApprovedBy" TEXT,
ADD COLUMN     "managerNote" TEXT;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "serialNumber" TEXT,
    "cost" DOUBLE PRECISION,
    "purchaseDate" DATE,
    "warrantyUntil" DATE,
    "vendor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "location" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expectedReturnOn" DATE,
    "returnedOn" DATE,
    "issueCondition" TEXT NOT NULL,
    "returnCondition" TEXT,
    "issueNotes" TEXT,
    "returnNotes" TEXT,
    "issuedBy" TEXT NOT NULL,
    "receivedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_companyId_status_idx" ON "assets"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_companyId_assetCode_key" ON "assets"("companyId", "assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "assets_id_companyId_key" ON "assets"("id", "companyId");

-- CreateIndex
CREATE INDEX "asset_assignments_companyId_employeeId_idx" ON "asset_assignments"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "asset_assignments_assetId_issuedOn_idx" ON "asset_assignments"("assetId", "issuedOn");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assetId_companyId_fkey" FOREIGN KEY ("assetId", "companyId") REFERENCES "assets"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assets" ADD CONSTRAINT "assets_values_check"
  CHECK ("category" IN ('LAPTOP','DESKTOP','MONITOR','MOBILE','PRINTER','KEYBOARD','MOUSE','ACCESS_CARD','SIM','OTHER')
    AND "status" IN ('IN_STOCK','ASSIGNED','IN_REPAIR','RETIRED','LOST')
    AND "condition" IN ('NEW','GOOD','FAIR','DAMAGED')
    AND ("cost" IS NULL OR "cost" >= 0));
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_dates_check"
  CHECK ("returnedOn" IS NULL OR "returnedOn" >= "issuedOn");
-- An asset is with at most one employee at a time.
CREATE UNIQUE INDEX "asset_assignments_one_open" ON "asset_assignments"("assetId") WHERE "returnedOn" IS NULL;
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_status_check"
  CHECK ("status" IN ('SUBMITTED','MANAGER_APPROVED','APPROVED','REJECTED','CANCELLED','REIMBURSED'));

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "assets"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "asset_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "asset_assignments"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

INSERT INTO "permissions" ("key", "description") VALUES
('assets.manage', 'Manage the asset register, issue and return assets'),
('assets.self', 'View assets issued to me and acknowledge receipt')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'assets.manage' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Owner','Company Admin','HR Manager','HR Executive')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT rp."roleId", 'assets.self' FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."roleId"
WHERE rp."permissionKey" = 'attendance.self'
ON CONFLICT DO NOTHING;
-- Provider staff roles do not get employee self-service training.
DELETE FROM "role_permissions" rp USING "roles" r
WHERE rp."roleId" = r."id" AND r."system" = true AND r."name" = 'SaaS Admin'
  AND rp."permissionKey" = 'training.self';

UPDATE "subscription_plans" SET "features" = array_append("features", 'assets')
WHERE 'expenses' = ANY("features") AND NOT ('assets' = ANY("features"));
