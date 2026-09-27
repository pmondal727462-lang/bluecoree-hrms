# Phase 12 — AI HR Copilot

Checked on 27 September 2026 against the [master specification](master-specification.md) §27 and §35–37 (AI in recruitment, the Copilot, natural-language analytics and document drafting) and §29 (AI in performance).

The design is unchanged. A question becomes a plan from a fixed list of intents, either by local rules or by the model, and the plan is validated. Queries run in a read-only transaction through permission-checked code, and model output never becomes SQL. Draft generation sends minimised, redacted context to the company's configured provider. Names are replaced locally after generation, and every draft needs human review.

| Requirement | Status |
| --- | --- |
| Employees: leave balance, attendance, payslip location, how to apply for leave | Implemented. **Changed:** the leave balance comes from the balance engine: accrual, carry-forward, adjustments, encashment, comp-off, and "no limit" for unpaid leave. It previously used annual allowance minus requests. |
| Employees (new): my training, my assets, my expiring documents | **Added** intents `training_status`, `my_assets` and `expiring_documents`. Each shows only the employee's own records. |
| Managers: absent, late, on leave, pending approvals | Implemented. **Changed:** approvals now also count waiting expense claims, missed punches, overtime, payroll runs, documents and manager reviews, according to the user's permissions. The old answer said "other approval workflows are not installed". |
| HR: headcount, attendance trends, payroll summary, recruitment summary, HR reports | Implemented. The recruitment summary now includes the shortlisted and selected stages. |
| HR: expiring documents | **Added:** the company's documents that expire within 30 days, for users with `documents.manage`. It previously answered "unavailable". |
| HR (new): onboarding status | **Added:** each joiner's joining date, required tasks done and open tasks, for users with `onboarding.manage`. It previously answered "unavailable". |
| HR (new): expiring certificates | **Added:** with `training.manage`, the company view lists certificates expiring within 60 days |
| RBAC and tenant isolation | Every intent checks its own permission and filters by company. Each new intent has cross-tenant and own-scope tests. |
| NL analytics without free SQL | Unchanged: a fixed intent catalogue and a read-only transaction |
| Letter drafts: offer, appointment, confirmation, promotion, salary revision, transfer, experience, relieving, warning | Implemented (11 letter types) |
| AI recruitment: JD, interview questions, interview-note summary | Implemented |
| AI recruitment: candidate summary, communication drafts | **Added** `candidate_summary` and `candidate_message` (interview invitation, not-selected update, offer follow-up, joining instructions). They need `ai.recruitment` and `recruitment.manage`, and the candidate must belong to the company. The provider receives the job, stage, experience and interviewer feedback labelled "Interviewer 1, 2…". It never receives the candidate's name, email or phone; placeholders are filled locally. The instructions forbid hiring recommendations and inferring protected characteristics. |
| AI performance: KPI/OKR suggestions | Implemented; suggestions are saved as draft goals |
| AI performance: review drafting, development plans | **Added** `review_draft`, available to HR or the manager writing that review, but never for the employee's own review. The provider receives goals and progress, the self assessment and anonymous peer feedback. The employee's name is replaced by a placeholder. The instructions forbid assigning a rating; the manager decides. |

**Verification:**
- `tests/integration/copilot.test.ts` has 5 tests. They cover:
  - scope of expiring documents: HR, own, and another tenant;
  - onboarding permission and task counts;
  - own assets only, and training;
  - the balance engine with an adjustment;
  - the combined approvals answer;
  - candidate summary context: no name, email or phone sent, and the placeholder filled locally;
  - validation of the message type;
  - cross-tenant and unauthorised drafts;
  - review draft access for the reviewer only, plus the rating prohibition.
- The existing `ai.test.ts` now expects onboarding questions from employees to be refused (403), not answered as unsupported.

**Not verified here:** answer quality from a real model provider. Tests use a stubbed provider.
