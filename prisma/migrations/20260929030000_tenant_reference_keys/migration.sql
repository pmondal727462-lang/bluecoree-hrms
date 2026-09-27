BEGIN;

-- Tenant-scoped foreign keys for the remaining record references. Adding each
-- constraint validates existing rows; an inconsistent record aborts this
-- transaction. The migration never repairs or deletes user data.
CREATE UNIQUE INDEX "payslips_id_companyId_key" ON "payslips"("id", "companyId");
CREATE UNIQUE INDEX "attendance_id_companyId_key" ON "attendance"("id", "companyId");
ALTER TABLE "face_verification_logs" ADD CONSTRAINT "face_verification_logs_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_payslipId_companyId_fkey" FOREIGN KEY ("payslipId", "companyId") REFERENCES "payslips"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_hiringManagerId_companyId_fkey" FOREIGN KEY ("hiringManagerId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hiredEmployeeId_companyId_fkey" FOREIGN KEY ("hiredEmployeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewerId_companyId_fkey" FOREIGN KEY ("interviewerId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewerEmployeeId_companyId_fkey" FOREIGN KEY ("reviewerEmployeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_candidateId_companyId_fkey" FOREIGN KEY ("candidateId", "companyId") REFERENCES "candidates"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_designationId_companyId_fkey" FOREIGN KEY ("designationId", "companyId") REFERENCES "designations"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "employee_documents"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_branchId_companyId_fkey" FOREIGN KEY ("branchId", "companyId") REFERENCES "branches"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_attendanceId_companyId_fkey" FOREIGN KEY ("attendanceId", "companyId") REFERENCES "attendance"("id", "companyId") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
