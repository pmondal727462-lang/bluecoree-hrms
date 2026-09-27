INSERT INTO "permissions" ("key", "description") VALUES
('payroll.self', 'View and download own payslips'),
('payroll.read', 'View company payslips'),
('payroll.manage', 'Create and manage payslips')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."system" = true AND (
  (r."name" IN ('Super Admin','Company Admin','HR Manager','Payroll Manager','Finance Manager') AND p."key" IN ('payroll.self','payroll.read','payroll.manage'))
  OR (p."key" = 'payroll.self' AND r."name" IN ('HR Executive','Department Manager','Team Leader','Employee','Recruiter'))
)
ON CONFLICT DO NOTHING;
