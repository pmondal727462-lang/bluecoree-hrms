ALTER TABLE "contact_leads" ADD COLUMN "notificationState" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "nextNotificationAt" TIMESTAMP(3),
 ADD COLUMN "notificationLockedUntil" TIMESTAMP(3);
CREATE INDEX "contact_leads_nextNotificationAt_idx" ON "contact_leads"("nextNotificationAt");
