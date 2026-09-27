# Phase 8 — Recruitment and onboarding

Checked on 27 September 2026 against the [master specification](master-specification.md) §26–28.

| Requirement | Status | Where |
| --- | --- | --- |
| Job creation | Implemented: draft, open, on-hold and closed jobs, with a department, hiring manager, closing date and an approved AI description | Recruitment → Job openings |
| Career page | **Added:** a public page at `/careers/<company code>`, published by the company. It lists open jobs that have not passed their closing date. The page is off by default; HR switches it on and writes the introduction. | Recruitment → Careers page; `GET /api/public/careers/:code` |
| Candidate registration and resume upload | **Added (public):** candidates apply with a PDF resume and must consent to data processing. The consent time is stored. Requests are rate-limited per IP. Bot submissions (a honeypot field) and repeat applications get the same reply as a real one, so the reply does not reveal whether an address has already applied. Recruiters are notified. HR can still add candidates manually. | `POST /api/public/careers/:code/jobs/:id/apply` |
| Candidate database | Implemented across jobs, filtered by job and stage. **Added:** search by name, email or current company. | `GET recruitment/candidates?q=` |
| Pipeline: applied → screening → shortlisted → interview → selected → offer → joined | **Added:** "shortlisted" and "selected" stages; "hired" is shown as "joined". Rejected and withdrawn are exits. Every move is recorded with the person who made it and a note. | Pipeline board |
| Screening, interview, feedback | Implemented: interviews are scheduled with notice to the interviewer; ratings, recommendations and feedback are recorded | candidate detail, My interviews |
| Offer | **Added:** an offer holds the CTC, joining date, response deadline, designation, department and terms. The flow is: draft → send → the candidate accepts or declines through a private link → or HR withdraws the offer. The offer letter is a PDF, and a candidate can have only one active offer. HR is told when the candidate responds. Expired offers cannot be accepted. | candidate detail → Offers; `/offer/<token>` |
| Hiring | Implemented: an explicit decision by an authorised person. **Added:** when a candidate has offers, the latest one must be accepted before hiring. | `POST recruitment/candidates/:id/hire` |
| Onboarding checklist (§28) | Implemented. The checklist has 12 items: offer letter, joining letter, ID, address and PAN proof, bank details, photograph, education, previous employment, policy acceptance, asset allocation and email account. It has a private joiner portal, and the employee record is created automatically when onboarding is completed. | Onboarding |
| AI assistance (§27) | JD generation, interview questions and interview-note summaries exist. Candidate summaries and communication drafts are added in Phase 12. AI never makes hiring decisions. | HR Copilot |

**Verification:** `tests/integration/recruitment.test.ts` has 4 tests. They cover:
- publishing: page disabled, then enabled; draft jobs and other tenants' jobs hidden; permission checks;
- applications: consent, PDF check, closed jobs, duplicate and honeypot handling, stored consent time and source, search;
- stage history across the full pipeline;
- offers: hiring blocked until acceptance, the letter PDF, tenant isolation, the private link, a second answer refused, accept and hire;
- declined, withdrawn (link revoked) and expired offers.

**Still open:**
- Custom application questions.
- Candidates cannot see their application status after applying.
- Email delivery of the offer link depends on the SMTP configuration; without it, HR shares the link.
