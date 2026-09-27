# Foundation remediation

This change resolves a defined foundation/security batch from the implementation audit. It does not mark all 18 phases complete.

## Changes

- See [Row-level security](#row-level-security) for the database tenant policies added after this batch.
- Database constraints now require documents to reference employees and onboarding records in the same company. Acknowledgements also require an employee in that company. Existing rows are validated by PostgreSQL before the constraints are replaced; inconsistent data aborts the migration without automatic repair or deletion.
- Deleting an onboarding record referenced by documents now requires explicit unlinking or removal of those documents. It no longer silently unlinks them. Existing company deletion cascades remain supported.
- Missing subscriptions return `402 SUBSCRIPTION_REQUIRED` for gated modules, quotas, storage additions and employee/admin limit checks. Core record reads, authentication and subscription recovery remain reachable. An active trial plan with a configured duration is mandatory when provisioning a company; failure rolls back provisioning.
- A trial without an expiry is expired, not unlimited active access. Mobile payroll and attendance routes now require their module entitlement as well as mobile access.
- Face enrollment and attendance verification require a dedicated `face` entitlement. Existing attendance-enabled plans receive that entitlement during migration to preserve existing functionality; Super Admin can then configure it separately. Removing it does not force users into an enrollment screen they cannot complete; face-required punches remain blocked and require HR policy/plan resolution.
- The camera Permissions Policy now allows same-origin camera access. Microphone access remains disabled. Browser permission and a suitable face provider are still required.
- Employee form manager/account/department/designation/location selectors and directory filters use permission-checked, tenant-scoped, paginated search. Responses contain only IDs and display names. Selected records are fetched within the same tenant, even when outside the current page. Organization management supports paginated results while older list consumers retain their response format.
- Default product name/logo come from `src/config/product.ts`. Configure `NEXT_PUBLIC_PRODUCT_NAME` and `NEXT_PUBLIC_PRODUCT_LOGO` before building to rename the product. These are public build-time values, not secrets. Tenant white-label settings continue to take precedence where supported.
- README and Copilot messaging no longer claim implemented onboarding/documents are absent. The new reference API is documented in OpenAPI; complete documentation of every later module remains pending.
- Integration suites use distinct simulated client IPs behind the test-only trusted-proxy configuration. This prevents repeated test runs from exhausting the development server's shared localhost login bucket; production limits and the rate-limit tests remain enabled.

## Changed files

- `prisma/schema.prisma` and `prisma/migrations/20260929010000_tenant_relationships/migration.sql`
- `src/modules/organization/references.ts`, `src/modules/organization/service.ts`
- `src/components/reference-select.tsx`, `src/components/record-form.tsx`, `src/components/directory.tsx`, `src/types/ui.ts`
- `src/modules/saas/service.ts`, `src/modules/face/routes.ts`, `src/modules/time/service.ts`, `src/app/api/[...path]/route.ts`
- `next.config.ts`, `src/config/product.ts`, `src/app/layout.tsx`, `src/components/company-logo.tsx`, `src/components/auth-form.tsx`, `src/components/recovery-form.tsx`, `src/components/employee-setup-form.tsx`, `src/components/dashboard.tsx`, `src/modules/auth/account.ts`
- `src/modules/ai/queries.ts`, `src/config/openapi.ts`
- `tests/integration/foundation-hardening.test.ts`, `tests/integration/client.ts`, existing integration request builders/helpers, `vitest.integration.config.ts`, `scripts/smoke.ts`, README and audit/remediation documentation

## Apply and verify

```powershell
npm run db:migrate
npm run db:generate
npm run typecheck
npm run lint
npm test
$env:LOG_LEVEL='silent'
npm run test:integration
npm run build
```

Restart the server after building to apply headers and build-time branding. Do not reseed or reset the database. Migration application and Prisma generation have been performed on the configured development database.

## Verification results

- All 25 migrations are applied; Prisma schema validation and generation passed.
- Type checking and lint passed (138 checked source/test/script files).
- All 50 unit tests and all 90 integration tests passed. The integration suite includes six new hardening scenarios and retains the existing security/tenant tests.
- Production build passed.
- HTTP smoke passed against a temporary production server on localhost:3002, including camera/security headers, login/logout, paginated references, employees, dashboard, company, roles, attendance and leave. The temporary server used a trusted-proxy configuration only for isolated local verification; production proxy trust still needs to match the deployed ingress.
- Chrome verification confirmed the built login page title, logo labels and BlueCoree branding. Actual camera capture/provider verification and authenticated selector browser interaction remain unverified; their HTTP/database behavior is covered as described above.
- The temporary verification tab and server were closed afterward.

The existing non-blocking Prisma configuration deprecation and Vitest module-format warnings remain.

## Tenant relationship review (second batch)

A schema scan reviewed every tenant-owned model's relations and `*Id` columns. Eight existing single-column foreign keys to tenant-owned tables were replaced by composite `(id, companyId)` keys in `prisma/migrations/20260929020000_tenant_log_relationships`:

| Table.column | References | Delete behavior |
| --- | --- | --- |
| `field_tracking_points.sessionId` | `field_tracking_sessions` | Cascade (unchanged) |
| `geofence_events.locationId` | `attendance_locations` | No action (was set null) |
| `mobile_sessions.deviceId` | `employee_devices` | No action (was set null) |
| `integration_logs.integrationId` | `integrations` | No action (was set null) |
| `api_logs.apiKeyId` | `api_keys` | No action (was set null) |
| `login_history.userId` | `users` | No action (was set null) |
| `expense_claims.payrollRunId` | `payroll_runs` | No action (was set null) |
| `goals.cycleId` | `review_cycles` | No action (was set null) |

`employee_devices` and `api_keys` gained `(id, companyId)` unique keys. PostgreSQL cannot set only the ID column to null through a composite key while `companyId` is required, so these optional references now block deletion of a still-referenced parent. The application already nulls expense claims before deleting a draft payroll run and deletes mobile sessions before removing a device. It has no delete path for locations, integrations, API keys, review cycles or users; company deletion still cascades. Test cleanups that delete users now delete login history first. Existing rows were validated by the constraints; the development database migrated without errors.

Bare ID columns without a database relation remain, and service-layer tenant filtering still protects them:

- Polymorphic or external identifiers, not foreign keys by design: `audit_logs.recordId`, `leave_ledger.refId`, `integration_logs.requestId` and the client/hardware `deviceId` strings on punches, geofence, face and field-tracking records.
- Actor/author user references in logs and messages: audit actor, auth challenge, security event, support/helpdesk/feedback authors, candidate event actor, helpdesk assignee.
The remaining tenant record references were resolved in the third batch below.

Verification: 26 migrations applied, Prisma generation, typecheck, lint (138 files), 50 unit tests, 91 integration tests (new cross-tenant login-history/goal/geofence database test) and the production build passed.

## Tenant reference keys (third batch)

`prisma/migrations/20260929030000_tenant_reference_keys` adds composite `(id, companyId)` foreign keys, all with delete behavior "no action", for every remaining tenant record reference:

| Area | Table.column | References |
| --- | --- | --- |
| Attendance | `attendanceId` on `face_verification_logs`, `attendance_regularizations`, `geofence_events`, `attendance_punches`, `comp_off_requests` | `attendance` |
| Payroll | `payroll_run_items.payslipId` | `payslips` |
| Recruitment | `job_openings.departmentId`, `job_openings.hiringManagerId`, `candidates.hiredEmployeeId`, `interviews.interviewerId` | departments, employees, employees, users |
| Performance | `performance_reviews.reviewerEmployeeId` | `employees` |
| Onboarding | `onboarding.candidateId`, `employeeId`, `departmentId`, `designationId`; `onboarding_tasks.documentId` | candidates, employees, departments, designations, documents |
| Announcements | `announcements.departmentId`, `branchId` | departments, branches |

`attendance` and `payslips` gained `(id, companyId)` unique keys. The migration is additive; each constraint validated existing rows (none were inconsistent in the development database).

Deletion policy and application changes:

- Attendance, payslips, employees, users and candidates have no application delete path, so the new keys block only manual deletion of records that other records still reference. Attendance evidence (punches, geofence and face logs, requests) is never removed implicitly.
- Deleting a department, designation or branch returns `409` naming the job openings, onboarding records or announcements that still use it, in addition to the existing employee check.
- Deleting a document reopens any onboarding task that used it: the task returns to `PENDING` with its document and completion cleared. Previously the task kept a dangling ID and the next upload for it failed.
- Starting onboarding now returns `404` for a department or designation outside the company. Previously it stored the ID and failed only when onboarding completed.
- PostgreSQL checks a "no action" key during a bulk delete before cascades from the same statement finish. Deleting several employees together, where one reviews another, therefore needs reviewers cleared first. Test cleanups now unlink attendance evidence, payslips, onboarding, hiring-manager and reviewer references before deleting their targets (`tests/integration/cleanup.ts`, `helpers.ts`). The application never deletes companies or employees.

Verification: 27 migrations applied, Prisma generation, typecheck, lint (139 files), 50 unit tests, 94 integration tests (new database and HTTP tests for cross-tenant attendance/announcement/onboarding references, blocked organization deletion, and task reopening) and the production build passed. HTTP smoke passed against a temporary production server on localhost:3002, which was stopped afterward. Twenty test companies left by interrupted test runs during this work were removed from the development database; the `DEMO` company was not changed.

## Row-level security

PostgreSQL row-level security is enabled in `prisma/migrations/20260930010000_row_level_security`. It is enforced for tenant requests when the runtime roles below are configured.

**Policies.** All 79 tables with a `companyId` column have a `tenant_isolation` policy: rows are visible, and may be written, only when `companyId` equals the transaction's `app.company_id` setting. `companies` exposes only the current company. `sessions`, `role_permissions` and `ai_messages` have no `companyId`; their policies require a visible parent user, role or conversation. If `app.company_id` is unset, nothing matches. Global platform tables (`permissions`, `subscription_plans`, `setup_state`, `backup_logs`, `rate_limits`, `system_health_logs`) have no policy; the application role can only read the first four.

**Roles.** `npm run db:roles` connects as the migration owner in `DATABASE_URL` and creates or updates two login roles from `APP_DATABASE_URL` and `SYSTEM_DATABASE_URL`:

| Role | Row-level security | Used for |
| --- | --- | --- |
| `DATABASE_URL` owner | Not applied (table owner) | Migrations, seeding, backup/restore tools |
| `hrms_app` (`APP_DATABASE_URL`) | Enforced (`NOBYPASSRLS`) | Every authenticated tenant request |
| `hrms_system` (`SYSTEM_DATABASE_URL`) | Bypassed (`BYPASSRLS`) | Sign-in and other pre-authentication lookups, platform administration, background jobs |

Neither runtime role is a superuser or can create databases or roles. Both get table DML only, including tables created by later migrations (default privileges), and no access to `_prisma_migrations`. Run `db:roles` again after changing either password. Creating a `BYPASSRLS` role requires a superuser, or on PostgreSQL 16+ a role that already has `BYPASSRLS`; on managed PostgreSQL, create the system role through the provider if needed.

**Tenant context.** `src/lib/db.ts` exports a scoped `db`. `withTenant(companyId, fn)` routes queries to the application role. It sets `app.company_id` with `set_config(..., true)` in the same transaction as each query, array transaction or interactive transaction, so pooled connections never carry a tenant over. `withSystem(fn)` routes queries to the system role. A query outside either scope throws instead of running.

- The API router runs unauthenticated routes and `authenticate()` in system scope. Everything after authentication runs in the signed-in company's tenant scope.
- The public API resolves its key in system scope, then runs in the key's company. The onboarding portal resolves its link, then runs in the joiner's company.
- Platform routes (after the Super Admin/SaaS staff check), Super Admin company listing/provisioning and Super Admin support attachment downloads use system scope, because they span companies.
- Webhook delivery, AI retention and backups use `jobScope()`: they keep an active tenant scope, otherwise they run as system.
- Scripts and test fixtures use `systemDb`. Tests call route handlers, which use the scoped client.

Each non-transactional query becomes a short transaction (set tenant, run query). This adds a database round trip per query in tenant scope.

**Configuration.** `APP_DATABASE_URL` and `SYSTEM_DATABASE_URL` are required when `NODE_ENV=production`; the server refuses database access without them. In development and tests, if they are missing, the application falls back to `DATABASE_URL` and logs that row-level security is not enforced. `npm run env:init` generates both URLs for new installations, and `scripts/start-database.ps1` points them at the isolated local cluster. This development installation has both roles configured.

**Adding tables.** A new table with `companyId` must include `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation` policy in its migration. `tests/integration/rls.test.ts` fails if any such table lacks one. New cross-company operations must use `withSystem` explicitly, after their own authorization check.

**Backups.** Restores skip grants (`--no-privileges`), so a target cluster does not need the roles in advance; run `npm run db:roles` after restoring. The restore check creates and drops its temporary database with the owner connection.

**Verification.** 28 migrations applied; `db:roles` configured `hrms_app` and `hrms_system`. Type checking, lint (141 files), 50 unit tests and 99 integration tests passed. The new `rls.test.ts` checks:

- every company-owned table has a policy;
- the tenant and system roles have the intended attributes;
- in tenant scope, another company's rows are hidden by ID lookup and cannot be updated or inserted, even without application filters;
- array and interactive transactions carry the tenant;
- an unknown tenant sees no rows, and unscoped access is refused;
- API requests are confined to the signed-in company.

The production build passed. HTTP smoke passed against a temporary production server on localhost:3002, using the restricted roles; the server was stopped afterward. Webhook delivery and AI retention scripts ran. A daily backup with restore test succeeded and loaded 90 tables. That run wrote one encrypted backup file to `data/backups`.

**Limits.**
- The system role bypasses row-level security, so pre-authentication, platform and job code still relies on application filters. Keep those paths small and reviewed.
- Any code with access to the system role's credentials can bypass the policies. Store `SYSTEM_DATABASE_URL` as carefully as `DATABASE_URL`.
- The policies do not replace application authorization within a company (roles and permissions).
- Load impact of the extra per-query transaction has not been measured.

## Remaining scope

Every tenant record reference now has a composite database key. Polymorphic IDs and log actor/author IDs remain intentionally unconstrained, as listed in the second batch. Later-phase work—including configurable statutory rules, billing, training/assets, native mobile clients, queues and deployment—is still pending.
