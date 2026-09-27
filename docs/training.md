# Phase 10 — Learning and development

Built on 27 September 2026 against the [master specification](master-specification.md) §30 ("L&D: course, training, trainer, enrollment, attendance, certification, expiry, skills"). Before this phase there were only two notification templates.

| Requirement | Implementation |
| --- | --- |
| Course | Each course has a code (unique per company), title, category, mode (classroom, online, on the job, external), hours, provider and pass score. It can be marked mandatory or active. |
| Training (sessions) | A session has a date and time, place or link, capacity, trainer and open-enrolment flag. It moves from scheduled to completed or cancelled. It can be edited only while scheduled, and capacity cannot drop below the number enrolled. |
| Trainer | Internal (linked to an employee) or external (organisation), with expertise and an active flag. Only HR manages trainers. |
| Enrollment | HR enrolls up to 500 people at a time. Employees join or leave open sessions before they start. Capacity is enforced under a per-session lock (409 `SESSION_FULL`), and only active employees of the same company can be enrolled. Enrolment sends a notification. |
| Attendance | Attended, absent or cancelled, marked only once the session has started. A session cannot be completed while anyone is still just "enrolled". |
| Certification | A result (score and pass) is recorded for attendees. The course pass score decides the result unless HR overrides it. Passing issues a certificate number and a certified date (the session end). A PDF certificate is available to HR and the employee only. |
| Expiry | The certificate is valid for the course's number of months. HR lists certificates expiring within 30, 60 or 90 days. Reminders go out a day before a session and 30 days before expiry, each sent once. They can be run on demand now; the scheduled worker comes in Phase 18. |
| Skills | Passing a course raises each of its skills to the course level; it never lowers a higher one. HR records skills manually from 1 to 5. HR sees and searches the skills register; employees see their own. |
| Compliance (supporting) | For each mandatory active course: the active employees without a valid completion. |
| ESS | "My training" shows upcoming sessions, certificates with valid, expiring or expired status and downloads, and skills. The home dashboard has a training card, which closes the Phase 2 gap. |

**Access:**
- `training.manage` is given to the Company Owner and Admin, the HR Manager and the HR Executive.
- `training.self` is given to every role that has self-service access.
- The module is part of every plan that includes performance.
- All five new tables have tenant row-level security and value checks.

**Verification:** `tests/integration/training.test.ts` has 5 tests. They cover:
- HR-only setup, duplicate codes, date validation and tenant isolation;
- self-join, capacity limits and attendance timing;
- pass and fail by score, certificate number and 12-month expiry, the skills upgrade, and certificate access;
- the ESS summary and home card, compliance, the expiring window and own-only certificates;
- reminders sent once.

**Not included:** e-learning content hosting (SCORM/video), course feedback forms, and training cost budgets.
