# BlueCoreeHR checking guide

Run `npm run db:seed-checking` against the local development database. The script refuses production and remote databases, never deletes existing tenants, and skips demo companies already created.

Six clearly labelled fictional companies use codes CHECK1–CHECK6, with 10, 11, 12, 13, 14 and 15 employees respectively. Their private test plans cover trial, basic, professional, enterprise, annual professional and expired trial subscriptions. CHECK6 intentionally exercises expired-subscription access restrictions.

Local login details are in `data/checking-logins.json` (ignored by Git). Sign in through the normal company login using the company code and one of the listed admin, HR, finance or employee accounts. The Management Login is for the software owner.

Select **August 2026** in attendance and payroll. Each company has varied salaries and a full month's weekday attendance, including absences, half days, late arrivals and single punches. Payroll runs are drafts; no payments are made. CHECK1 disables PF/ESI for simple manual checking; the other companies use configured PF/ESI rules. PT and TDS are disabled for these test cases. Proration uses 31 calendar days, rounding each earning component separately. These scenarios test application arithmetic, not statutory compliance certification.

The script independently checks loss-of-pay days, gross earnings, PF, ESI and net pay for all 75 employees. Results are saved to `data/checking-payroll-verification.json`, with underlying expectations in `data/checking-expected.json`.

In Documents, HR can upload Appointment, Increment and Promotion letters for a specific employee. Employees use **My employment letters** to download their own files. Other employees cannot view these letters, and employees cannot upload or replace HR-issued letters.

The home page shows today's birthdays and work anniversaries in the company's timezone. Employees can send or change one emoji wish per event. Birth years and ages are not displayed. Demo birthday and anniversary dates match the day the seed first runs.

HR configures working hours and half-day minimums under Shifts, and single-punch treatment under Attendance Policy. A completed past day with one punch can be marked present, absent, half day or missed punch. Current days and still-active overnight shifts are not resolved prematurely. Attendance lists, daily rosters, custom reports and payroll use the same rule. Hours and checkout times are never fabricated. Changing a policy affects historical attendance interpretation; recalculate draft payroll to apply it. Processed payroll remains unchanged.

The homepage uses the existing company logo and a generated workplace photograph. Public branding is BlueCoreeHR and the owner entry is Management Login.
