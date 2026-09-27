-- Signup requests are read and written by the system role only; the tenant
-- policy keeps them invisible to the application role once linked.
ALTER TABLE "signup_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "signup_requests"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
