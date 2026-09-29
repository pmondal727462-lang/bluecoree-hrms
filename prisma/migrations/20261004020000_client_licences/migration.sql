ALTER TABLE "subscriptions" ADD COLUMN "employeeLimit" INTEGER;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_employee_limit_nonnegative" CHECK ("employeeLimit" IS NULL OR "employeeLimit" >= 0);
