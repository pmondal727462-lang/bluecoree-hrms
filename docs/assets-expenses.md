# Phase 11 — Expenses and assets

Checked on 27 September 2026 against the [master specification](master-specification.md) §31–32.

## Expenses (§31)

| Requirement | Status |
| --- | --- |
| Categories: travel, food, hotel, fuel, mobile, other | **Added:** "Add standard categories" creates the six, each with an editable per-claim limit and a receipt rule. It is safe to run more than once. Companies can still add their own categories. |
| Employee → manager → finance → approved → paid | **Changed from one approval to two.** The manager of the employee who submitted the claim approves first (status: manager approved). Finance (`expenses.manage`) approves second, and must be a different person from the manager. When the employee has no manager who can approve expenses, finance approves directly. Either stage can reject, with a reason. An approved claim is paid through payroll or marked paid directly. The employee can cancel until finance approves. |
| Receipt upload | Implemented: PDF, PNG or JPEG, content-checked; required per category; private download |

**Fix found in testing:** "Mark paid" failed with a server error. It disconnected the payroll-run relation, which also tried to clear the claim's company ID.

## Assets (§32, new)

| Requirement | Implementation |
| --- | --- |
| Types: laptop, desktop, monitor, mobile, printer, keyboard, mouse, access card, SIM | Asset categories, plus "other" |
| Asset ID, serial number, cost, purchase date, warranty | Asset register. The asset ID is unique per company. Search covers ID, name and serial number, with filters for status and category, a "warranty ends within 60 days" filter, and a count and cost summary. |
| Employee, issue date, return date | An asset is issued to an active employee of the same company. Return is recorded with a date that cannot be before the issue date. A database index allows only one open assignment per asset, and issue and return are serialised per asset. The employee is notified and acknowledges receipt under "My assets". |
| Condition | Condition (new, good, fair, damaged) is recorded at issue and at return. A damaged return goes to "in repair" and must be put back in stock before it can be issued again. Status changes (in stock, in repair, retired, lost) need a reason. |
| History | The full issue and return history for each asset, audited |
| Exit clearance (supporting) | The final settlement cannot be approved while the employee holds company assets (`ASSETS_OUTSTANDING`). An asset is released by recording its return or reporting it lost. |

**Access:**
- `assets.manage` is given to the Company Owner and Admin, the HR Manager and the HR Executive.
- `assets.self` is given to every employee role.
- The module is part of every plan that includes expenses.
- Both new tables have tenant row-level security and value checks.
- This migration also removes `training.self` from the provider's SaaS Admin role.

**Verification:** `tests/integration/assets.test.ts` has 4 tests. They cover:
- permissions, duplicate IDs, warranty dates, the warranty filter, search and tenant isolation;
- issue to another tenant's employee, double issue, acknowledgement by the owner only, and retiring an issued asset;
- return dates, a damaged return going to repair, and history;
- the settlement hold and its release by reporting the asset lost;
- standard categories, the manager-first rule, the finance stage, paying, finance approving directly when there is no manager, and a finance rejection.

The expense test in `modules.test.ts` now covers both stages.
