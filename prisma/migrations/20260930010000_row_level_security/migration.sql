BEGIN;

-- Row-level security for tenant data. The restricted application role sees
-- only rows whose company matches app.company_id, which the application sets
-- per transaction (set_config(..., true)). An unset value matches nothing.
-- The table owner (migrations) and the BYPASSRLS system role are unaffected.
-- Roles and grants are environment-specific: see scripts/db-roles.ts.

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "companies"
  USING ("id" = current_setting('app.company_id', true))
  WITH CHECK ("id" = current_setting('app.company_id', true));

-- Child tables without their own companyId inherit their parent's visibility;
-- the parent lookup is itself filtered by row-level security.
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sessions"
  USING (EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "sessions"."userId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "sessions"."userId"));

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "role_permissions"
  USING (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."roleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."roleId"));

ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_messages"
  USING (EXISTS (SELECT 1 FROM "ai_conversations" c WHERE c."id" = "ai_messages"."conversationId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ai_conversations" c WHERE c."id" = "ai_messages"."conversationId"));


ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "roles"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "users"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_conversations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ai_access_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_access_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ai_generated_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_generated_documents"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "departments"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "designations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "designations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "branches"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employees"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "auth_challenges" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "auth_challenges"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "attendance_policies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_policies"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "face_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "face_profiles"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "face_verification_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "face_verification_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "field_tracking_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "field_tracking_sessions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "field_tracking_points" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "field_tracking_points"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payslips"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "employee_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_devices"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "push_tokens"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "shifts"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "holidays"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "leave_types"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "leave_requests"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "attendance_regularizations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_regularizations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "attendance_locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_locations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "employee_attendance_locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_attendance_locations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "geofence_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "geofence_events"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "mobile_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mobile_sessions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "integrations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "integration_credentials" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "integration_credentials"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "integration_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "integration_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "webhooks"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "webhook_deliveries"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "api_keys"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "api_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "api_logs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "mfa_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mfa_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "login_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "login_history"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "security_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "security_events"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "subscription_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscription_usage"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "company_branding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "company_branding"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "support_tickets"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "support_messages"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "statutory_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "statutory_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "salary_structures" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "salary_structures"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_runs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "payroll_run_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_run_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "expense_categories"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "expense_claims" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "expense_claims"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "job_openings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "job_openings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "candidates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "candidate_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "candidate_events"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "interviews"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "review_cycles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "review_cycles"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "goals"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "performance_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "performance_reviews"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "feedback"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "report_definitions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "report_definitions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "company_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "employee_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_history"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "exit_settlements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "exit_settlements"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_documents"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_versions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "document_acknowledgements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_acknowledgements"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tickets"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ticket_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ticket_messages"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "onboarding_task_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_task_templates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "onboarding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "onboarding_tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_tasks"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "announcements"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "notifications"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "notification_templates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "attendance_punches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_punches"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "rosters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "rosters"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "leave_ledger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "leave_ledger"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "comp_off_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "comp_off_requests"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "holiday_selections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "holiday_selections"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

COMMIT;
