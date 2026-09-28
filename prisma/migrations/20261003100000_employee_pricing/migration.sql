-- India annual pricing requested by the owner, based on truein.com/pricing.
-- Applies prospectively to quotes; historical invoices retain their saved lines.
UPDATE "subscription_plans"
SET "priceMonthly" = NULL, "pricePerEmployeeMonthly" = NULL,
    "priceAnnual" = 69000,
    "pricePerEmployeeAnnual" = CASE WHEN "code" = 'BASIC' THEN 250 ELSE 350 END,
    "minimumMonthly" = NULL, "currency" = 'INR', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('BASIC', 'PROFESSIONAL');
