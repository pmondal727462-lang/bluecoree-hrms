-- CreateTable
CREATE TABLE "ai_settings" (
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowExternalProcessing" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_access_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "dataSources" TEXT[],
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generated_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "inputEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_companyId_userId_createdAt_idx" ON "ai_conversations"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_id_companyId_key" ON "ai_conversations"("id", "companyId");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_access_logs_companyId_timestamp_idx" ON "ai_access_logs"("companyId", "timestamp");

-- CreateIndex
CREATE INDEX "ai_generated_documents_companyId_kind_status_idx" ON "ai_generated_documents"("companyId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_generated_documents_id_companyId_key" ON "ai_generated_documents"("id", "companyId");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_logs" ADD CONSTRAINT "ai_access_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_logs" ADD CONSTRAINT "ai_access_logs_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generated_documents" ADD CONSTRAINT "ai_generated_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generated_documents" ADD CONSTRAINT "ai_generated_documents_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend built-in roles without replacing any existing grants or custom roles.
INSERT INTO "permissions" ("key", "description") VALUES
('ai.use', 'Use HR Copilot with existing data permissions'),
('ai.configure', 'Configure company AI processing and retention'),
('ai.recruitment', 'Draft and review job descriptions and interview notes'),
('ai.performance', 'Draft and approve performance suggestions'),
('ai.documents', 'Draft and approve employee letters'),
('ai.reports', 'Summarize reports permitted by existing permissions'),
('attendance.team.read', 'View direct reports attendance through HR Copilot'),
('timeoff.team.read', 'View direct reports leave through HR Copilot')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND p."key" IN ('ai.use', 'ai.configure', 'ai.recruitment', 'ai.performance', 'ai.documents', 'ai.reports', 'attendance.team.read', 'timeoff.team.read')
AND (
  r."name" IN ('Super Admin', 'Company Admin')
  OR p."key" = 'ai.use'
  OR (r."name" = 'HR Manager' AND p."key" IN ('ai.recruitment', 'ai.performance', 'ai.documents', 'ai.reports'))
  OR (r."name" IN ('Department Manager', 'Team Leader') AND p."key" IN ('attendance.team.read', 'timeoff.team.read', 'ai.performance'))
  OR (r."name" = 'Recruiter' AND p."key" = 'ai.recruitment')
)
ON CONFLICT DO NOTHING;
