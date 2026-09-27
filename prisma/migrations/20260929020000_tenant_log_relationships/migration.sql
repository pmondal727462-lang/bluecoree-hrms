BEGIN;

-- Composite keys that the new tenant-scoped foreign keys reference.
CREATE UNIQUE INDEX "employee_devices_id_companyId_key" ON "employee_devices"("id", "companyId");
CREATE UNIQUE INDEX "api_keys_id_companyId_key" ON "api_keys"("id", "companyId");

-- Validate before replacing constraints. An inconsistent existing record
-- aborts this transaction; the migration never repairs or deletes user data.
ALTER TABLE "field_tracking_points"
  ADD CONSTRAINT "field_tracking_points_sessionId_companyId_fkey"
  FOREIGN KEY ("sessionId", "companyId") REFERENCES "field_tracking_sessions"("id", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "geofence_events"
  ADD CONSTRAINT "geofence_events_locationId_companyId_fkey"
  FOREIGN KEY ("locationId", "companyId") REFERENCES "attendance_locations"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "mobile_sessions"
  ADD CONSTRAINT "mobile_sessions_deviceId_companyId_fkey"
  FOREIGN KEY ("deviceId", "companyId") REFERENCES "employee_devices"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "integration_logs"
  ADD CONSTRAINT "integration_logs_integrationId_companyId_fkey"
  FOREIGN KEY ("integrationId", "companyId") REFERENCES "integrations"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "api_logs"
  ADD CONSTRAINT "api_logs_apiKeyId_companyId_fkey"
  FOREIGN KEY ("apiKeyId", "companyId") REFERENCES "api_keys"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "login_history"
  ADD CONSTRAINT "login_history_userId_companyId_fkey"
  FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "expense_claims"
  ADD CONSTRAINT "expense_claims_payrollRunId_companyId_fkey"
  FOREIGN KEY ("payrollRunId", "companyId") REFERENCES "payroll_runs"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "goals"
  ADD CONSTRAINT "goals_cycleId_companyId_fkey"
  FOREIGN KEY ("cycleId", "companyId") REFERENCES "review_cycles"("id", "companyId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "field_tracking_points" DROP CONSTRAINT "field_tracking_points_sessionId_fkey";
ALTER TABLE "geofence_events" DROP CONSTRAINT "geofence_events_locationId_fkey";
ALTER TABLE "mobile_sessions" DROP CONSTRAINT "mobile_sessions_deviceId_fkey";
ALTER TABLE "integration_logs" DROP CONSTRAINT "integration_logs_integrationId_fkey";
ALTER TABLE "api_logs" DROP CONSTRAINT "api_logs_apiKeyId_fkey";
ALTER TABLE "login_history" DROP CONSTRAINT "login_history_userId_fkey";
ALTER TABLE "expense_claims" DROP CONSTRAINT "expense_claims_payrollRunId_fkey";
ALTER TABLE "goals" DROP CONSTRAINT "goals_cycleId_fkey";

COMMIT;
