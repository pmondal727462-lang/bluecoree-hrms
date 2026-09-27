-- Accounts saved through the employee form may not have an IFSC yet.
ALTER TABLE "employee_bank_accounts" ALTER COLUMN "ifsc" DROP NOT NULL;
