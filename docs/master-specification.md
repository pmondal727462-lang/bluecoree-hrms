# BlueCoreeHR — master development specification

Supplied by the product owner on 27 September 2026. This is the reference for the 18-phase status in [implementation-audit.md](implementation-audit.md). Section numbers match the original.

## 1–2. Product and objective

Working name **BlueCoreeHR**; name and branding must be changeable. A commercial, production-ready, multi-tenant HRMS/HRIS SaaS sold to multiple companies, comparable to modern Indian HRMS platforms: Core HR, employee management, ESS, attendance, biometric, AI face attendance, GPS, geo-tagging, geo-fencing, leave, shift/roster, overtime, payroll, PF, ESI, PT, TDS, recruitment/ATS, onboarding, performance, OKR/KPI, L&D, expenses, assets, documents, HR helpdesk, AI HR Copilot, analytics, mobile app, API integrations, accounting/ERP integration, SaaS subscriptions, billing, free trial, Super Admin, white-label, enterprise security. Each company's data (employees, attendance, payroll, documents, salary, leave, recruitment, reports, API data) must be completely isolated.

## 3. Technology stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, Shadcn/UI, TanStack Query, React Hook Form, Zod, Recharts, Lucide.
- Backend: Node.js, TypeScript, REST, Express.js or Next.js backend, Prisma; clean modular architecture.
- Database: PostgreSQL with proper indexes, constraints and foreign keys.
- Cache/queues: Redis and BullMQ for notifications, biometric sync, payroll jobs, scheduled jobs, email, background processing.
- Files: local storage in development; S3-compatible (AWS S3, Cloudflare R2) in production.

## 4–5. Multi-tenancy and isolation

`company_id`/`tenant_id` on all company-owned records. Every request determines the tenant from the server-side session/token; never trust a client-supplied company ID. Layers: application filtering, service-level validation, database constraints, and PostgreSQL RLS where practical. Test cross-tenant attacks (identical employee codes such as EMP001 in two companies must stay isolated).

## 6. Roles

Configurable RBAC with default roles: Super Admin, SaaS Admin, Company Owner, Company Admin, HR Manager, HR Executive, Payroll Manager, Finance Manager, Department Manager, Team Leader, Recruiter, Employee, Auditor. Permissions configurable.

## 7. Company management

Profile: company ID, name, logo, legal name, address, city, state, PIN, country, GSTIN, PAN, TAN, CIN, PF registration, ESI registration, professional tax information, contact email, phone, website. Settings: currency, timezone, date format, financial year, payroll cycle, working days, attendance rules, leave policies, holiday calendar.

## 8. Company onboarding wizard

Create account → email verification → create company → company details → departments → designations → working days → holiday calendar → attendance settings → leave settings → payroll settings → invite HR → complete setup. Optional steps can be skipped and configured later.

## 9. Employee management

- Personal: employee ID, name, photo, DOB, gender, blood group, marital status, personal email, official email, mobile, emergency contact.
- Employment: joining date, confirmation date, department, designation, manager, branch, location, employee type, employment status, probation, notice period.
- Government/compliance: PAN, Aadhaar reference, UAN, PF number, ESI number, bank account, IFSC.

## 10. Employee lifecycle

Track recruitment, offer, joining, onboarding, confirmation, promotion, transfer, salary revision, department change, designation change, resignation, termination, exit, full & final settlement. Maintain employee history.

## 11. Employee self-service

Dashboard: today's attendance, check-in, check-out, working hours, leave balance, upcoming holidays, payslips, documents, expenses, announcements, training, performance, HR requests. Employees can update permitted personal details, upload documents, apply leave, check attendance, download payslips, submit expenses, raise HR tickets, view policies.

## 12–16. Attendance, GPS, geo-tagging, geo-fencing, locations

- Sources: WEB, MOBILE, BIOMETRIC, FACE, ADMIN, API. Record employee, date, time, check-in/out, IP, device, latitude, longitude, accuracy, location, source.
- GPS: latitude, longitude, accuracy, timestamp, device, IP, location. Used only according to company rules and privacy requirements.
- Geo-tagging: records show employee, date, time, coordinates, accuracy, location name, and a map view where appropriate.
- Geo-fencing: attendance locations with coordinates and radius (e.g. 100 m); check-in allowed if distance ≤ radius. Settings: enable geofence, radius, allowed locations, remote work policy, field work policy.
- Locations: head office, branch, factory, warehouse, client location, remote work; employees may be assigned allowed locations.

## 17. AI face attendance

Camera → face detection → liveness → verification → identification → GPS → geofence → attendance rules → check-in. Enrollment, verification, liveness, anti-spoofing, confidence threshold, failed attempts, verification logs. No unnecessary raw images; protected templates and strict access control. Face must not be the only method; fallback per company policy.

## 18. Biometric devices

ZKTeco, eSSL, Suprema, Hikvision and others. Device → connector → sync service → attendance API → engine. Device registration, status, employee mapping, punch sync, manual and scheduled sync, sync logs, failed-sync retry.

## 19–20. Attendance rules, shifts and rosters

Company-specific rules: office hours, grace period, late, early exit, half day, absent, overtime, break, minimum hours, weekly off, holiday, night shift (e.g. 09:30 start, 15-minute grace, late after 09:45). Shifts: fixed, rotational, flexible, night, split, weekly off, roster (e.g. 09:00–18:00, 14:00–23:00, 22:00–07:00). Overnight attendance must be correct.

## 21. Leave

Types: casual, sick, earned, privilege, maternity, paternity, compensatory off, loss of pay, optional holiday. Accrual, carry forward, encashment, balance, approval, multi-level workflow, holiday calendar.

## 22–25. Payroll, statutory compliance and payslips

- Earnings: basic, HRA, conveyance, special allowance, bonus, incentive, overtime, other. Deductions: PF, ESI, PT, TDS, loan, advance, other. Complex salary structures.
- Process: select month → lock attendance → working days → payable days → leave deduction → overtime → earnings → PF → ESI → PT → TDS → other deductions → net salary → HR review → approval → lock payroll → generate payslips.
- Statutory: EPF/PF, ESI, PT, TDS, income tax. No hard-coded rates; configurable rules with country, state, rule type, effective from/to, employee rate, employer rate, threshold, ceiling, calculation method, active.
- Payslip PDF: company logo, employee, employee ID, department, designation, pay period, earnings, deductions, employer contributions, net salary, attendance summary. Employees can download payslips.

## 26–29. Recruitment, AI recruitment, onboarding, performance

- ATS: job creation, career page, candidate registration, resume upload, candidate database, screening, interview, feedback, offer, hiring. Pipeline: applied → screening → shortlisted → interview → selected → offer → joined.
- AI assistant: JD generation, interview questions, candidate summary, interview note summaries, communication drafts. No automatic final hiring decisions.
- Onboarding checklist: offer letter, joining letter, ID proof, address proof, PAN, bank details, photograph, education documents, previous employment, policy acceptance, asset allocation, email account. Create the employee automatically on completion.
- Performance: goals, KPI, OKR, review cycles, self evaluation, manager review, peer feedback, rating, comments, history. AI assists with KPI/OKR suggestions, review drafting and development plans; managers decide.

## 30–32. Learning, expenses, assets

- L&D: course, training, trainer, enrollment, attendance, certification, expiry, skills.
- Expenses: travel, food, hotel, fuel, mobile, other. Employee → manager → finance → approved → paid. Receipt upload.
- Assets: laptop, desktop, monitor, mobile, printer, keyboard, mouse, access card, SIM. Track asset ID, serial number, cost, purchase date, warranty, employee, issue date, return date, condition.

## 33. Document management

Employee documents, contracts, offer letters, policies, salary documents, compliance documents. Upload, download, preview, versioning, expiry, access control, approval. Secure private storage.

## 34. HR help desk

Categories: attendance issue, payroll issue, leave issue, document request, HR request, IT request. Statuses: Open, Assigned, In Progress, Resolved, Closed.

## 35–37. AI HR Copilot, natural-language analytics, document generation

- Employees: leave balance, attendance, payslip location, how to apply leave. Managers: who is absent/late/on leave, pending approvals. HR: headcount, attendance trends, payroll summary, expiring documents, recruitment summary, HR reports. Must respect RBAC and tenant isolation.
- NL analytics (e.g. "employees late more than three times this month"): parse intent, check authorization, query an approved data layer, return a table/chart. Never run unrestricted AI-generated SQL.
- Drafts: offer, appointment, confirmation, promotion, salary revision, transfer, experience certificate, relieving, warning letters. HR reviews before issuing.

## 38–39. Dashboards and reporting

- Company Admin: employees, present, absent, leave, late, payroll, pending approvals, recruitment, expenses. Employee: attendance, leave, payslip, tasks, announcements, documents. Super Admin: total/active/trial/expired companies, total employees, active subscriptions, revenue, storage, AI usage, API usage, system health.
- Reports: employee, attendance, late, early exit, absence, leave, overtime, payroll, PF, ESI, PT, TDS, headcount, attrition, recruitment, training, assets, expenses. Export Excel, CSV, PDF.

## 40–45. Mobile, push, integrations, public API, webhooks, accounting export

- Mobile (React Native or Flutter; Android and iOS): login, dashboard, face/GPS attendance, geofence, leave, attendance, payslip, expense, documents, notifications, profile, HR requests, approvals.
- Push: leave approved/rejected, attendance reminder, late attendance, payslip generated, announcement, training reminder, document expiry, approval request.
- Integration hub: accounting, ERP, payment gateway, biometric, email, SMS, WhatsApp, storage; REST, webhooks, API keys, OAuth where appropriate, import/export, scheduled sync.
- Public API `/api/v1/` (employees, attendance, leave, payroll, payslips); per-company API keys; usage tracking.
- Webhooks: employee.created, employee.updated, attendance.checked_in, attendance.checked_out, leave.created, leave.approved, leave.rejected, payroll.processed, payslip.generated, candidate.created, candidate.selected; with retries.
- Accounting export: CSV, Excel, JSON, API; map salary expense, PF employer, ESI employer, TDS payable, salary payable, other deductions.

## 46–50. SaaS subscription, pricing, limits, trial, billing

- Plans: Free Trial, Basic, Professional, Enterprise; monthly and annual; pricing configurable by Super Admin, never hard-coded.
- Employee-based pricing (employees × price), minimum monthly charge, maximum employees, feature-based pricing, add-ons (biometric, AI Copilot, advanced payroll, recruitment, white label, API, extra storage).
- Limits per plan: employees, HR admins, storage, AI requests, API calls, biometric devices, locations, payroll/recruitment/performance access. Enforced.
- Trial: configurable (e.g. 15 days); track start, end, status. After expiry show the subscription page, restrict configured functionality, preserve data, never delete data automatically.
- Billing: subscription invoice, payment history, invoice number, tax/GST details, payment status, refund status; payment-provider architecture; no raw card data.

## 51–55. Super Admin, company view, Company Admin, white label, support

- `/admin`: companies, subscriptions, plans, billing, payments, employees, storage, AI usage, API usage, integrations, support, system health, audit logs, security events.
- Company view: company, plan, employees, subscription, trial, created date, last login, storage, API usage, AI usage, status. Actions: view, suspend, activate, change plan, extend trial, reset access.
- Company Admin sees only its company: employees, HR, attendance, leave, payroll, recruitment, performance, training, expenses, assets, documents, reports, settings, subscription, billing.
- White label: logo, company name, colors, login page, email branding, payslip branding, employee portal branding, custom-domain architecture.
- Support tickets from Company Admin (subject, category, priority, description, attachment); Super Admin assigns, responds, changes status, closes.

## 56–61. Security, MFA, login security, audit, VAPT, backup

- HTTPS/TLS, secure cookies, password hashing, RBAC, MFA/2FA, rate limiting, session management, tenant isolation, input validation, XSS, SQL-injection and CSRF protection, security headers, secure uploads, audit logs.
- MFA: email OTP, authenticator app, recovery codes, admin-enforced MFA.
- Login: failed-login tracking, rate limiting, lockout, password policy, session timeout, refresh-token rotation, logout all devices, login history, device history.
- Audit: login, logout, employee creation/changes, salary changes, attendance changes, leave approval, payroll approval, permission changes, subscription changes, company changes, API access, AI access.
- VAPT per OWASP: authentication, authorization, RBAC, tenant isolation, API security, file upload, session security, injection, XSS, CSRF, rate limiting, sensitive-data exposure. Never claim VAPT certification without a real assessment.
- Backup: daily and weekly full, encrypted, retention, verification, restore testing, disaster recovery plan.

## 62. Database structure

Tables including: users, roles, permissions, role_permissions; companies, company_settings, company_branding; branches, departments, designations; employees, employee_history, employee_documents, employee_addresses, employee_bank_accounts, employee_emergency_contacts; attendance, attendance_punches, attendance_locations, geofence_events, attendance_devices; face_profiles, face_verification_logs; shifts, employee_shifts, rosters; leave_types, leave_balances, leave_requests, holidays; overtime; salary_structures, salary_components, employee_salary; payroll_runs, payroll_items, payroll_deductions, payslips; tax_rules, pf_settings, esi_settings, professional_tax; jobs, candidates, applications, interviews, offers, onboarding, onboarding_tasks; performance_cycles, performance_goals, performance_reviews; training_courses, training_enrollments; expenses, expense_claims; assets, asset_assignments; tickets, ticket_messages; notifications, notification_templates; ai_conversations, ai_messages, ai_access_logs, ai_generated_documents; employee_devices, mobile_sessions, push_tokens; integrations, integration_credentials, integration_logs; api_keys, api_logs; webhooks, webhook_deliveries; audit_logs, login_history, security_events; subscription_plans, subscriptions, subscription_usage, payments, invoices; support_tickets, support_messages; backup_logs, system_health_logs. All tenant-owned tables reference the company.

## 63. Database security

Never rely only on frontend filtering. Every backend query validates authenticated user + company + role + permission (e.g. `GET /employees/100` checks the employee belongs to the caller's company).

## 64–69. Structure, environment, jobs, email, API docs, logging

- Modules: auth, companies, employees, attendance, biometric, face-attendance, geofence, leave, shifts, payroll, compliance, recruitment, onboarding, performance, training, expenses, assets, documents, helpdesk, ai, notifications, integrations, subscriptions, billing, reports, audit, security, mobile; plus middleware, services, repositories, validators, jobs, utils, config.
- Environment: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_URL, SMTP_HOST/PORT/USER/PASSWORD, STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET, AI_PROVIDER, AI_API_KEY, PAYMENT_PROVIDER/KEY/SECRET, APP_URL, API_URL. Never commit secrets.
- BullMQ/Redis jobs: biometric sync, payroll processing, leave accrual, email, notifications, document expiry, training expiry, birthdays, work anniversaries, subscription reminders, payment verification, failed webhook retry.
- Email templates: welcome, email verification, password reset, leave approval/rejection, payslip, joining, interview, subscription, payment, invoice, trial expiry.
- `/api/docs` with OpenAPI/Swagger documenting all public APIs.
- Structured logging (Pino or Winston) of API requests, errors, authentication, jobs, integration errors, security events; never log passwords, tokens or secrets.

## 70–71. Testing

Unit, integration, API, security, tenant-isolation, payroll, attendance, leave, subscription, AI-permission and face-attendance tests. Critical test: Company A Admin accessing Company B employee gets 403 or an equivalent secure response; repeat for employee, attendance, payroll, documents, leave, reports, API and AI Copilot.

## 72–74. Feature flags, add-ons, pricing control

- Centralized feature service (e.g. `featureService.canUse(companyId, "AI_COPILOT")`), no scattered plan checks. Features: CORE_HR, ATTENDANCE, GPS, GEOFENCE, BIOMETRIC, FACE_ATTENDANCE, LEAVE, SHIFT, PAYROLL, PF, ESI, PT, TDS, RECRUITMENT, ONBOARDING, PERFORMANCE, TRAINING, EXPENSE, ASSET, AI_COPILOT, MOBILE_APP, API, ACCOUNTING_INTEGRATION, WHITE_LABEL, ADVANCED_REPORTS.
- Add-ons purchasable without changing the base plan (e.g. Professional + Payroll + AI + Biometric).
- Super Admin configures plan name, monthly/annual price, employee limit, storage, features, add-ons, trial duration, discount, coupon, tax settings, without code changes.

## 75–76. Marketing website and trial conversion

Public pages: home, features, HR, attendance, payroll, recruitment, performance, AI, mobile app, pricing, resources, FAQ, contact, login, start free trial. Funnel: start trial → register → verify email → company setup → import employees → use HRMS → trial reminder → choose plan → payment → subscription active.

## 77–80. Import, bulk operations, export, retention

- Employee import from Excel/CSV with downloadable template; validate employee ID, name, email, department, designation, joining date, salary, bank and compliance information; show errors before committing.
- Bulk: employee creation, attendance import, salary update, document upload, shift assignment, leave adjustment, notifications, employee status update.
- Company Admin exports permitted data as CSV, Excel, PDF, JSON where applicable. Super Admin must not casually expose customer employee data; administrative access is permission-controlled and audited.
- Configurable retention (attendance, audit logs, documents, applications, AI conversations, deleted employees); no automatic permanent deletion of important records without a configured policy and safeguards.

## 81. Development phases (exact sequence)

1. Foundation: project, database, Prisma, authentication, RBAC, multi-tenancy, company management, Super Admin, employee management.
2. Core HR: employee lifecycle, ESS, documents, departments, designations, branches.
3. Attendance: web, mobile, GPS, geo-tagging, geofencing, shifts, rosters.
4. Biometric: device integration, synchronization, device mapping, logs.
5. AI face attendance: registration, verification, liveness, anti-spoofing, attendance integration.
6. Leave: policies, balances, approval, holiday, accrual.
7. Payroll: salary structures, engine, PF, ESI, PT, TDS, payslip.
8. Recruitment: ATS, career page, candidates, interviews, offers, onboarding.
9. Performance: KPI, OKR, goals, appraisal, feedback.
10. Training: courses, training, certification, skills.
11. Expense & asset: expenses, approvals, assets, assignment, return.
12. AI HR Copilot: assistant, NL queries, JD generator, interview/performance/document assistants, report summary.
13. Mobile: Android, iOS, push notifications, device management.
14. Integrations: REST API, webhooks, accounting, ERP, payment, email, SMS, WhatsApp, biometric.
15. SaaS: plans, subscriptions, trial, billing, payments, feature limits, add-ons.
16. White label: branding, custom-domain architecture, enterprise settings.
17. Security: MFA, audit, VAPT preparation, tenant-isolation and OWASP testing, backup, disaster recovery.
18. Production: Docker, CI/CD, monitoring, logging, database backup, Redis, queue workers, CDN, HTTPS, deployment.

## 82–85. Development rules, code quality, scale, final product

- Work phase by phase; inspect files, package.json, database and Prisma schema, authentication, RBAC, API and frontend architecture before changing anything. After each phase: migrate, typecheck, lint, test, fix errors, verify existing features and tenant isolation, document changed files, provide setup commands. Do not move on until the current phase works.
- Code quality: strict TypeScript, clean architecture, SOLID, reusable components/services, centralized validation and error handling, secure coding, transactions where required, proper indexes, pagination, server-side filtering. Avoid duplicate code and hard-coded business rules, pricing, statutory rates, tenant IDs, admin credentials, and client-side-only authorization.
- Must serve 10 to 5,000+ employees without redesign; paginate and optimize; never load entire employee/attendance/payroll tables into the browser.
- Final product: SaaS website, customer HRMS, employee portal, Android and iOS apps, Super Admin, AI HR Copilot, payroll, attendance, biometric, face attendance, GPS/geofencing, recruitment, performance, training, expense, asset, API, integrations, subscription, billing, white label — a commercial SaaS HRMS, not a single-company internal tool.
