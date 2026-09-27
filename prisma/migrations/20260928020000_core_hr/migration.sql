-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "onboardingId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "expiresOn" DATE,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_acknowledgements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "fromAgent" BOOLEAN NOT NULL DEFAULT false,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_task_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "documentCategory" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "onboarding_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT,
    "employeeId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "employeeCode" TEXT NOT NULL,
    "joiningDate" DATE NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "portalTokenHash" TEXT,
    "portalExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "documentCategory" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documentId" TEXT,
    "notes" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "departmentId" TEXT,
    "branchId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_documents_companyId_employeeId_idx" ON "employee_documents"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_documents_companyId_expiresOn_idx" ON "employee_documents"("companyId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_id_companyId_key" ON "employee_documents"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_acknowledgements_documentId_employeeId_key" ON "document_acknowledgements"("documentId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_companyId_status_idx" ON "tickets"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_id_companyId_key" ON "tickets"("id", "companyId");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "onboarding_task_templates_companyId_idx" ON "onboarding_task_templates"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_candidateId_key" ON "onboarding"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_employeeId_key" ON "onboarding"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_portalTokenHash_key" ON "onboarding"("portalTokenHash");

-- CreateIndex
CREATE INDEX "onboarding_companyId_status_idx" ON "onboarding"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_id_companyId_key" ON "onboarding"("id", "companyId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_onboardingId_idx" ON "onboarding_tasks"("onboardingId");

-- CreateIndex
CREATE INDEX "announcements_companyId_publishedAt_idx" ON "announcements"("companyId", "publishedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_companyId_event_channel_key" ON "notification_templates"("companyId", "event", "channel");

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "employee_documents"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "employee_documents"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_companyId_fkey" FOREIGN KEY ("ticketId", "companyId") REFERENCES "tickets"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task_templates" ADD CONSTRAINT "onboarding_task_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_onboardingId_companyId_fkey" FOREIGN KEY ("onboardingId", "companyId") REFERENCES "onboarding"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "users"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "permissions" ("key", "description") VALUES
('documents.self', 'Upload and view own documents and company policies'),
('documents.manage', 'Manage all employee and company documents'),
('helpdesk.self', 'Raise and follow own HR helpdesk tickets'),
('helpdesk.manage', 'Work HR helpdesk tickets for the company'),
('onboarding.manage', 'Run new-joiner onboarding'),
('announcements.manage', 'Publish company announcements'),
('notifications.manage', 'Edit notification and email templates')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND (
  (r."name" IN ('Super Admin','Company Owner','Company Admin') AND p."key" IN ('documents.self','documents.manage','helpdesk.self','helpdesk.manage','onboarding.manage','announcements.manage','notifications.manage'))
  OR (r."name" = 'HR Manager' AND p."key" IN ('documents.self','documents.manage','helpdesk.self','helpdesk.manage','onboarding.manage','announcements.manage','notifications.manage'))
  OR (r."name" = 'HR Executive' AND p."key" IN ('documents.self','documents.manage','helpdesk.self','helpdesk.manage','onboarding.manage','announcements.manage'))
  OR (r."name" = 'Recruiter' AND p."key" IN ('documents.self','helpdesk.self','onboarding.manage'))
  OR (r."name" IN ('Payroll Manager','Finance Manager','Department Manager','Team Leader','Employee','Auditor','SaaS Admin') AND p."key" IN ('documents.self','helpdesk.self'))
)
ON CONFLICT DO NOTHING;
UPDATE "subscription_plans"
SET "features" = ARRAY(SELECT DISTINCT unnest("features" || ARRAY['onboarding']))
WHERE "code" IN ('FREE_TRIAL','PROFESSIONAL','ENTERPRISE');
