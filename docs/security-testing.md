# Security testing checklist

This checklist is for internal testing and for briefing an external assessor. **The application is not VAPT-certified.** Only a qualified, independent assessment of a deployed environment can support that claim. Automated tests in `tests/integration` cover many items below. They do not replace manual or tool-assisted penetration testing.

Test against a staging copy with production-like configuration (HTTPS, `NODE_ENV=production`, `TRUST_PROXY` set correctly behind the proxy). Use two companies (A and B), and in each an administrator, an HR user, a manager and an employee.

## OWASP Top 10 (2021)

| Category | What to test | Existing control |
|---|---|---|
| A01 Broken access control | Call every `/api/*` route as each role, and across companies with the other company's record IDs. Try editing IDs in URLs and bodies. | Server-side `requirePermission` on each route. Company ID is taken from the session, never from the request. Composite tenant foreign keys. |
| A02 Cryptographic failures | Check TLS configuration, cookie flags, and that secrets, templates, identity and bank data are unreadable in the database. | AES-256-GCM (`ENCRYPTION_KEY`) for sensitive fields, face templates, integration secrets and webhook secrets. bcrypt passwords. SHA-256 hashes for API keys and recovery codes. `Secure`/`HttpOnly`/`SameSite=Strict` cookies in production. |
| A03 Injection | SQL, NoSQL, header and CSV/formula injection in every text field, search box, import and export. | Prisma parameterised queries; the only raw SQL uses tagged templates. Zod validation. CSV exports prefix formula characters. |
| A04 Insecure design | Business-rule abuse: self-approval, overlapping leave, reusing a missed-punch request, API key scope escalation. | Rules enforced server-side, and covered by integration tests. |
| A05 Security misconfiguration | Response headers, error detail, default credentials, open debug endpoints. | CSP, HSTS (production), `X-Frame-Options`, `nosniff` in `next.config.ts`. Generic 500 responses. The setup token is required once. |
| A06 Vulnerable components | `npm audit`, lockfile review. | Run in CI. Not automated in this repository yet. |
| A07 Identification and authentication | Brute force, lockout, MFA bypass, recovery code reuse, session fixation, refresh token reuse, idle timeout, logout. | Per-IP and per-account rate limits. Account lockout policy. TOTP with replay protection. One-use recovery codes. Refresh rotation. Idle timeout. Sign out all devices. |
| A08 Software and data integrity | Webhook signature verification by receivers. Tampering with imported CSVs. | HMAC-SHA256 webhook signatures with timestamp. Atomic, validated imports. |
| A09 Logging and monitoring | Confirm that security-relevant actions create audit logs and security events, and that logs contain no secrets. | `audit_logs`, `security_events`, `login_history`, `api_logs`, `integration_logs`. pino redaction of secrets. |
| A10 SSRF | Point webhooks and integration endpoints at `localhost`, private IPs, cloud metadata (`169.254.169.254`), HTTP URLs, and redirecting hosts. | HTTPS only. DNS results checked against private ranges. Redirects refused. Note: a DNS-rebinding window between the check and the request remains; egress firewall rules are recommended. |

## Focus areas

**Authentication.** Wrong password counting and lockout (`423`), unlock by an administrator, TOTP replay, recovery codes (one use each, hashed at rest), password expiry (`428 PASSWORD_EXPIRED`), enforced MFA by role tier (`428 MFA_SETUP_REQUIRED`), password reset token reuse, user enumeration in login and recovery responses.

**Authorization and RBAC.** Every permission key in `src/config/permissions.ts` against every route. Custom roles without a permission must get `403`. The Super Admin panel must require `isSuperAdmin`.

**Tenant isolation.** For each resource, use company B credentials with company A IDs: expect `404`, never data. Include API keys (a company A key must never return company B rows), webhook deliveries and integration logs.

**API security.** API keys: revoked or expired keys return `401`, missing scopes return `403`, calls are rate limited and logged. Writes need the `employees.write`, `attendance.write` or `leave.write` scope and are audited as the key. Requests that are not cookie-authenticated skip the cookie same-origin check, because they carry no ambient credentials: bearer tokens, API keys (`X-API-Key: hrms_…`), device push URLs, and the payment webhook, which is authenticated by an HMAC body signature. Verified white-label domains are accepted as first-party origins, and sign-in on such a domain is limited to its own company.

**File upload.** Company logos only accept PNG or JPEG, validated by file signature and size, and are stored in the database rather than the web root. Try SVG, HTML, polyglot and oversized files. Face samples accept only base64 JPEG data URLs within a size limit.

**Session management.** Cookie flags, 15-minute access tokens, refresh token rotation and reuse detection, logout invalidation, revoke-all, idle timeout, device deactivation for mobile sessions.

**Injection and XSS.** React escapes output. Test rich inputs in names, reasons, notes and AI prompts. Confirm the CSP blocks inline script injection.

**CSRF.** Cookie-authenticated mutations require a matching `Origin`. Test cross-origin form posts and missing `Origin`.

**Rate limits.** Login (IP and account), OTP, password reset, 2FA, face enrollment and punches, API keys.

**Sensitive data exposure.** API responses never include password hashes, secrets, ciphertext, recovery code hashes or face templates. Exports exclude identity and bank data unless permitted.

## Reporting

Record each finding with the affected route, role, request and response, severity (CVSS), and a reproduction. Retest after fixes and keep the report with the release record.

**Data retention.** A retention run needs an enabled policy at or above the category minimum and an explicit confirmation. A legal hold blocks every run. Check that runs never cross tenants, never touch payroll or payslips, and are audited (`RETENTION_RUN`). `tests/integration/security-phase17.test.ts` covers these, plus a cross-tenant sweep of the detail endpoints added in Phases 7–15.
