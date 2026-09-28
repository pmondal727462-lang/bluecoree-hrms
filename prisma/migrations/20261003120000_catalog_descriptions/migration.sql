UPDATE "subscription_plans" SET "description" = 'Face attendance, geofencing, offline capture, leave and essential reports.', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'BASIC';
UPDATE "subscription_plans" SET "description" = 'Everything in Basic, plus shift scheduling, advanced attendance policies and reporting.', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'PROFESSIONAL';
