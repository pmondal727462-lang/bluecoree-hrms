-- Final prices supplied by the software owner. Keep existing contracts and
-- historic invoices; only the current catalogue and future quotes change.
ALTER TABLE "add_ons" ALTER COLUMN "priceMonthly" DROP NOT NULL;
ALTER TABLE "add_ons" ADD COLUMN "public" BOOLEAN NOT NULL DEFAULT true;
UPDATE "subscription_plans" SET "priceAnnual" = 30000,
 "pricePerEmployeeAnnual" = CASE WHEN "code" = 'BASIC' THEN 100 ELSE 150 END,
 "name" = CASE WHEN "code" = 'BASIC' THEN 'Basic' ELSE 'Advanced' END,
 "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['face'])),
 "updatedAt" = CURRENT_TIMESTAMP WHERE "code" IN ('BASIC','PROFESSIONAL');
UPDATE "subscription_plans" SET "public" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ENTERPRISE';
UPDATE "add_ons" SET "public" = false, "updatedAt" = CURRENT_TIMESTAMP;
INSERT INTO "add_ons" ("id","code","name","description","feature","priceMonthly","priceAnnual","perEmployee","active","public","updatedAt")
VALUES ('addon_live_tracking','LIVE_TRACKING','Live Tracking','Live employee location tracking during an active work session. Add to Basic or Advanced; billed annually.','livetracking',NULL,150,true,true,true,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "priceMonthly"=NULL,"priceAnnual"=150,"perEmployee"=true,"active"=true,"public"=true,"feature"='livetracking',"updatedAt"=CURRENT_TIMESTAMP;
-- Preserve the full evaluation and pre-existing Enterprise access.
UPDATE "subscription_plans" SET "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['livetracking'])) WHERE "code" IN ('FREE_TRIAL','ENTERPRISE');
