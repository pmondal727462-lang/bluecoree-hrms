# Phase 6 — Leave management

Checked on 27 September 2026 against the [master specification](master-specification.md) §21. Much of the leave schema and a full balance engine existed but were not connected; this pass wires them in.

| §21 requirement | Status | Where |
| --- | --- | --- |
| Casual, sick, earned/privilege, maternity, paternity, compensatory off, loss of pay | **Added:** "Add standard types" creates them once (all values editable). Earned and privilege leave are one type. | Time settings → Leave types |
| Optional holiday | **Added:** holidays can be optional. Employees choose up to the yearly limit, and only a chosen holiday is excluded from that employee's leave days. | Leave page, `/api/time/optional-holidays` |
| Accrual | **Connected:** annual or monthly (allowance ÷ 12 per month from the joining month) | leave type `accrual` |
| Carry forward | **Added:** year-end run carries unused balance up to each type's cap. Idempotent. | `POST /api/time/leave-carry-forward` |
| Encashment | **Added:** HR records encashed days up to the type's yearly limit and the available balance. Amounts are for payroll (Phase 7). | `POST /api/time/leave-encash` |
| Balance | **Connected:** accrued + carried + adjusted − encashed − approved − pending. Comp-off balances use expiring credits. Unpaid types have no limit. | `leave-balance.ts` |
| Approval | Implemented; approvals are recorded with level, approver and note | leave review |
| Multi-level workflow | **Added:** two-level types go to the reporting manager (who sees them under "My team"), then HR. Without a manager login, HR approval is final. The final approver must differ from the first. | leave type `approvalLevels` |
| Holiday calendar | Implemented; company holidays are not charged | Time settings → Holidays |
| Half days (supporting) | **Added:** first or second half on one date, per-type permission, both halves may be booked separately | leave request |
| Compensatory off (supporting) | **Added:** employees claim credits for completed work on a weekly off or holiday. HR approves; approval adds an expiring credit. | `/api/time/comp-off` |
| Bulk leave adjustment (§78) | **Added:** up to 500 +/− adjustments per request, audited | `POST /api/time/leave-adjust` |

**Fixes found during the check:**
- The service used a simplified balance (annual days minus requests) instead of the full engine.
- Loss-of-pay requests were blocked by a zero balance.
- Optional holidays were excluded for everyone.
- The optional flag on holidays was not saved.

**Still open:** a scheduled year-end job (the carry-forward endpoint is idempotent and ready for the Phase 18 worker). Encashed days are paid through payroll ([Phase 7](payroll.md)).

**Verification:** `tests/integration/leave.test.ts` covers:
- standard types;
- half days and overlap rules;
- unpaid leave beyond balance;
- manager-then-HR approval and the no-manager path;
- optional holiday limits and per-employee charging;
- comp-off credit and balance;
- idempotent carry-forward, encashment limits, adjustments;
- permission and tenant checks.

Existing phase 2 tests were made independent of the day they run on (weekends are now off days) and send a fresh face image per scan (replays are rejected).
