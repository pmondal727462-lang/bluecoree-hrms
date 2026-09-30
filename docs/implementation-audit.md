# BlueCoreeHR implementation audit

Review date: 26 September 2026. Scope: existing source, Prisma schema and migrations, API routing, authentication/RBAC, UI modules, and automated checks against the supplied 18-phase [master specification](master-specification.md).

**Later scope change:** external biometric device integration has been removed at the product owner's request. Phase 4 entries below describe the historical implementation. Device data is retained; AI face attendance remains supported.

The application has substantial implementation beyond Phase 1, but the complete commercial product is **not finished or production-verified**. Existing documentation uses an older phase numbering scheme; the table below uses the master specification. A module's presence does not establish completion of every requested workflow.

## Status on 27 September 2026 (all phases)

All 18 phases in the master specification now have an implementation, a requirement check and automated tests. There is a document for each phase, linked from the table below. Checks run on 27 September 2026:
- 42 migrations applied;
- lint on 224 files and type checks pass;
- unit tests: 71 across 14 files pass;
- integration tests: 183 across 26 files pass;
- the production build succeeds.

The priority findings further down are the original baseline. The tenant foreign keys, RLS, subscription gating, the camera policy, the statutory rule engine, billing and the job worker are resolved, as the phase rows show. The remaining **Money precision** finding (Float amounts in payroll and expenses) is still open.

**Not verified here, because it needs external systems:**
- biometric terminals;
- a production face-recognition provider with certified liveness;
- live Razorpay, SMTP, SMS, WhatsApp, FCM and Expo accounts;
- a real AI model provider;
- DNS and TLS for customer domains;
- native Android and iOS builds of the `mobile/` app;
- Docker, Compose and GitHub Actions runs;
- load testing at 5,000+ employees;
- an independent VAPT;
- a witnessed disaster-recovery drill;
- independent validation of statutory payroll calculations.

## Remediation update

The [foundation remediation](foundation-hardening.md) fixes the three identified document relationship constraints, missing-subscription access, malformed trial expiry, mobile module entitlement checks, face entitlement checks, camera policy, directory reference pagination and default product branding. It also corrects selected stale documentation/Copilot messages. Verification passed: 25 migrations applied, type checking, lint, 50 unit tests, 90 integration tests, production build and HTTP smoke. The findings below preserve the original audit baseline; items outside that remediation remain open. Two further batches replaced eight single-column tenant foreign keys with composite keys and added composite keys for every remaining tenant record reference (27 migrations, 94 integration tests passing). Only polymorphic and log actor/author IDs remain intentionally unconstrained. PostgreSQL row-level security is now enabled on all company-owned tables, enforced through a restricted runtime role with transaction-scoped tenant context; a separate system role serves sign-in, platform administration and jobs (28 migrations, 99 integration tests passing; see [Row-level security](foundation-hardening.md#row-level-security)). No later phase is marked complete.

## Verification

- TypeScript: passed (`npm run typecheck`).
- Lint: passed, 133 files (`npm run lint`).
- Unit tests: 50 passed across 9 files (`npm test`).
- Database: 24 migrations; Prisma reports the configured database is up to date. No new migration was needed or created.
- Integration tests: 84 passed across 7 files (`npm run test:integration`), including covered employee, attendance, leave, payroll, document, report, API and AI authorization/isolation scenarios.
- Production build: passed (`npm run build`), including Prisma client generation and Next.js compilation/type checking/static generation.
- Non-blocking tooling warnings: deprecated `package.json#prisma` configuration and Vitest/Vite configuration module-format warning.
- This review does not establish live vendor connectivity, statutory correctness, browser/device compatibility, load capacity, or VAPT certification.

## Priority findings

| Priority | Finding and evidence | Required follow-up |
| --- | --- | --- |
| High | Database tenant protection is incomplete. `Document.employee` and `Document.onboarding` reference IDs without company IDs in `prisma/schema.prisma`; the core-HR migration confirms single-column foreign keys. `DocumentAcknowledgement.employeeId` has no employee relation. Document API creation validates employee tenancy, but the database cannot enforce these boundaries itself. | Audit every tenant-owned relationship; introduce composite tenant foreign keys with data validation before migration. Add direct-database negative tests. |
| High | No PostgreSQL RLS policies or tenant-aware database context were found in migrations or `src/lib/db.ts`. | Evaluate RLS with a least-privileged runtime role and transaction-scoped tenant context. Do not treat ordinary application filtering as database RLS. |
| High | `next.config.ts` sends `Permissions-Policy: camera=()` for all pages, while `src/components/face-capture.tsx` calls `getUserMedia`. This policy blocks browser camera access. | Allow same-origin camera use where required and verify enrollment/check-in in a browser with the production headers. |
| High | `src/modules/payroll/statutory.ts` embeds tax slabs, rebates, cess and statutory defaults. Some PF/ESI/PT settings are configurable, but the requested effective-dated country/state rule engine is absent. Payroll, expenses and settlements use Prisma `Float` amounts. | Build versioned statutory rules and defined monetary precision/rounding before commercial payroll use. Verify rules independently; this audit did not validate current legal rates. |
| High | `requireFeature()` in `src/modules/saas/service.ts` returns successfully when a subscription is missing. Provisioning can also return without a subscription when the trial plan is absent. Feature coverage is narrower than the requested catalogue; face routes have no dedicated face entitlement. | Define explicit subscriptionless-company behavior, close unintended entitlement bypasses, and test every module/add-on/limit across web, API and mobile routes. |
| High | Billing is absent: no invoice/payment/add-on models or complete checkout/reconciliation workflow. Current plans expose a monthly price but not the requested annual/per-employee/minimum-charge pricing model. | Implement the Phase 15 billing and entitlement lifecycle, including verified provider events, refunds, tax invoices and add-ons. |
| Resolved (Phase 18) | Redis/BullMQ packages were installed but unused. A BullMQ worker now runs the scheduled jobs; notification email is still sent inline with failures caught. | Introduce durable jobs, retries, deduplication, scheduling, worker monitoring and operational deployment. |
| Medium | Employee/account pickers request only the first 100 records (`src/components/directory.tsx`); organization lists cap at 500. Documents cap at 500 without pagination. | Add searchable paginated reference selectors and full pagination; benchmark at 5,000+ employees. |
| Medium | OpenAPI primarily covers the older foundation/time API; its description still says payroll and recruitment belong to later phases. `/api/docs` returns JSON, without a Swagger UI. | Document all existing public endpoints, permissions, errors and authentication schemes, and provide the requested interactive documentation. |
| Medium | README says documents/onboarding are absent and describes only 11 roles; source now contains these modules and 13 default roles. AI's unavailable response still says onboarding/documents are unimplemented (`src/modules/ai/queries.ts`). | Reconcile README, API documentation, AI capabilities and the master phase numbering with actual source. |
| Medium | Default product metadata remains “People” (`src/app/layout.tsx`) rather than BlueCoree; tenant branding exists separately. | Centralize configurable product identity and apply it consistently to default UI, metadata and generated artifacts. |

The tenant-constraint findings are missing defense-in-depth controls, not a demonstrated cross-tenant HTTP data leak. Passing isolation tests for covered routes does not prove all database relationships or all endpoints are safe.

## Phase-by-phase status

| Master phase | Present in repository | Pending or not verified |
| --- | --- | --- |
| 1 — Foundation | Next.js/TypeScript/PostgreSQL/Prisma; authentication, session rotation, RBAC with 13 role names; tenant-scoped employee/company services; Super Admin and `/admin`; company settings; existing automated checks and production build pass | Remediated: tenant composite keys, row-level security, reference pagination and product branding. Independent security review and load testing of the per-query tenant transaction remain |
| 2 — Core HR | Lifecycle/history/settlement, ESS, organization, document versioning/private storage/acknowledgements, helpdesk, employee photo, address/contact/bank tables, full data export, paginated documents/tickets ([requirement check](core-hr.md)) | Complete and verified; the ESS training card was added in Phase 10 |
| 3 — Attendance | Web/mobile APIs, GPS/geofence, locations, configurable fixed/flexible/split/night shifts, rosters, rule engine (late, early exit, half day, off-day work, overtime with approval), punch log with source/IP/device ([requirement check](attendance.md)) | Device connectors and attendance write API (Phases 4/14); multiple sessions per day; real device/browser and scale testing |
| 4 — Biometric | Device registry and status; ZKTeco/eSSL ADMS push, Hikvision event push, Suprema BioStar 2 pull, generic JSON push; enrolment mapping; raw punch log with de-duplication; manual and scheduled sync; sync logs; retry; plan device limit ([details](biometric.md)) | Verification on real terminals; direct LAN SDK access; pushing enrolments to devices; queue workers (Phase 18) |
| 5 — Face attendance | Automatic on-device detection, provider verification with liveness, encrypted templates, replay rejection, failed-scan lockout, fallback policy, HR enrolment/log view and reset ([details](face-attendance.md)) | A production face provider with certified liveness/anti-spoofing; device testing |
| 6 — Leave | Standard types, monthly/annual accrual, carry-forward, encashment, half days, optional holidays, two-level approval, comp-off credits, bulk adjustments, full balance engine ([details](leave.md)) | Scheduled year-end job (Phase 18); encashment is paid through payroll (Phase 7) |
| 7 — Payroll | Effective-dated platform/company statutory rules (PF, ESI, PT by state, income tax by regime); conveyance, bonus, incentive, overtime and encashment pay; payable days from attendance (option); loans and advances; draft → submitted → approved (different person) → processed with month lock on attendance and leave; server-generated payslip PDF; statutory files ([details](payroll.md)) | Custom formula components, decimal money storage, arrears, and independent validation against a certified payroll engine |
| 8 — Recruitment | Jobs; public careers page with consented PDF applications; candidate database with search; applied → screening → shortlisted → interview → selected → offer → joined; interviews and feedback; offers with letter PDF, private accept/decline link, withdrawal and expiry; hiring gated on acceptance; onboarding checklist and portal ([details](recruitment.md)) | Custom application questions and a candidate status page; AI candidate summaries and communication drafts (Phase 12) |
| 9 — Performance | Goals, KPI, OKR with key-result roll-up; review cycles with configurable rating scale and labels; self, manager and peer reviews (unnamed to the employee); HR calibration of final ratings; feedback; history across cycles ([details](performance.md)) | AI review drafting and development plans (Phase 12); 360° reviews by upward/skip-level reviewers |
| 10 — Training | Courses, trainers, sessions with capacity and open enrolment, attendance, results, certificates (PDF) with expiry and reminders, skills register, mandatory-course compliance, ESS training card ([details](training.md)) | E-learning content hosting, course feedback, training budgets |
| 11 — Expense & asset | Standard expense categories; employee → manager → finance (different person) → approved → paid; receipts. Asset register with ID, serial, cost, purchase, warranty; issue/return with condition, acknowledgement and history; exit clearance hold ([details](assets-expenses.md)) | Asset depreciation, bulk asset import, and multi-currency expense conversion |
| 12 — AI Copilot | Permission-scoped read-only intent catalogue, including expiring documents, onboarding, training, assets, all pending approvals and engine-based leave balances; drafts for JDs, interview questions and summaries, candidate summaries and messages, performance goals, review drafts and development plans, 11 HR letter types, and report summaries, with local name substitution and human approval ([details](ai-copilot.md)) | Acceptance testing with a real model provider |
| 13 — Mobile | Expo (React Native) app source covering every spec screen; full v1 API including home, approvals, payslip PDF, expenses, documents, notifications and helpdesk; push delivery through Expo and FCM HTTP v1 (reaching iOS via APNs) with dead-token cleanup ([details](mobile.md)) | App not yet installed, built or device-tested; real push provider credentials |
| 14 — Integrations | Public API with read and write scopes and an accounting journal endpoint; all spec webhooks including device attendance; accounting export (CSV, XLSX, JSON, API); SMS (Twilio or MSG91) and WhatsApp (Cloud API) as opt-in notification channels; full OpenAPI and a readable reference at /api-docs ([details](integrations.md)) | Vendor-specific ERP/accounting OAuth connectors; scheduled sync (Phase 18 worker); live provider verification |
| 15 — SaaS | Monthly and annual flat and per-employee pricing with minimum charge; add-ons and coupons; a central feature service; location limits; GST tax invoices; Razorpay payments with verified signatures and webhooks; offline payments; refunds; trial and renewal reminders; public signup with email verification and a setup checklist; marketing site ([details](billing.md)) | Live payment-provider and email verification; subscription dunning beyond the grace period |
| 16 — White label | Brand, colours and logo across portal, login and payslips (gated on entitlement); branded notification email; verified custom domains for links, origin checks, domain-bound sign-in and an on-demand TLS check ([details](white-label.md)) | Live DNS and TLS issuance on a public server |
| 17 — Security | MFA (TOTP, email OTP, recovery codes, role-enforced), lockout, sessions, audit and security logs, encrypted fields, RLS on every company table, encrypted verified backups, a DR plan, data retention with minimums, preview, confirmation and legal hold, and a cross-tenant sweep of new endpoints ([details](security.md)) | Independent penetration test; witnessed restore drill; scheduled backups and retention (Phase 18 worker) |
| 18 — Production | Dockerfile and Compose stack (PostgreSQL 18, Redis, app, worker, Caddy with on-demand TLS for white-label domains); GitHub Actions CI; background worker on BullMQ repeatable jobs, with an in-process fallback for 12 idempotent jobs; deployment, release, monitoring and alerting guide ([details](deployment.md)) | Container, CI and TLS stack not run here; load test at production scale; witnessed restore drill |

Public marketing pages (home, features, pricing, resources, contact, start trial) and the signup-to-subscription funnel were added in Phase 15.

## Recommended sequence

1. Run the stack as deployed: build the Docker image, run CI once, and bring up Compose with TLS on a staging domain.
2. Connect the real providers on staging: SMTP, Razorpay (test mode), face provider, AI provider, and FCM or Expo. Then test the flows end to end.
3. Build and device-test the `mobile/` app with EAS.
4. Have the payroll calculations independently validated, and decide on decimal money storage before commercial payroll use.
5. Load-test with production-sized data, then commission an independent VAPT and a restore drill.

## Reproduction and setup commands

For this existing installation, preserve `.env` and the configured database. Do not reseed to perform the audit.

```powershell
cd D:\Pintu\projects
# If the configured local PostgreSQL instance is stopped:
powershell -ExecutionPolicy Bypass -File scripts/start-database.ps1
node node_modules/prisma/build/index.js migrate status
npm run typecheck
npm run lint
npm test
$env:LOG_LEVEL='silent'
npm run test:integration
npm run build
```

Run database integration tests only against an appropriate test/development database: the existing suites create temporary tenant fixtures and remove them. Run build after database tests to avoid Prisma engine locks on Windows. Fresh setup commands remain in README, but its feature-status statements are outdated.

The initial review changed only this audit document. Subsequent implementation changes and setup commands are tracked in [foundation remediation](foundation-hardening.md).
