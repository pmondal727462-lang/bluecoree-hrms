ALTER TABLE "users"
  ADD COLUMN "mustSetPassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordSetAt" TIMESTAMP(3);
