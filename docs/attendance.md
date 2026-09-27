# Phase 3 — Attendance requirement check

Checked on 27 September 2026 against the [master specification](master-specification.md): Phase 3 (§81: web, mobile, GPS, geo-tagging, geofencing, shifts, rosters) and sections §12–16 and §19–20. Operating rules are in [phase2.md](phase2.md) (older numbering).

## Requirement status

| Spec | Requirement | Status | Where |
| --- | --- | --- | --- |
| §12 | Web and mobile check-in | Implemented | `/api/time/check-in`, `/api/v1/attendance/*` |
| §12 | Face, manual (admin) and device-file attendance | Implemented | face punch, Manual attendance, device CSV import |
| §12 | Biometric device sync and API attendance | **Pending, Phase 4/14.** Device CSV import exists; the device connector and a write API come with biometric integration. | — |
| §12 | Record employee, date, time, check-in/out, IP, device, coordinates, accuracy, location, source | **Completed in this change.** Every accepted punch writes `attendance_punches` with direction, source, device, IP and location. Sources: Web, Mobile, Face, Manual (admin), Regularization, Device CSV. | `attendance_punches` |
| §13 | GPS: latitude, longitude, accuracy, timestamp, device, IP, location, by company rule | Implemented; location is requested only when policy or employee mode requires it | `checkLocation` |
| §14 | Geo-tag display with coordinates, accuracy, location name and map link | Implemented | Attendance → View GPS |
| §15 | Geofence: enable, radius, allowed locations, distance ≤ radius | Implemented; rejections (outside, low accuracy) are recorded | `geofence_events` |
| §15 | Remote and field work policy | Implemented per employee: assigned geofence, GPS anywhere, open, and consented field tracking | employee attendance mode |
| §16 | Head office, branch, factory, warehouse, client site, remote locations; employee assignment | Implemented | `attendance_locations`, `employee_attendance_locations` |
| §19 | Office hours, grace, late | Implemented | shift start + grace |
| §19 | Early exit, half day, minimum working hours | **Completed in this change.** Rules existed but were never applied or configurable. | `completeDay` in `rules.ts` |
| §19 | Overtime (with threshold and HR approval) | **Completed in this change** | shift `overtimeAfterMinutes`, policy `overtimeRequiresApproval`, `/api/time/overtime/:id` |
| §19 | Break | Implemented (unpaid break deducted once) | shift `breakMinutes` |
| §19 | Weekly off and holiday | **Completed in this change.** Work on a weekly off (company working days or rostered) or holiday is flagged `offDay` and counts fully as overtime. | `dayPlan` |
| §19 | Absent | Implemented; derived for past working days, explicit after a rejected missed punch | daily register |
| §19 | Night shift | Implemented (overnight shifts and work dates) | `shiftSnapshot` |
| §20 | Fixed, flexible, split and night shifts | **Completed in this change.** Shift type and its rules are now configurable. | Time settings → Shifts |
| §20 | Rotational shifts, weekly off and roster | **Added in this change.** The roster table existed but was unused. | Attendance → Rosters, `/api/time/rosters` |

## Changes in this pass

**Rule engine.** `completeDay` in `src/modules/time/rules.ts` derives, whenever a day is completed (check-out, HR correction, manual entry or approved missed punch):
- worked minutes;
- overtime beyond the shift's `overtimeAfterMinutes`;
- early exit beyond `earlyExitGraceMinutes`;
- day status: `PRESENT`, `HALF_DAY` below the full-day minimum, `SHORT` below the half-day minimum;
- overtime approval status.

Records show status, early exit and overtime approval in Attendance → Company records.

**Shifts.** Shifts have a type:
- **Fixed:** day or night; a night shift's end is before its start.
- **Flexible:** needs minimum minutes and has no late mark.
- **Split:** a second segment after the first.

Each shift also sets minimum full-day and half-day minutes, early-exit grace and overtime threshold. Validation rejects a flexible shift without minimum minutes and a split segment that overlaps the first.

**Rosters.**
- `GET /api/time/rosters?from&to` returns up to 31 days per page of employees and needs `attendance.read`.
- `PUT /api/time/rosters` saves up to 500 `{ employeeId, workDate, shiftId | weeklyOff }` entries; an entry with neither clears it. It needs `time.configure` and is audited.
- **Attendance → Rosters** shows a weekly grid (default shift, a specific shift or weekly off per day) with a "Repeat Monday" shortcut.
- **Punch planning.** Punches plan their day with the roster:
  - the rostered shift for the date, or an overnight rostered shift from the previous day still running, wins over the default shift;
  - a rostered weekly off is an off day;
  - a rostered shift on a normally non-working weekday makes it a working day.
- The daily register shows the planned shift and rostered weekly offs.
- Existing attendance keeps the shift it was recorded with.

**Overtime approval.**
- With **Overtime needs HR approval** on (the policy default), overtime is `PENDING` with zero approved minutes.
- `PUT /api/time/overtime/:id` with `{ status: "APPROVED" | "REJECTED", minutes? }` (`attendance.manage`) approves up to the recorded minutes or rejects. Reviewers cannot approve their own overtime.
- `GET /api/time/attendance?overtimeStatus=PENDING` lists overtime awaiting review.
- Payroll does not yet consume overtime; that is Phase 7.

**Punch log.** Each accepted punch writes `attendance_punches`:
- direction (`IN`/`OUT`);
- source (`Web`, `Mobile` for `/api/v1`, `Face`);
- device ID and IP, even when GPS is off;
- recorded location.

Face scans after check-in each add an `OUT` punch, so the full scan history is kept while the attendance row holds the first check-in and last check-out. Migration `20260930050000_attendance_punch_ip` adds the IP column.

**Filters.** `GET /api/time/attendance` accepts `source` and `overtimeStatus`.

## Behaviour changes for existing companies

- Overtime now follows the policy's approval setting, whose database default is on. Overtime recorded from now on waits for HR approval until an administrator turns off **Overtime needs HR approval** in Time settings. Existing attendance rows are not recalculated.
- Days now receive half-day, short and early-exit results from their shift rules. Shifts saved earlier have no minimum or half-day minutes, so their full day is the scheduled time less the break, and half a day is half of that.

## Still open

- **Direct device integration** (ZKTeco, eSSL, Suprema, Hikvision) and an attendance write API: Phase 4 and Phase 14.
- **Several in/out sessions per day.** `multiplePunchesAllowed` and `workedFromPunches` exist but are not applied; worked time is first check-in to last check-out less the break.
- **Payroll use of overtime and absent/half-day days:** Phase 7.
- **Automatic weekly roster rotation patterns.** Rosters are planned per day; the grid's repeat shortcut and bulk API cover rotation manually.

## Verification

- 32 migrations applied.
- Type checking and lint (154 files) passed.
- 60 unit tests passed, including 6 new rule-engine tests.
- 112 integration tests passed. The new `tests/integration/attendance.test.ts` covers:
  - shift validation and types;
  - roster planning, permissions and tenant checks, and register display;
  - half day, early exit, off-day overtime, rostered night and Saturday shifts;
  - overtime approval and filtering;
  - web and mobile punch logging with IP and device.
- The production build and HTTP smoke passed.
