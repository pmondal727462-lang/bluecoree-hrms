-- Employee photos are private files; only the storage key and metadata are
-- stored here. photoSize counts towards the plan storage limit.
ALTER TABLE "employees" ADD COLUMN "photoKey" TEXT;
ALTER TABLE "employees" ADD COLUMN "photoType" TEXT;
ALTER TABLE "employees" ADD COLUMN "photoSize" INTEGER;
