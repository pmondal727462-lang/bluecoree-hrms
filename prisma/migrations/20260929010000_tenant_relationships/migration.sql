BEGIN;

-- Validate before replacing constraints. An inconsistent existing record
-- aborts this transaction; the migration never repairs or deletes user data.
ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_employeeId_companyId_fkey"
  FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_onboardingId_companyId_fkey"
  FOREIGN KEY ("onboardingId", "companyId") REFERENCES "onboarding"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "document_acknowledgements"
  ADD CONSTRAINT "document_acknowledgements_employeeId_companyId_fkey"
  FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_documents" DROP CONSTRAINT "employee_documents_employeeId_fkey";
ALTER TABLE "employee_documents" DROP CONSTRAINT "employee_documents_onboardingId_fkey";

-- Preserve existing plans' attendance capabilities when introducing the
-- separately configurable face entitlement. Do not change pricing or limits.
UPDATE "subscription_plans"
SET "features" = array_append("features", 'face'), "updatedAt" = CURRENT_TIMESTAMP
WHERE 'attendance' = ANY("features") AND NOT ('face' = ANY("features"));

COMMIT;
