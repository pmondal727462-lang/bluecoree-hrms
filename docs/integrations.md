# Phase 14 — Integrations, public API, webhooks and accounting

Checked on 27 September 2026 against the [master specification](master-specification.md) §42–45.

| Requirement | Status |
| --- | --- |
| Public API `/api/v1/` for employees, attendance, leave, payroll and payslips; per-company API keys; usage tracking | Implemented for reading (hashed keys with scopes, expiry, revocation, rate limits, plan quota and a per-call log). **Added writes** with new scopes `employees.write`, `attendance.write` and `leave.write`: create or update employees, record attendance (work date and local times, through HR's manual-entry path) and approve or reject leave. Writes run through the same module code as the web app, with a context restricted to the key's scopes and audited as "API key: *name*". Tenant isolation is unchanged. |
| Webhooks: employee.created/updated, attendance.checked_in/checked_out, leave.created/approved/rejected, payroll.processed, payslip.generated, candidate.created/selected; retries | Implemented: signed, delivered after commit, retried, and blocked from private addresses. **Fixed:** face punches were always reported as `attendance.checked_out`; the event now follows the record. **Added:** attendance events from biometric devices. |
| Accounting export: CSV, Excel, JSON, API; salary expense, PF employer, ESI employer, TDS payable, salary payable, other deductions | CSV, XLSX and JSON were implemented, with account mapping per accounting integration. **Added:** the same journal through the API (`GET /v1/accounting-journal?from&to`, scope `payroll.read`). |
| Integration hub: accounting, ERP, payment gateway, biometric, email, SMS, WhatsApp, storage; REST, webhooks, API keys, import/export, scheduled sync | The hub records connections and logs with retry. Biometric devices sync in Phase 4. **Added SMS** (Twilio or MSG91) and **WhatsApp** (Meta Cloud API) adapters. A company enables them per event by adding an active SMS or WhatsApp notification template, managed in Company settings, and messages go to the employee's mobile number in E.164 format. Delivery failures are logged, never fatal. |
| API documentation | **Changed:** the OpenAPI document (`/api/docs`) now covers every module: payroll, expenses, assets, training, recruitment (including the public careers and offer endpoints), performance, documents, helpdesk, onboarding, notifications, AI, mobile, public API and integrations. It lists the access needed for each endpoint and the three authentication schemes (cookie, bearer, API key). **Added:** a readable reference at `/api-docs` generated from the same document, with no third-party scripts. |

**Verification:** `tests/integration/integrations.test.ts` has 5 tests. They cover:
- employee create and update by API key, the audit actor, cross-tenant 404s and read-only keys refused;
- attendance recorded through the API, and the attendance webhook;
- the journal through the API, including validation;
- OpenAPI coverage and security schemes;
- E.164 normalisation;
- SMS and WhatsApp sent on leave approval for an enabled event, and not sent for an event without a template.

The existing `platform.test.ts` still covers webhook signing and retries, and API key scopes and logging.

**Not verified here:**
- Delivery through real Twilio, MSG91 or WhatsApp accounts.
- OAuth connectors for specific ERP or accounting vendors (for example Tally, Zoho or SAP), which need vendor credentials.
- Scheduled sync jobs, which come with the Phase 18 worker.
