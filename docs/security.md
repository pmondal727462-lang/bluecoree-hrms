# Phase 17 — Security, retention and recovery

Checked on 27 September 2026 against the [master specification](master-specification.md) §56–61 and §80.

| Requirement | Status |
| --- | --- |
| HTTPS, secure cookies, password hashing, RBAC, rate limiting, sessions, tenant isolation, validation, XSS, SQL injection, CSRF, headers, secure uploads, audit | Implemented in Phase 1 (see [foundation-hardening](foundation-hardening.md)). Tenant isolation is enforced by composite foreign keys and PostgreSQL row-level security on every company table; the RLS test checks every new table. **Changed in this pass:** the same-origin check now lets through callers that are not cookie-authenticated (API keys, the payment webhook) and verified white-label domains; see [security-testing](security-testing.md). |
| MFA: email OTP, authenticator app, recovery codes, admin-enforced MFA | Implemented. MFA can be required per role tier (admins, managers, employees) and blocks sign-in until it is set up (`428 MFA_SETUP_REQUIRED`). |
| Login: failed-login tracking, rate limits, lockout, password policy, session timeout, refresh rotation, logout everywhere, login and device history | Implemented |
| Audit coverage | Implemented for the listed events; later phases add payroll approval, retention, billing, offer, asset and training events. API and AI access have their own logs. |
| VAPT per OWASP | Checklist in [security-testing](security-testing.md). **Added:** a cross-tenant sweep over the detail endpoints added in Phases 7–15. It found `GET payroll/loans/:id` returning an empty 200 instead of 404 for another company's loan; that is fixed. No VAPT certification is claimed. |
| Backup: daily and weekly full, encrypted, retention, verification, restore testing, DR plan | Implemented; see [backup-recovery](backup-recovery.md). It covers AES-256-GCM encryption, verification, restore tests, the disaster scenarios and RPO/RTO guidance. Scheduling moves to the Phase 18 worker. |
| Configurable retention (§80): attendance, audit logs, documents, applications, AI conversations, deleted employees; no automatic permanent deletion without a configured policy and safeguards | **Added:** Security → Data retention. There is a policy for each category: attendance (at least 3 years), audit logs (at least 1 year), login history (at least 90 days), rejected and withdrawn applications (anonymised, at least 30 days), documents of employees who have left (at least 1 year), and exited employees (contact, identity, bank, address and photo removed, while code, name and payroll records are kept; at least 2 years). AI conversations follow the retention setting in AI settings. Safeguards: <br>• nothing runs unless a policy is enabled; <br>• a period below the minimum is refused; <br>• each policy shows a preview of what a run would affect today; <br>• a permanent run needs explicit confirmation; <br>• a company-wide **legal hold** blocks all runs (turning it on or off needs a reason and is audited); <br>• every run is logged and audited; <br>• payroll, payslips and statutory records are never removed. |

**Verification:** `tests/integration/security-phase17.test.ts` has 3 tests. They cover:
- the permission check, the minimum period, a disabled policy, the preview count, the confirmation requirement, and deletion limited to one company and to rows past the cutoff;
- anonymisation of applications (hired candidates kept) and of leavers, the legal hold blocking a run but allowing a preview, and the audit record;
- the cross-tenant sweep over 10 endpoints.

Passwords created or replaced by an administrator are temporary. Users must choose a different password before accessing protected services; account setup and logout remain available. Changing the password clears the requirement and revokes existing sessions. Password reset and employee password setup also clear the requirement. Existing accounts keep their current behavior unless explicitly marked for a password change. Apply the `20260930160000_must_change_password` migration before deploying this change.

`tests/integration/password-change.test.ts` verifies the temporary-password gate, rejection of the current password, session revocation, and the administrator create/replace flows.

**Not verified here:** an independent penetration test, and a disaster-recovery drill on separate infrastructure.
