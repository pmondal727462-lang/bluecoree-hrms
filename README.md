# BlueCoreeHR

A Next.js / React / TypeScript HRMS with PostgreSQL and Prisma. Authentication, companies, configurable roles, employees, core HR, documents, onboarding, attendance, leave, payroll, recruitment, performance, expenses, reports and subscription administration have implementations. Training, assets, native mobile clients and commercial billing remain unfinished. See the [implementation audit](docs/implementation-audit.md) for the master 18-phase status and [foundation fixes](docs/foundation-hardening.md) for the latest changes. Older documents use an earlier phase numbering scheme.

Attendance operating rules are in [docs/phase2.md](docs/phase2.md), other HR modules in [docs/hr-modules.md](docs/hr-modules.md), security checks in [docs/security-testing.md](docs/security-testing.md), and backup procedures in [docs/backup-recovery.md](docs/backup-recovery.md). Implemented code is not a claim of production certification.

## Open the installed application

The local development application runs at **http://localhost:3000**. Use `localhost`, matching `APP_URL`, rather than `127.0.0.1` when signing in.

- Company code: `DEMO`
- Administrator email: `super.admin@demo.example`
- The generated password and all 11 demo accounts are in **[data/demo-credentials.txt](data/demo-credentials.txt)**. This file is excluded from version control.
- The separate project PostgreSQL cluster uses port **55432**, in `data/postgres`. The pre-existing PostgreSQL service on port 5432 was not changed.

To start again on this Windows computer:

```powershell
cd D:\Pintu\projects
powershell -ExecutionPolicy Bypass -File scripts/start-database.ps1
npm run dev
```

Use the Companies screen as Super Admin to create your real company and its Company Admin account. Then sign in with the new company code. Company Admin can update company details and working days, configure departments/designations/branches, add users, assign roles, and link accounts to employee records. Employees sign in to their own profile.

## Fresh installation

Requires Node.js 22.12+ (tested with Node 24) and PostgreSQL. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run env:init
# Set DATABASE_URL in .env to an existing, empty PostgreSQL database, and the
# same host/database in APP_DATABASE_URL and SYSTEM_DATABASE_URL.
npm run db:generate
npm run db:migrate
npm run db:roles   # restricted tenant role + system role for row-level security
npm run dev
```

Open `/setup` and enter the local `SETUP_TOKEN` from `.env`, company details and a new Super Admin password. Setup is atomic and closes after the first account is created. Instead, for demonstration data only, run `npm run db:seed` before opening the app. Seeding is idempotent and refuses production mode; it does not overwrite an existing company or password. Seeding after initial setup does not grant a new platform Super Admin.

On this Windows machine, `scripts/start-database.ps1` can initialize a separate database using installed PostgreSQL 18 binaries. It generates a password and updates the untouched example DATABASE_URL. It refuses to replace a manually configured connection string. This local cluster is a development convenience, not a production database configuration.

## Implemented workflows

| Area | Working functionality |
| --- | --- |
| Authentication | Company code + email or mobile/password; bcrypt; 15-minute JWT access cookies; rotating 7-day refresh sessions; logout/revocation; password changes |
| Account security | Authenticator TOTP setup/enable/disable with replay protection; email OTP and reset links with one-use hashed challenges, when SMTP is configured |
| Company | First-launch setup; company identity, registration fields, time zone, working days; separate companies and administrators |
| RBAC | All 13 default role names; editable non-admin roles; custom roles; live permission checks; protected administrator roles; no grants beyond actor permissions |
| Users | Add/search/page/edit/disable accounts, role assignment, session invalidation on updates; own session list and revocation |
| Employees | Create/view/edit/archive; contact, employment, address and emergency data; reporting relationships; account linkage; department/branch/status filters; paginated search |
| Sensitive fields | PAN, Aadhaar reference, UAN, PF/ESI and bank details encrypted using AES-256-GCM; excluded unless the actor has `employees.sensitive`; never returned in own-profile responses |
| Organization | Create/rename/delete departments, designations and branches; deletion blocked while employees reference a record |
| Self-service | Employee profile, employment summary, permitted contact/address/emergency updates; account security |
| Admin dashboard | Actual headcounts, current employment statuses, new joiners, cumulative recorded joining history, department distribution, recent employees and activity |
| Interface | Responsive navigation and forms, light/dark themes, accessible Radix dialogs, toasts, confirmation dialogs and current-page CSV export with formula-injection escaping |
| Platform | Zod validation, standard API errors, Pino request logging, database-backed rate limits, CSRF origin checks, audit trail and security headers |

Attendance and leave are available in the Attendance and Leave & holidays menus. Configure shifts, holidays and leave allowances in Time settings. Payroll and payslips are implemented, but effective-dated statutory configuration and independent payroll validation remain pending.

## Architecture and key files

```text
src/app/                   Next.js pages and REST route adapter
src/components/            Workspace, dashboards and forms
src/components/ui/         Shadcn-style Button / Radix Dialog primitives
src/modules/auth/          Authentication, sessions, OTP, reset, TOTP
src/modules/employees/     Tenant-scoped employee operations and self-service
src/modules/organization/  Company and organizational structure services
src/modules/users/         User and role management
src/modules/dashboard/     Company-scoped aggregations
src/modules/shared/        Zod input schemas
src/config/                Permission catalogue and OpenAPI definition
src/integrations/          SMTP delivery adapter
src/lib/                   Prisma, encryption, errors, logging, HTTP client
prisma/                    Models, versioned migrations and demo seed
tests/                     Unit and real-PostgreSQL API/security tests
scripts/                   Environment, database startup and HTTP smoke check
```

REST routes validate the request origin, authenticate the JWT against its live session, load current role grants, validate input, then call a module service. Services scope reads and writes by the authenticated `companyId`; clients cannot supply a tenant ID. PostgreSQL row-level security enforces the same boundary in the database: authenticated requests run as a restricted role with the company set per transaction. Composite foreign keys prevent employee relationships from pointing into a different company. Record changes and audit entries commit together. Super Admin cross-company listing/provisioning is explicit; even Super Admin employee queries remain scoped to the signed-in company.

Database tables: `companies`, `users`, `roles`, `permissions`, `role_permissions`, `departments`, `designations`, `branches`, `employees`, `sessions`, `auth_challenges`, `audit_logs`, `rate_limits`, and `setup_state`. Employee addresses/emergency contacts are JSON in Phase 1; later modules can normalize them through additive migrations.

The initial unlaunched SQLite prototype was replaced when the Phase 1 stack was specified; no existing application data was migrated or removed. The original `package.json` was replaced with the application scripts and dependencies; `.gitignore` was extended. All other application files and migrations were created for Phase 1.

## API documentation

Open **http://localhost:3000/api/docs** for the OpenAPI 3.0 document. Import it into an OpenAPI-compatible client. Mutation requests must include `Origin` equal to the origin in `APP_URL`; browsers supply this automatically. Both auth cookies are HttpOnly and SameSite=Strict, and Secure in production.

Examples: `/api/auth/login`, `/api/auth/refresh`, `/api/auth/me`, `/api/company`, `/api/companies`, `/api/users`, `/api/roles`, `/api/employees`, `/api/employees/:id`, `/api/profile`, `/api/departments`, `/api/designations`, `/api/branches`, `/api/dashboard`, `/api/audit`.

## Email and secrets

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` to enable email OTP and password reset. Port 465 uses TLS; other ports require STARTTLS. No email credentials were provided, so real email delivery is not yet enabled or verified. Provider-independent recovery logic is integration-tested with a mock delivery adapter. SMS OTP is not implemented; mobile numbers are supported as password-login identifiers. No messages are sent by the seed or tests.

`npm run env:init` generates independent random JWT secrets, an AES encryption key and a setup token. It never overwrites `.env`. Keep `ENCRYPTION_KEY` stable and backed up securely; changing it without re-encryption makes existing encrypted fields unreadable. Do not commit `.env`, database files or demo credentials. SMTP secrets are server environment values, never sent to a browser or stored in a company record.

## Verification

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
# With npm run dev already running, and demo data present:
npx tsx scripts/smoke.ts
```

Run build and database tests sequentially on Windows: Prisma regenerates its native engine during build, and a concurrently running process can lock that DLL. Stop the dev server before regenerating Prisma after schema changes.

Unit tests cover permission defaults, encryption/tamper detection, JWT separation, input injection, dates/passwords, and RFC 6238 TOTP vectors/replay. Integration tests create uniquely named temporary companies in the configured database, exercise real route handlers, and remove only their fixtures afterward. Use a dedicated test database in CI. Tests cover authentication, tenant isolation, employee CRUD, RBAC, sensitive-field masking, self-service restrictions, reporting cycles, role/user changes, refresh/logout, 2FA, email OTP/reset and rate limiting. The HTTP smoke check uses the running Next.js server and never prints credentials.

Build, unit/integration tests and HTTP smoke were executed locally. Browser visual/layout validation remains outstanding because this session had no connected browser. Phase 2 has its own unit and real-database integration coverage. This is not a certification that all seven phases or production operations are complete.

## Production preparation

- Provision a managed PostgreSQL database with a least-privileged runtime role, TLS connections, connection pooling and backups. Do not deploy the local development superuser/cluster or demo accounts.
- Tenant data is protected by PostgreSQL row-level security. Provide `DATABASE_URL` (migration owner), `APP_DATABASE_URL` (restricted tenant role) and `SYSTEM_DATABASE_URL` (RLS-bypassing system role). In production the server refuses database access without the last two. Run `npm run db:roles` after migrating; see [row-level security](docs/foundation-hardening.md#row-level-security).
- Set `APP_URL` to the exact HTTPS deployment URL and provide fresh secrets through the hosting secret manager. Use `npm run db:migrate` and `npm run db:roles`, then `npm run build` and `npm start`. Terminate HTTPS at the hosting platform/reverse proxy. Vercel can host both Next.js UI and routes; configure a pooled database URL suitable for its connection model.
- `TRUST_PROXY=true` is appropriate only behind an ingress that overwrites forwarded client-IP headers. Otherwise leave it false; unauthenticated IP limits share a local bucket, while account/challenge limits are still enforced independently.
- Schedule encrypted daily database backups and weekly full backups, with off-site retention and tested restores; retain the encryption key separately. Scheduling/backup-status UI belongs to later operational phases and is not configured here.
- Test actual SMTP delivery, browser/mobile layouts, accessibility, load and deployment infrastructure before using real employee records. TOTP recovery codes are supported; verify recovery procedures in the deployed environment.
- Employee/account/organization selectors in the directory now search and paginate on the server. Organization management also paginates. Legacy module pickers, documents and full-dataset exports still require scalability follow-up.
- Company logos and private document storage are implemented. Payroll currently includes hard-coded statutory rules; do not treat it as the requested effective-dated statutory engine.

## Phase boundary

Use the current master sequence in the [implementation audit](docs/implementation-audit.md), rather than the older phase labels elsewhere in this repository. External biometric device integration has been removed. Face attendance and general HR attendance CSV imports remain available; historical device records are retained.

Reference documentation used: [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [Prisma 6 data sources](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources).
