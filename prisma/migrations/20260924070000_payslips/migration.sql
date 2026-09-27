CREATE TABLE "payslips" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "grossPay" DOUBLE PRECISION NOT NULL,
  "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netPay" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payslips_companyId_employeeId_periodStart_periodEnd_key" ON "payslips"("companyId","employeeId","periodStart","periodEnd");
CREATE INDEX "payslips_companyId_employeeId_periodStart_idx" ON "payslips"("companyId","employeeId","periodStart");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_companyId_fkey" FOREIGN KEY ("employeeId","companyId") REFERENCES "employees"("id","companyId") ON DELETE CASCADE ON UPDATE CASCADE;
