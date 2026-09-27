# Phase 7 — Payroll, statutory compliance and payslips

Checked on 27 September 2026 against the [master specification](master-specification.md) §22–25.

Before this pass, the system had these gaps:
- Statutory rates were a single company settings record.
- Payable days counted only unpaid leave.
- Overtime, bonuses, encashment, loans and advances were not paid or deducted.
- A run went straight from draft to processed.
- Payslips were only a client-side CSV.

| §22–25 requirement | Status | Where |
| --- | --- | --- |
| Earnings: basic, HRA, conveyance, special allowance, bonus, incentive, overtime, other | **Added:** conveyance on the salary structure. Bonus, incentive and other earnings are entered per run line and kept through recalculation. Overtime and leave encashment are calculated. | salary structure; `PUT payroll/runs/:id/items/:item` |
| Deductions: PF, ESI, PT, TDS, loan, advance, other | **Added:** loans and advances are repaid in monthly instalments. They are capped so net pay never goes below zero. | `payroll/loans`, Payroll → Loans & advances |
| Payable days and leave deduction | Unpaid leave and days before joining are deducted. **Added (option):** absences from attendance are deducted too. An absent working day, or a working day with no record, counts 1; a half or short day counts 0.5. Holidays, weekly or rostered offs and approved leave are skipped. Missed punches and days under review are not deducted. | Statutory settings → Pay rules |
| Overtime | **Added:** only approved overtime is paid: (basic or gross) ÷ days ÷ hours per day × multiplier. | `compute.ts` |
| Leave encashment payout | **Added:** encashed days not yet paid are paid at basic ÷ divisor. Processing marks the ledger rows as paid (`amount`, `refId` = run), so they are never paid twice. | Phase 6 encashment → payroll |
| HR review → approval → lock | **Added:** the run moves draft → submitted → approved → processed. The approver needs `payroll.approve` and must not be the person who submitted the run. A submitted or approved run can be sent back to draft with a reason. Only a draft can be edited, recalculated or deleted. | run actions `submit`, `approve`, `reject`, `process` |
| Lock attendance | **Added:** a submitted, approved or processed run locks that month. While it is locked, the system refuses (409 `PAYROLL_LOCKED`): manual and HR attendance entries, imports and corrections; missed-punch decisions; overtime reviews; and approving or cancelling approved leave. Device punches for the month are logged but not applied. | `assertPayrollOpen` |
| Statutory rules, not hard-coded | **Added:** effective-dated rules for PF, ESI, PT (by state) and income tax (by regime). Each rule has a country, state, dates, employee and employer rates, threshold, ceiling, calculation method, configuration and an active flag. The platform keeps the default rules (Super Admin only). A company rule of the same type overrides the default from its effective date. Payroll uses the rules in force for the run's month; each line records which rules it used. When saved rates differ from the rules in force, they become a company rule from the start of the financial year. | `payroll/statutory-rules`, `platform/statutory-rules`, Payroll → Statutory rules |
| Payslip PDF | **Added:** generated on the server. It shows the logo, brand colour, employee name and code, department, designation, date of joining and pay period. It lists earnings, deductions, employer contributions and net pay. The attendance summary covers paid, loss-of-pay and absent days, overtime and encashed leave. Employees can download only their own. | `GET payroll/payslips/:id/pdf`; My payslips → PDF |
| Statutory files | Unchanged: PF ECR, ESI, PT and TDS files. The salary register gains the new earnings and deductions. | run reports |

**Verification:** `tests/integration/payroll.test.ts` has 7 tests. It checks August 2026 against hand-calculated values:
- 2.5 absent days;
- ₹484 overtime;
- ₹3,000 encashment;
- ₹2,000 loan and ₹1,000 advance;
- a ₹2,500 bonus kept through recalculation;
- gross ₹51,953 and net ₹48,953.

It also covers:
- self-approval refused;
- the lock on attendance, leave approval and recalculation;
- sending a run back and unlocking the month;
- loan balances and closure;
- encashment settled once;
- PDF access for the employee, HR, another employee and another tenant;
- effective dating and tenant isolation of rules;
- the platform-only write.

The existing payroll test in `modules.test.ts` now goes through submit and approval.

**Limits:**
- Salary components are the fixed set above. There is no formula builder for custom components.
- Amounts are stored as floating-point values rounded to whole rupees, not as decimal money.
- Arrears for earlier months and full-and-final settlement through payroll are not implemented.
- Default rule values follow FY 2025-26. A payroll adviser must confirm them before filing.
- The calculation has not been validated independently against a certified payroll engine.
