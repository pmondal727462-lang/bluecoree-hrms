# Jobs, activities, contractors and sites

Apply migrations (`npm run db:migrate`) and regenerate Prisma Client before deployment. Existing Basic subscriptions receive `jobtracking`; Advanced, Enterprise and trials also receive `workplanning` and `contractors`. Management can allow or block these through Client access. The annual base, employee and live-tracking prices are unchanged.

## Employee portal

Open **Jobs & activities** (`/workforce`). Check in through Attendance, choose an active job and start its timer. Only one job can run at a time. Stop the timer to change jobs. Job timesheets show recorded intervals and export CSV. Employees see only their own logs and assigned activities. Advanced users can update their assigned activity's progress; HR controls cancellations.

On **Attendance**, Start break stops any active job timer. End break before starting another timer. Check-out automatically closes the current job and break. Breaks are unpaid. The deducted minutes are the **greater of the scheduled shift break and total recorded breaks**, so the same break is not charged twice. These minutes feed the existing attendance and payroll calculations. Payroll under review, approved or processed prevents edits.

## HR portal

In **Jobs & activities**, HR can create jobs, assign a site and archive completed work. Active timers must finish before a job closes. **Schedule & activities** assigns employees a job, task, start/end and instructions. Overlapping assignments, approved leave and dates before joining are rejected. Each assignment is limited to 36 hours; longer projects use multiple assignments. Shift rosters remain in Attendance settings.

**Agencies** records contractor contacts. **Contract workers** links an existing employee to an agency with start/end dates, reference, terms and active/ended status. Overlapping active contracts are rejected. Contract expiry is displayed; it does not silently deactivate an employee or alter payroll. HR should review expired contracts and update employee access separately.

**Multi-site dashboard** (`/sites`) compares employee counts, punches, open check-ins, leave, late arrivals and completed hours, with CSV download. It uses employees' current branch assignments. “No punch” is not an absence determination: weekly offs, holidays and pending corrections still follow attendance rules. Empty branches and unassigned employees are included.

Jobs, assignments, logs, agencies and contracts return up to 1,000 records per view. Date filters narrow assignments and logs. Company boundaries are enforced by the API and PostgreSQL row-level security; changes are audited.

## Activation requirements

- Face recognition and liveness verification still require a real HTTPS provider and server-side `FACE_PROVIDER_URL` / `FACE_PROVIDER_KEY`. Automatic face scanning already operates while the attendance page is open. Never use a mock provider for real punches.
- Browser offline clock-ins require prior online preparation; see [offline attendance](offline-attendance.md).
- Native background live tracking is implemented with explicit employee consent and visible OS location indicators. It needs a signed native build, the live-tracking add-on, company policy and employee permission. See [mobile setup](../mobile/README.md). Physical-device verification is required before release.
