# Payroll, expenses, recruitment, performance and custom reports

Each module is gated by the company's plan (Trial, Professional and Enterprise include all of them) and by role permissions. Built-in roles received the new permissions in migration `20260927010000_hr_modules`; custom roles need them granted in **Roles & permissions**.

## Payroll with PF, ESI, PT and TDS

**Set up once:** **Payroll → Statutory settings**, then a **Salary structure** for every employee (monthly basic, HRA, special and other allowances; PF, ESI and PT applicability; tax regime; old-regime declarations).

**Every month:** **Payroll → Calculate draft payroll** for the month, review each line, adjust loss-of-pay days or other deductions if needed (a reason is required and audited), then **Process**. Processing issues payslips with a full breakdown, closes the reimbursed expense claims and locks the run. Processed runs cannot be edited or deleted; correct errors in the next month.

How amounts are calculated (all rates editable per company):

| Item | Default rule |
|---|---|
| Proration | Pay × paid days ÷ calendar days. Unpaid days are approved leave on unpaid leave types (working days only) plus days before joining. |
| PF | 12% employee and 12% employer on basic, limited to the ₹15,000 wage ceiling unless disabled. Employer share split into EPS (8.33% of capped wage) and EPF (remainder); EDLI 0.5% and admin 0.5%. |
| ESI | Applies when full monthly gross is ₹21,000 or less: 0.75% employee, 3.25% employer on wages paid, rounded up. The rule that keeps coverage until the end of a contribution period is not modelled. |
| Professional tax | State slabs entered by the company. West Bengal and Maharashtra templates are provided as starting points only. |
| TDS | FY 2025-26 slabs. New regime: ₹75,000 standard deduction, section 87A rebate up to ₹12 lakh with marginal relief. Old regime: ₹50,000 standard deduction, 80C (including employee PF, capped at ₹1.5 lakh), 80D, HRA exemption, other declared deductions and PT. Surcharge above ₹50 lakh and 4% cess. Annual tax is projected from pay to date plus the current structure, and the balance after TDS already deducted is spread over the remaining months of the April–March year. |

Not covered: arrears, bonuses and one-off earnings, perquisites, previous-employer income, form 12BB proofs, LWF, gratuity, full-and-final settlement, and challan payment. **Rates and rules change; have your payroll adviser review the settings and the first runs before relying on them for filing.**

**Statutory files** for each run: PF ECR text file (EPFO `#~#` format, UAN from the employee's protected details), ESI monthly contribution CSV, PT summary, TDS summary with PAN, and a salary register. Identifiers are filled only for users allowed to read sensitive employee data. Upload files to the EPFO/ESIC portals after checking them.

The **accounting export** now posts payroll-run payslips with separate lines for PF, ESI, PT and TDS payables, employer contributions and reimbursements. New mapping accounts can be set on the accounting connection.

## Expenses

HR/finance set up categories (optional per-claim limit, receipt requirement). Employees submit claims with a PDF, PNG or JPEG receipt (2 MB, validated by file content). The employee's manager (**expenses.approve**) or finance (**expenses.manage**) approves or rejects with a reason; nobody approves their own claim. Approved claims are paid through the next payroll run automatically, or finance can mark them paid outside payroll.

## Recruitment

Job openings (optionally using an approved AI job description), candidates with PDF resumes, a stage pipeline (applied → screening → interview → offer → hired / rejected / withdrawn) with full history, scheduled interviews, and structured interviewer feedback (rating, recommendation, notes). Only the assigned interviewer submits feedback. **Hiring is always an explicit action** by a user with **recruitment.manage** from the Offer stage; it creates the employee on probation and sends the `candidate.selected` and `employee.created` webhooks. A public careers page and candidate self-application are not included.

## Performance

HR creates and launches review cycles; launching creates a review for each active employee with their current manager as reviewer. Goals (KPI, OKR, goal, development) start as drafts, including AI suggestions, and must be approved by the manager or HR before progress is tracked. Reviews go self review → manager review → employee acknowledgement; employees do not see the manager's assessment until it is submitted. Colleagues can give visible praise or suggestions; private notes are limited to the manager and HR.

## Custom reports

Choose a dataset (employees, attendance, leave, processed payroll, expenses, candidates, goals), columns, filters, a date range, and optional grouping with count/sum/average/min/max. Results show as a table and a bar chart and export to CSV or Excel. Reports can be saved and shared; each viewer still needs the dataset's own permission. Fields come from a fixed allow-list, identity and bank details are never available, and a report reads at most 20,000 source rows and returns 5,000.
