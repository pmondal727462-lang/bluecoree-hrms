-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "mfa_settings" (
    "companyId" TEXT NOT NULL,
    "requireForAdmins" BOOLEAN NOT NULL DEFAULT false,
    "requireForManagers" BOOLEAN NOT NULL DEFAULT false,
    "requireForEmployees" BOOLEAN NOT NULL DEFAULT false,
    "maxFailedAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "passwordExpiryDays" INTEGER,
    "sessionIdleMinutes" INTEGER,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_history_companyId_createdAt_idx" ON "login_history"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "login_history_userId_createdAt_idx" ON "login_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_companyId_createdAt_idx" ON "security_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_companyId_type_idx" ON "security_events"("companyId", "type");

-- AddForeignKey
ALTER TABLE "mfa_settings" ADD CONSTRAINT "mfa_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "permissions" ("key", "description") VALUES
('security.manage', 'Configure MFA, lockout and session security policies')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", 'security.manage' FROM "roles" r
WHERE r."system" = true AND r."name" IN ('Super Admin','Company Admin')
ON CONFLICT DO NOTHING;
