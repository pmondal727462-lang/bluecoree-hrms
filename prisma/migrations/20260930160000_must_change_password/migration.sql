-- Accounts created with a temporary password must choose their own at next sign-in.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
