ALTER TABLE "attendance_policies" ADD COLUMN "singlePunchStatus" TEXT NOT NULL DEFAULT 'MISSED_PUNCH';
ALTER TABLE "attendance_policies" ADD CONSTRAINT "single_punch_status_valid" CHECK ("singlePunchStatus" IN ('MISSED_PUNCH', 'PRESENT', 'ABSENT', 'HALF_DAY'));
CREATE TABLE "celebration_wishes" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL, "kind" TEXT NOT NULL, "date" DATE NOT NULL, "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "celebration_company_fk" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "celebration_employee_fk" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "celebration_user_fk" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "celebration_wishes_companyId_employeeId_userId_kind_date_key" ON "celebration_wishes"("companyId", "employeeId", "userId", "kind", "date");
CREATE INDEX "celebration_wishes_companyId_date_idx" ON "celebration_wishes"("companyId", "date");
ALTER TABLE "celebration_wishes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "celebration_wishes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
