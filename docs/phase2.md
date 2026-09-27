# Phase 2: attendance and time off

## Getting started

Open `/attendance`, `/leave`, or `/time-settings` after signing in. Refresh an already-open workspace to load the new permissions and navigation. The company and login credentials are unchanged.

1. In **Time settings**, add the actual company shifts, holiday dates, and leave types with annual allowances. No leave entitlement, attendance, or holiday is fabricated.
2. Assign each employee a shift using the searchable employee selector. Shifts use the company's timezone. End earlier than start means an overnight shift.
3. Employees use **Attendance → Check in / Check out**. Their user accounts must be linked to active, probationary, or on-notice employee records.
4. HR/admins use **Daily register** for present, checked-in, on-leave, holiday, weekly-off, and missing-attendance statuses. **Company records** supports date ranges, totals, and paginated CSV exports.
5. Employees request full days of leave in **Leave & holidays**. HR reviews the approval inbox; reviewers cannot approve their own leave.

## Attendance rules

- Browser punches use server time, not a client-supplied timestamp. One attendance session is allowed per employee/work date, with at most one open session.
- Work dates use the company timezone. For overnight shifts, punches after midnight and before shift end belong to the previous work date. Checkout closes the existing session across midnight.
- A shift snapshot is stored with each check-in. Completed work minutes deduct the configured unpaid break once, with a minimum of zero. Overtime is time beyond the snapshot's expected net duration; it is informational, not payroll authorization. If grace is exceeded, lateness measures minutes after the scheduled start.
- Sessions over 36 hours require HR correction. HR can add or correct completed sessions with an audit reason and explicit timezone-offset timestamps. Corrections recompute using the employee's current active shift. Imported/added attendance cannot overwrite an existing work date.
- Today's missing punches are labelled **Not checked in**. Past working days without a record, holiday, or approved leave are labelled **Absent**. This is derived from the current employee roster, joining dates and current company calendar, not a historical employment-status ledger.
- Future shift rotations, multiple daily punch/break sessions, and half-day attendance rules are not included.

## Missed punch requests

Employees who missed a punch use **Attendance → Missed punch?** to submit the work date, company-local check-in/check-out times, and a justification. If the date already has an open check-in, that recorded check-in (and its GPS location) is kept and only the check-out is claimed. A check-out earlier than the check-in is treated as the next day.

- Requests are allowed from the joining date up to today, with past times only, and not on approved leave days or dates whose attendance is already complete. One pending request is allowed per work date.
- HR users with `attendance.manage`, and the employee's manager, are notified of each new request. HR reviews requests under **Missed punches**. They cannot review their own requests. Employees can cancel their own pending requests.
- While a request is pending, the attendance for that date is not changed. The one exception is a day still open from an earlier date: when the employee checks in on a later day, the open day is set aside as **Awaiting HR review** with no hours. The database allows one open record per employee, and this keeps an old day from blocking new attendance.
- **Approval** writes the attendance through the same audited correction path HR uses. The record is created, or the open or set-aside record is updated, with:
  - source **Regularization**;
  - the current shift's break, late and overtime rules;
  - the justification as the correction reason.
- If attendance for the date was completed some other way after the request, approval is refused, so HR can reject the request or correct the attendance directly.
- **Rejection** marks the day **Absent**. An open or set-aside record is closed with zero hours and status `ABSENT`; a date without any record is already absent. The daily register shows these days as Absent, and Copilot presence counts exclude them. Withdrawing a request after the day was set aside also marks it absent.
- The employee is notified of approval or rejection.

## Face attendance

When face attendance applies to an employee (company policy or the employee's **Face required** setting), attendance is marked by automatic face detection on **Home** and on **Attendance**.

- **Detection.** The camera starts by itself until today's check-in is recorded. MediaPipe's BlazeFace detector runs on the device.
  - Once exactly one clear, centred face has been steady for about a second, one frame is captured and sent for verification.
  - The face provider performs identity matching and liveness on the server; nothing is sent until a face is detected.
  - Failed verifications retry automatically, up to three attempts.
- **First and last scan.** The first verified scan of the work day is the **check-in**. Each later scan moves the **check-out**, so the last scan of the day counts; scans are at least one minute apart.
- **After check-in.** The camera no longer starts by itself. One click starts a scan that updates the check-out, so opening a page never moves it.
- **Records.** Face attendance records have source **Face**.
- **Fallback.** If the browser cannot run the detector, the manual capture button is shown.
- **Assets.** `npm run dev` and `npm run build` copy the detector runtime into `public/mediapipe/wasm`, which is not committed. The 230 KB model is committed at `public/models/blaze_face_short_range.tflite`.
- **Security policy.** It allows `'wasm-unsafe-eval'`, which permits WebAssembly compilation only, not JavaScript `eval`.
- **Provider.** `FACE_PROVIDER_URL` and `FACE_PROVIDER_KEY` must point to a real face-verification provider; without one, scans return "provider unavailable".

## Manual attendance (HR)

**Attendance → Manual attendance** (users with `attendance.manage`; the **Add attendance** button opens it) records attendance for any employee in the company.

- **Entry.** A work date and local check-in/check-out times in the company time zone, plus a reason. A check-out earlier than the check-in is the next day, for night shifts.
- **Validation.** Entries go through the audited correction path with source **Manual**, applying the same shift rules, leave-conflict checks and joining-date checks.
- **List.** The tab lists manual entries from the last 90 days. The API accepts `{ employeeId, workDate, checkIn, checkOut, reason }` on `POST /api/time/attendance`; the full-timestamp form is still accepted. `GET /api/time/attendance?source=Manual` filters by source.

## GPS and device attendance

The company can enable one geofence with a latitude, longitude, and radius of 50–10,000 meters. Location is requested only when an employee clicks check-in/out while the geofence is enabled. The server checks coordinates against the radius and rejects accuracy worse than the radius. GPS location is stored with that punch. Browser location requires localhost or HTTPS and user permission; it is not resistant to device/location spoofing and does not establish biometric identity.

HR can import completed daily sessions from a device export using the normalized CSV below:

```csv
employeeCode,checkIn,checkOut
EMP-001,2026-09-23T09:00:00+05:30,2026-09-23T18:00:00+05:30
```

Use real employee codes, past timestamps with seconds and an explicit offset, and three unquoted fields per row. Imports accept up to 100 rows and 50 KB. The entire import rolls back if any row is invalid, duplicated, belongs to an unknown employee, or conflicts with approved leave. Imports are marked **Device CSV** and audited. No device credentials or biometric templates are collected. Direct vendor/device synchronization requires the device model, protocol, access, and a separate connector; it is not implemented by this CSV adapter.

## Leave policy

Leave types define a paid/unpaid label and a whole-day annual allowance shared by eligible employees. Allowances reset per calendar year; there is no monthly accrual, proration, carry-forward, encashment, or payroll computation. Submit separate requests across year boundaries. Requests start today or later, cannot overlap existing pending/approved requests, and exclude company non-working weekdays and holidays. Pending requests reserve balance; rejection/cancellation releases it. Approved leave blocks punches and attendance corrections on those dates.

Employees can cancel their own pending/approved leave before or on its first day. HR can cancel older leave with an audited note. Existing allowances and paid status cannot change once requests use that type. Holiday changes intersecting pending/approved leave and working-week changes while such requests exist are blocked to preserve recorded charges. Company timezone changes are blocked after attendance exists.

## Permissions and database

- `attendance.self`: own punches and history.
- `attendance.read`: company history and daily register.
- `attendance.manage`: audited manual correction and device CSV import.
- `timeoff.self`: own requests and annual balances.
- `timeoff.manage`: company leave inbox and reviews.
- `time.configure`: shifts, assignments, geofence, holidays and leave types.

The additive `20260924010000_phase2` migration grants these permissions to the appropriate built-in roles without replacing existing grants or modifying custom roles. Company Admin/Super Admin/HR Manager configure policies; HR Executive can manage attendance/review leave; Payroll Manager and Auditor can read attendance. Custom roles need explicit grants in Roles & permissions.

All endpoints are under `/api/time/`; OpenAPI is available at `/api/docs`. Requests authenticate against live roles, apply origin checks, and derive company IDs from the session. Attendance and leave employee/type relationships have composite tenant foreign keys. A PostgreSQL company advisory lock serializes Phase 2 mutations, including punches, balance reservations, holiday edits and approvals. Record mutations and audit records commit together.

## Validation and outstanding checks

Unit tests cover dates/timezones, overnight shifts, work durations, GPS distance, and leave-day counting. Integration tests exercise real PostgreSQL and route handlers, including concurrency, RBAC, tenant isolation, import rollback, leave balance/review transitions and calendar consistency. They create separate temporary test companies and remove only their own fixtures.

No connected browser was available for visual/mobile validation. Real-device import mapping and physical GPS testing require the user's device/location; direct biometric sync remains dependent on hardware details. This implementation does not add payroll or later HRMS phases.
