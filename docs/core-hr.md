# Phase 2 — Core HR requirement check

Checked on 27 September 2026 against the [master specification](master-specification.md): Phase 2 (§81: employee lifecycle, ESS, documents, departments, designations, branches) and its detail sections §9–11, §33–34, plus the scale rules in §83–84.

## Requirement status

| Spec | Requirement | Status | Where |
| --- | --- | --- | --- |
| §9 | Personal: employee ID, name, DOB, gender, blood group, marital status, personal/official email, mobile, emergency contact | Implemented | `employees` model, employee form |
| §9 | Photo | **Added in this change** | `src/modules/employees/photo.ts`, `employee-photo.tsx` |
| §9 | Employment: joining/confirmation date, department, designation, manager, branch, location, type, status, probation, notice | Implemented (location = assigned attendance locations) | `employees`, `employee_attendance_locations` |
| §9 | Compliance: PAN, Aadhaar reference, UAN, PF, ESI, bank account, IFSC | Implemented, AES-256-GCM encrypted, shown only with `employees.sensitive` | `sensitiveEncrypted` |
| §10 | Joining, confirmation, promotion, transfer, department/designation change, resignation, termination, exit, rehire | Implemented with history entries | `src/modules/employees/lifecycle.ts` |
| §10 | Salary revision | Implemented from payroll salary structures | `src/modules/payroll/runs.ts` |
| §10 | Full & final settlement | Implemented (draft, approval, payment) | `exit_settlements` |
| §10 | Recruitment, offer, onboarding stages | Implemented in recruitment/onboarding; hire and onboarding completion write employee history | Phase 8 modules |
| §11 | ESS dashboard: attendance, check-in/out, hours, leave balance, holidays, payslips, documents, expenses, announcements, performance, HR requests | Implemented | `src/modules/dashboard/home.ts` |
| §11 | ESS dashboard: training | **Added in Phase 10:** upcoming sessions, completed courses and expiring certificates ([training](training.md)) | `home.ts`, `home.tsx` |
| §11 | Update permitted details, upload documents, apply leave, check attendance, download payslips, submit expenses, raise tickets, view policies | Implemented | profile, documents, time, payroll, expenses, helpdesk |
| §33 | Categories: employee, contracts, offer letters, policies, salary, compliance | Implemented | `documentCategories` |
| §33 | Upload, download, preview, versioning, expiry, access control, approval, private storage | Implemented | `src/modules/documents/service.ts`, `src/lib/storage.ts` |
| §34 | Categories: attendance, payroll, leave, document, HR, IT | Implemented | `helpdeskCategories` |
| §34 | Statuses: Open, Assigned, In Progress, Resolved, Closed | Implemented | `src/modules/helpdesk/service.ts` |
| §81 | Departments, designations, branches | Implemented: CRUD, server pagination/search, blocked deletion while referenced | `src/modules/organization/service.ts` |
| §84 | Paginated documents list | **Fixed in this change** (was capped at 500) | documents API + UI |
| §84 | Paginated HR ticket list | **Fixed in this change** (was capped at 200) | helpdesk API + UI |
| §84 | Document upload employee picker | **Fixed in this change** (loaded only the first 100 employees) | searchable reference picker |
| §62 | Separate `employee_addresses`, `employee_bank_accounts`, `employee_emergency_contacts` tables | **Added** — tenant-scoped with RLS; existing data migrated | `src/modules/employees/contacts.ts` |
| §9 | Several emergency contacts; bank account history | **Added** (up to five contacts, one primary; account changes kept as history) | employee dialog, My profile |
| §79 | Export of permitted data as CSV, Excel, PDF, JSON | **Added** — full filtered directory export (all pages) and PDF for saved reports; audited | `src/lib/export.ts`, `/api/employees/export` |

## Changes in this pass

- **Employee photo.** `GET/PUT/DELETE /api/employees/:id/photo` (HR: `employees.read`/`employees.write`) and `/api/profile/photo` (the employee: `profile.read`/`profile.write`).
  - PNG or JPEG only, 1 MB maximum, content-checked by the upload validator.
  - Stored privately and served through a five-minute signed link. Employee responses expose only `hasPhoto`.
  - Uploads count towards the plan storage limit and are audited (`PHOTO_UPDATE`/`PHOTO_DELETE`).
  - A replaced or removed photo file is deleted.
  - The photo appears on "My profile" and in the employee detail dialog.
- **Content Security Policy.** When `STORAGE_ENDPOINT` is set at build time, its origin is allowed as an image source, so signed S3/R2 photo links display.
- **Documents and HR tickets.** Adding `page` to the list request returns `{ items, total, page, pageSize }`, with search by title/subject, employee name or code. The UI uses 20 rows per page with a search box. Requests without `page` keep the previous capped list for older clients.
- **Upload form.** The document upload form's employee field uses the searchable, paginated employee picker.
- **Migration.** `20260930020000_employee_photo` adds `photoKey`, `photoType` and `photoSize` to `employees`.
- **Tests.** `tests/integration/core-hr.test.ts` covers:
  - photo permissions: own, peer, HR and another company;
  - the file-type check, storage-key hiding and audit entries;
  - document and ticket pagination, search and tenant scoping.

## Address, contact and bank tables (§62)

- **Addresses:** `employee_addresses` holds one CURRENT and one PERMANENT row per employee.
- **Emergency contacts:** `employee_emergency_contacts` holds up to five contacts, one of them primary.
- **Bank accounts:** `employee_bank_accounts` holds salary accounts with history.
  - The account number is AES-256-GCM encrypted; only the last four digits are stored in plain text.
  - A changed account becomes the new primary, and the previous one is deactivated rather than deleted.
- All three tables have composite `(employeeId, companyId)` foreign keys and row-level security policies, and are removed with their employee.

**Compatibility.** Employee and profile responses keep `address` and `emergencyContact` in the previous shape, built from the new tables, and add `emergencyContacts`. With `employees.sensitive`, `sensitive.bankAccount`/`ifsc` come from the primary account. Writing these fields through the employee form or profile updates the tables. Bank details are no longer stored in the encrypted identity field.

**New endpoints:**
- `/api/employees/:id/emergency-contacts[/:contactId]` and `/api/profile/emergency-contacts[/:contactId]`.
- `/api/employees/:id/bank-accounts`: GET needs `employees.sensitive`; POST also needs `employees.write`.
- Employees cannot change their own bank account.
- All changes are audited. The endpoints are listed in `/api/docs`.

**Migration.**
- `20260930030000_employee_contact_tables` creates the tables, copies the old JSON values and then drops the `address` and `emergencyContact` columns, all in one transaction. The copy was verified in a rolled-back trial against sample values.
- `20260930040000_bank_ifsc_optional` allows an account without an IFSC, as the employee form previously did.
- Bank details are encrypted, so SQL cannot move them. Run `npm run db:backfill-bank` once after migrating:
  - it moves them from the identity field into the table and can be re-run;
  - an IFSC without an account number is left in place and reported.
- On this installation no employees had address, contact or bank data, so nothing needed moving.

## Export (§79)

`src/lib/export.ts` renders a table as CSV (UTF-8 with BOM, formula-injection escaped), Excel (text cells, never formulas), PDF (A4 landscape, paginated) or JSON.

- **Employee directory.** `GET /api/employees/export?format=csv|xlsx|pdf|json` applies the directory's search and filters across all pages, up to 50,000 rows, flagged when cut off.
  - Requires `employees.read`.
  - Never includes identity or bank fields.
  - Audited as `EXPORT`.
- **Saved reports.** Reports also offer PDF, and their downloads now include every scanned row (up to 20,000) instead of the 5,000-row screen preview. Report downloads are audited.
- **PDF limitation.** The built-in PDF font covers Latin text only, so other scripts (for example Devanagari names) print as "?" in PDF. CSV and Excel keep them.

## Configuration fixes found during this pass

- **`npm run env:init`** now generates `APP_DATABASE_URL` and `SYSTEM_DATABASE_URL`. An earlier edit had not applied.
- **Storage variables:** `env:init` and `.env.example` now use `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY`, the names the storage code and §65 use. Previously they wrote `S3_*` names that were ignored, so S3 settings made from the template never took effect. The empty `S3_*` entries in the local `.env` were renamed.

## Verification status

- All 31 migrations applied.
- Type checking, lint (150 files), 54 unit tests (including the exporter) and 106 integration tests passed.
- The integration tests include `core-hr.test.ts`: photos, paged documents and tickets, directory export, contact tables, bank history and the bank backfill.
- The production build passed, and HTTP smoke passed against a temporary production server, which was stopped afterwards.
