"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Clock3, CalendarDays, Download, MapPin, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import {
  AttendanceLocationCard,
  type AttendanceLocation,
} from "./attendance-location";
import { FieldTracking } from "./field-tracking";
import { AutoFaceScan } from "./auto-face-scan";
import { BiometricDevices } from "./biometric-devices";
import { FaceAdmin } from "./face-admin";
import { CompOffPanel, LeaveTools, OptionalHolidays } from "./leave-extras";
import { currentLocation } from "@/lib/geolocation";
import { AttendanceLocations } from "./platform";

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  userId: string | null;
  attendanceMode?: "DEFAULT" | "GEOFENCE" | "GPS" | "OPEN";
  fieldTrackingAllowed?: boolean;
  faceRequired?: boolean;
  shiftId?: string | null;
  branch?: { id: string; name: string } | null;
};
type Shift = {
  id: string;
  name: string;
  kind: "FIXED" | "FLEXIBLE" | "SPLIT";
  startMinute: number;
  endMinute: number;
  splitStartMinute: number | null;
  splitEndMinute: number | null;
  graceMinutes: number;
  breakMinutes: number;
  minimumMinutes: number | null;
  halfDayMinutes: number | null;
  earlyExitGraceMinutes: number;
  overtimeAfterMinutes: number;
  active: boolean;
};
// Day status as recorded by the attendance rules.
const dayStatusLabel = (a: Attendance) =>
  !a.checkOut
    ? "Checked in"
    : ((
        {
          PRESENT: a.offDay ? "Off-day work" : "Present",
          HALF_DAY: "Half day",
          SHORT: "Short",
          ABSENT: "Absent",
          PENDING_REVIEW: "Awaiting HR review",
          MISSED_PUNCH: "Missed punch",
        } as Record<string, string>
      )[a.status] ?? a.status);
const optionalNumber = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === "" ? null : Number(v);
type LeaveType = {
  id: string;
  name: string;
  annualDays: number;
  paid: boolean;
  active: boolean;
  accrual?: "ANNUAL" | "MONTHLY";
  carryForwardMax?: number;
  encashable?: boolean;
  encashMax?: number;
  halfDayAllowed?: boolean;
  approvalLevels?: number;
  compOff?: boolean;
};
type Holiday = { id: string; name: string; date: string; optional?: boolean };
type LeaveBalance = LeaveType & {
  accrued: number;
  carriedForward: number;
  adjusted: number;
  encashed: number;
  compOffEarned: number;
  lapsed: number;
  approved: number;
  pending: number;
  remaining: number;
};
type Policy = {
  gpsTrackingEnabled: boolean;
  fieldTrackingEnabled: boolean;
  fieldTrackingIntervalSeconds: number;
  fieldTrackingMaxMinutes: number;
  faceAttendanceEnabled: boolean;
  overtimeRequiresApproval?: boolean;
  compOffEnabled?: boolean;
  compOffExpiryDays?: number;
  optionalHolidayLimit?: number;
  faceLivenessRequired: boolean;
  faceConfidenceThreshold: number;
  geofenceEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  locationName?: string;
};
type Attendance = {
  id: string;
  employeeId: string;
  employee?: Person;
  workDate: string;
  checkIn: string;
  checkOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  shiftName: string | null;
  source: string;
  status: string;
  offDay: boolean;
  earlyExitMinutes: number;
  overtimeStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  approvedOvertimeMinutes: number;
  correctionReason: string | null;
  checkInLocation: AttendanceLocation | null;
  checkOutLocation: AttendanceLocation | null;
};
type Summary = {
  today: string;
  timezone: string;
  workingDays: number[];
  employee: (Person & { shift: Shift | null }) | null;
  policy: Policy;
  employeePolicy: Policy;
  locations: { id: string; name: string }[];
  faceRules?: { maxFailed: number; lockoutMinutes: number; fallback: string };
  shifts: Shift[];
  holidays: Holiday[];
  leaveTypes: LeaveType[];
  open: Attendance | null;
  current: Attendance | null;
};
type Leave = {
  id: string;
  employee: Person;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote: string | null;
  level?: number;
  halfDay?: boolean;
  session?: string | null;
};
type Regularization = {
  id: string;
  employee: Person;
  workDate: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  status: string;
  reviewNote: string | null;
};
type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  timezone?: string;
  totals?: {
    workedMinutes: number | null;
    lateMinutes: number | null;
    overtimeMinutes: number | null;
  };
};
type RosterRow = Person & {
  status: string;
  shift: Shift | null;
  attendance: Attendance | null;
};
type Props = { me: Me; notify: (message: string) => void };
const personName = (p: Person) => `${p.firstName} ${p.lastName}`;
const dateOnly = (value: string) => value.slice(0, 10);
const clockTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minutes = (value: number) => `${Math.floor(value / 60)}h ${value % 60}m`;
const timestamp = (value: string | null, timezone: string) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const localClock = (value: string, timezone: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const timeValue = (value: FormDataEntryValue | null) => {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + m;
};
const faceMode = (s: Summary) =>
  !!(s.policy.faceAttendanceEnabled || s.employee?.faceRequired);
// Records a punch. With face attendance the server decides: the first
// verified scan of the work day checks in, later scans move the check-out.
async function markAttendance(s: Summary, faceSample?: string) {
  let location;
  if (s.employeePolicy.geofenceEnabled || s.employeePolicy.gpsTrackingEnabled)
    location = await currentLocation();
  const face = faceMode(s);
  return api<Attendance>(
    `time/${face ? "face-punch" : s.open ? "check-out" : "check-in"}`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(location ? { location } : {}),
        ...(face ? { faceSample } : {}),
      }),
    },
  );
}
const punchedText = (saved: Attendance) =>
  saved.checkOut
    ? "Check-out updated to your latest verified scan."
    : "Checked in successfully.";
// Camera scan for face attendance. It starts by itself until today's
// check-in exists; afterwards one click starts a scan that updates the
// check-out, so simply opening a page never moves it.
function FaceScan({
  s,
  onDone,
  onError,
}: {
  s: Summary;
  onDone: (saved: Attendance) => Promise<void>;
  onError: (error: Error) => void;
}) {
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const checkedIn = !!(s.open || s.current);
  // Company fallback policy: web/GPS attendance without a face scan.
  const fallback = s.faceRules?.fallback === "WEB" && (!checkedIn || !!s.open);
  return (
    <div className="space-y-2">
      <AutoFaceScan
        key={round}
        autoStart={!checkedIn && round === 0}
        label={
          checkedIn ? "Scan face to update check-out" : "Scan face to check in"
        }
        onFace={async (sample) => {
          try {
            const saved = await markAttendance(s, sample);
            await onDone(saved);
            setRound((r) => r + 1);
            return true;
          } catch (e) {
            onError(e as Error);
            return false;
          }
        }}
      />
      {fallback && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              let location;
              if (
                s.employeePolicy.geofenceEnabled ||
                s.employeePolicy.gpsTrackingEnabled
              )
                location = await currentLocation();
              const saved = await api<Attendance>(
                `time/${s.open ? "check-out" : "check-in"}`,
                {
                  method: "POST",
                  body: JSON.stringify(location ? { location } : {}),
                },
              );
              await onDone(saved);
              setRound((r) => r + 1);
            } catch (e) {
              onError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {s.open ? "Check out without face" : "Check in without face"}
        </Button>
      )}
    </div>
  );
}
// Home-page card for employees who mark attendance by face.
export function FaceAttendanceCard({ me, notify }: Props) {
  const client = useQueryClient(),
    summary = useSummary();
  const [error, setError] = useState<Error | null>(null);
  const s = summary.data;
  if (
    !s?.employee ||
    !me.permissions.includes("attendance.self") ||
    !faceMode(s)
  )
    return null;
  return (
    <section className="card p-6 mb-6 flex flex-wrap gap-6 items-start justify-between">
      <div>
        <p className="eyebrow mb-2">Face attendance · {s.today}</p>
        <h2 className="text-lg font-semibold">
          {s.open
            ? `Checked in at ${timestamp(s.open.checkIn, s.timezone)}`
            : s.current?.checkOut
              ? `Checked out at ${timestamp(s.current.checkOut, s.timezone)}`
              : "Look at the camera to check in"}
        </h2>
        <p className="muted mt-2">
          First face scan of the day is your check-in; your last scan is your
          check-out. Missed one? Use Missed punch in Attendance.
        </p>
        <Notice error={error} />
      </div>
      <FaceScan
        s={s}
        onError={setError}
        onDone={async (saved) => {
          setError(null);
          notify(punchedText(saved));
          await client.invalidateQueries({ queryKey: ["time"] });
          await client.invalidateQueries({ queryKey: ["home"] });
        }}
      />
    </section>
  );
}
function useSummary() {
  return useQuery({
    queryKey: ["time", "summary"],
    queryFn: () => api<Summary>("time/summary"),
    refetchInterval: 60000,
  });
}
function Notice({ error }: { error?: Error | null }) {
  return error ? (
    <div role="alert" className="error mb-4">
      {error.message}
    </div>
  ) : null;
}
function Pager({
  data,
  page,
  setPage,
}: {
  data?: { total: number; pageSize: number };
  page: number;
  setPage: (p: number) => void;
}) {
  if (!data) return null;
  return (
    <div className="pagination">
      <span>
        {data.total} records · Page {page} of{" "}
        {Math.max(1, Math.ceil(data.total / data.pageSize))}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * data.pageSize >= data.total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function SaveForm({
  onSave,
  children,
  label = "Save",
}: {
  onSave: (form: FormData) => Promise<void>;
  children: ReactNode;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await onSave(form);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Notice error={error} />
      <fieldset disabled={busy} className="space-y-4">
        {children}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : label}
        </Button>
      </fieldset>
    </form>
  );
}
function EmployeePicker({ initial }: { initial?: Person }) {
  const [search, setSearch] = useState("");
  const { data, error } = useQuery({
    queryKey: ["time", "employees", search],
    queryFn: () =>
      api<{ items: Person[]; total: number }>(
        `time/employees?search=${encodeURIComponent(search)}`,
      ),
  });
  const options = [
    ...(initial && !data?.items.some((e) => e.id === initial.id)
      ? [initial]
      : []),
    ...(data?.items ?? []),
  ];
  return (
    <div className="space-y-3">
      <label>
        Find employee
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or employee code"
        />
      </label>
      <Notice error={error} />
      <label>
        Employee *
        <select name="employeeId" required defaultValue={initial?.id ?? ""}>
          <option value="">Select employee</option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.employeeCode} · {personName(e)}
            </option>
          ))}
        </select>
      </label>
      {data && data.total > 50 && (
        <p className="muted text-xs">Showing 50 results. Narrow your search.</p>
      )}
    </div>
  );
}
function downloadCsv(rows: string[][], filename: string) {
  const escape = (value: string) =>
    '"' +
    (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') +
    '"';
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function MissedPunchFields({ s }: { s: Summary }) {
  const openDate = s.open ? dateOnly(s.open.workDate) : "";
  const [workDate, setWorkDate] = useState(openDate || s.today);
  // An open session keeps its recorded check-in; only the check-out is claimed.
  const open = s.open && openDate === workDate ? s.open : null;
  return (
    <>
      <label>
        Work date *
        <input
          name="workDate"
          type="date"
          required
          max={s.today}
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label>
          Check in *
          {open ? (
            <input
              type="time"
              disabled
              value={localClock(open.checkIn, s.timezone)}
            />
          ) : (
            <input key={workDate} name="checkIn" type="time" required />
          )}
        </label>
        <label>
          Check out *
          <input name="checkOut" type="time" required />
        </label>
      </div>
      {open && (
        <p className="muted text-xs">
          Your check-in for this date is already recorded. Enter the time you
          left.
        </p>
      )}
      <label>
        Justification *
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          placeholder="Why was the punch missed?"
        />
      </label>
      <p className="muted text-xs">
        Times are in {s.timezone}. A check-out earlier than the check-in is
        treated as the next day.
      </p>
    </>
  );
}
function Regularizations({
  me,
  notify,
  timezone,
  refresh,
}: Props & { timezone: string; refresh: () => Promise<void> }) {
  const canManage = me.permissions.includes("attendance.manage"),
    canSelf = me.permissions.includes("attendance.self");
  const [scope, setScope] = useState(canManage ? "company" : "own"),
    [status, setStatus] = useState(canManage ? "Pending" : ""),
    [page, setPage] = useState(1),
    [review, setReview] = useState<{
      item: Regularization;
      status: string;
    } | null>(null);
  const list = useQuery({
    queryKey: ["time", "regularizations", scope, status, page],
    queryFn: () =>
      api<Page<Regularization>>(
        `time/regularizations?scope=${scope}&page=${page}${status ? `&status=${status}` : ""}`,
      ),
  });
  return (
    <section className="card">
      <div className="toolbar">
        {canManage && canSelf && (
          <label>
            Show
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
            >
              <option value="company">Approval inbox</option>
              <option value="own">My requests</option>
            </select>
          </label>
        )}
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {["Pending", "Approved", "Rejected", "Cancelled"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <Notice error={list.error} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Employee",
                "Work date",
                "Check in",
                "Check out",
                "Justification",
                "Status",
                "Actions",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="font-semibold">{personName(r.employee)}</div>
                  <span className="muted text-xs">
                    {r.employee.employeeCode}
                  </span>
                </td>
                <td>{dateOnly(r.workDate)}</td>
                <td>{timestamp(r.checkIn, timezone)}</td>
                <td>{timestamp(r.checkOut, timezone)}</td>
                <td className="max-w-xs whitespace-normal break-words">
                  {r.reason}
                </td>
                <td>
                  <span
                    className={`badge ${r.status === "Approved" ? "positive" : ""}`}
                  >
                    {r.status}
                  </span>
                  {r.reviewNote && <p className="muted mt-1">{r.reviewNote}</p>}
                </td>
                <td>
                  {r.status === "Pending" && (
                    <div className="flex gap-2 flex-wrap">
                      {canManage && r.employee.userId !== me.userId && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              setReview({ item: r, status: "Approved" })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setReview({ item: r, status: "Rejected" })
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {r.employee.userId === me.userId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setReview({ item: r, status: "Cancelled" })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.data?.items.length && (
        <div className="empty">
          {list.isLoading ? "Loading requests…" : "No missed punch requests."}
        </div>
      )}
      <Pager data={list.data} page={page} setPage={setPage} />
      <Dialog
        open={!!review}
        onOpenChange={(v) => !v && setReview(null)}
        title={`${review?.status === "Approved" ? "Approve" : review?.status === "Rejected" ? "Reject" : "Cancel"} missed punch request`}
        description={
          review?.status === "Approved"
            ? "Approval updates the employee's attendance with these times and records it in the audit trail."
            : review?.status === "Rejected"
              ? "Rejecting marks the employee absent for this date and notifies them."
              : undefined
        }
      >
        {review && (
          <SaveForm
            label="Confirm"
            onSave={async (f) => {
              await api(`time/regularizations/${review.item.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  status: review.status,
                  note: f.get("note"),
                }),
              });
              setReview(null);
              notify(
                review.status === "Approved"
                  ? "Request approved and attendance updated."
                  : "Missed punch request updated.",
              );
              await refresh();
            }}
          >
            <p>
              {personName(review.item.employee)} ·{" "}
              {dateOnly(review.item.workDate)} ·{" "}
              {timestamp(review.item.checkIn, timezone)} →{" "}
              {timestamp(review.item.checkOut, timezone)}
            </p>
            <label>
              Note
              <textarea name="note" maxLength={500} />
            </label>
          </SaveForm>
        )}
      </Dialog>
    </section>
  );
}

// HR manual attendance: a work date with local clock times. Entries are
// audited with their reason and listed here with source "Manual".
function ManualAttendance({
  s,
  notify,
  refresh,
}: {
  s: Summary;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [page, setPage] = useState(1),
    [formKey, setFormKey] = useState(0);
  const list = useQuery({
    queryKey: ["time", "attendance", "manual", page],
    queryFn: () =>
      api<Page<Attendance>>(
        `time/attendance?${new URLSearchParams({ scope: "company", source: "Manual", page: String(page), from: addDaysText(s.today, -90), to: s.today })}`,
      ),
  });
  return (
    <div className="grid gap-6">
      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Add manual attendance</h2>
        <p className="muted mb-4">
          Times are in {s.timezone}. A check-out earlier than the check-in is
          treated as the next day (night shift). The reason is kept in the audit
          trail.
        </p>
        <SaveForm
          key={formKey}
          label="Save attendance"
          onSave={async (f) => {
            await api("time/attendance", {
              method: "POST",
              body: JSON.stringify({
                employeeId: f.get("employeeId"),
                workDate: f.get("workDate"),
                checkIn: f.get("checkIn"),
                checkOut: f.get("checkOut"),
                reason: f.get("reason"),
              }),
            });
            notify("Manual attendance saved.");
            setFormKey((k) => k + 1);
            await refresh();
          }}
        >
          <EmployeePicker />
          <div className="form-grid">
            <label>
              Work date *
              <input
                type="date"
                name="workDate"
                required
                max={s.today}
                defaultValue={s.today}
              />
            </label>
            <label>
              Check in *
              <input type="time" name="checkIn" required />
            </label>
            <label>
              Check out *
              <input type="time" name="checkOut" required />
            </label>
          </div>
          <label>
            Reason *
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              placeholder="For example: biometric device offline, confirmed by manager"
            />
          </label>
        </SaveForm>
      </section>
      <section className="card">
        <div className="card-title">
          <h2>Manual entries · last 90 days</h2>
        </div>
        <Notice error={list.error} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Check in</th>
                <th>Check out</th>
                <th>Hours</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.employee ? personName(a.employee) : "—"}</td>
                  <td>{dateOnly(a.workDate)}</td>
                  <td>{timestamp(a.checkIn, s.timezone)}</td>
                  <td>{timestamp(a.checkOut, s.timezone)}</td>
                  <td>{(a.workedMinutes / 60).toFixed(2)}</td>
                  <td className="max-w-xs break-words">
                    {a.correctionReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.data?.items.length && (
          <div className="empty">
            {list.isLoading ? "Loading…" : "No manual attendance yet."}
          </div>
        )}
        <Pager data={list.data} page={page} setPage={setPage} />
      </section>
    </div>
  );
}
const addDaysText = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type RosterRowData = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  shift: { id: string; name: string } | null;
  entries: {
    workDate: string;
    shiftId: string | null;
    weeklyOff: boolean;
  }[];
};
const mondayOf = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return addDaysText(day, -((d.getUTCDay() + 6) % 7));
};
const weekdayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
// Weekly shift plan. Each cell is the default shift, a specific shift or a
// weekly off; punches use the plan for their work date.
function Rosters({
  me,
  s,
  notify,
}: {
  me: Me;
  s: Summary;
  notify: (message: string) => void;
}) {
  const canEdit = me.permissions.includes("time.configure");
  const client = useQueryClient();
  const [week, setWeek] = useState(mondayOf(s.today)),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [changes, setChanges] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDaysText(week, i));
  const list = useQuery({
    queryKey: ["time", "rosters", week, page, search],
    queryFn: () =>
      api<Page<RosterRowData>>(
        `time/rosters?${new URLSearchParams({ from: days[0], to: days[6], page: String(page), search })}`,
      ),
  });
  const shifts = s.shifts.filter((x) => x.active);
  const cellKey = (employeeId: string, day: string) => `${employeeId}|${day}`;
  const current = (r: RosterRowData, day: string) => {
    const changed = changes[cellKey(r.id, day)];
    if (changed !== undefined) return changed;
    const entry = r.entries.find((x) => x.workDate === day);
    return entry ? (entry.weeklyOff ? "OFF" : (entry.shiftId ?? "")) : "";
  };
  const set = (employeeId: string, day: string, value: string) =>
    setChanges((c) => ({ ...c, [cellKey(employeeId, day)]: value }));
  const pending = Object.keys(changes).length;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const entries = Object.entries(changes).map(([key, value]) => {
        const [employeeId, workDate] = key.split("|");
        return {
          employeeId,
          workDate,
          shiftId: value && value !== "OFF" ? value : null,
          weeklyOff: value === "OFF",
        };
      });
      for (let i = 0; i < entries.length; i += 500)
        await api("time/rosters", {
          method: "PUT",
          body: JSON.stringify({ entries: entries.slice(i, i + 500) }),
        });
      setChanges({});
      notify("Roster saved.");
      await client.invalidateQueries({ queryKey: ["time"] });
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="toolbar">
        <Button
          variant="outline"
          size="sm"
          disabled={!!pending}
          onClick={() => setWeek(addDaysText(week, -7))}
        >
          Previous week
        </Button>
        <strong>
          {days[0]} to {days[6]}
        </strong>
        <Button
          variant="outline"
          size="sm"
          disabled={!!pending}
          onClick={() => setWeek(addDaysText(week, 7))}
        >
          Next week
        </Button>
        <label>
          Search
          <input
            value={search}
            maxLength={100}
            disabled={!!pending}
            placeholder="Name or employee ID"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {canEdit && (
          <Button disabled={busy || !pending} onClick={save}>
            {busy
              ? "Saving…"
              : `Save ${pending || ""} change${pending === 1 ? "" : "s"}`}
          </Button>
        )}
        {canEdit && !!pending && (
          <Button variant="outline" onClick={() => setChanges({})}>
            Discard
          </Button>
        )}
      </div>
      <Notice error={error ?? list.error} />
      <p className="muted text-xs px-6">
        "Default" uses the employee's assigned shift and the company working
        days. A rostered shift makes the day a working day; a weekly off makes
        it an off day, where any attendance counts as overtime.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {days.map((d) => (
                <th key={d}>{weekdayLabel(d)}</th>
              ))}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="font-semibold">{`${r.firstName} ${r.lastName}`}</div>
                  <span className="muted text-xs">
                    {r.employeeCode} · default {r.shift?.name ?? "no shift"}
                  </span>
                </td>
                {days.map((d) => (
                  <td key={d}>
                    <select
                      aria-label={`${r.firstName} ${r.lastName} ${d}`}
                      value={current(r, d)}
                      disabled={!canEdit}
                      onChange={(e) => set(r.id, d, e.target.value)}
                    >
                      <option value="">Default</option>
                      {shifts.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                      <option value="OFF">Weekly off</option>
                    </select>
                  </td>
                ))}
                {canEdit && (
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        days
                          .slice(1)
                          .forEach((d) => set(r.id, d, current(r, days[0])))
                      }
                    >
                      Repeat Monday
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.data?.items.length && (
        <div className="empty">
          {list.isLoading ? "Loading…" : "No employees found."}
        </div>
      )}
      {!pending && <Pager data={list.data} page={page} setPage={setPage} />}
    </section>
  );
}

export function AttendancePage({ me, notify }: Props) {
  const client = useQueryClient(),
    summary = useSummary();
  const canRead = me.permissions.includes("attendance.read"),
    canManage = me.permissions.includes("attendance.manage"),
    canSelf = me.permissions.includes("attendance.self");
  const [view, setView] = useState(canRead ? "daily" : "own"),
    [branchId, setBranchId] = useState(""),
    [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const [date, setDate] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<Error | null>(null),
    [edit, setEdit] = useState<Attendance | "new" | null>(null),
    [geoRecord, setGeoRecord] = useState<Attendance | null>(null),
    [importing, setImporting] = useState(false),
    [missing, setMissing] = useState(false);
  const s = summary.data,
    daily = view === "daily",
    requests = view === "requests",
    manual = view === "manual",
    rosters = view === "rosters",
    devices = view === "devices",
    face = view === "face";
  const query = new URLSearchParams({
    scope: view === "own" ? "own" : "company",
    page: String(page),
    search,
  });
  if (from) query.set("from", from);
  if (branchId && view !== "own") query.set("branchId", branchId);
  if (to) query.set("to", to);
  if (s) query.set("date", date || s.today);
  const list = useQuery({
    queryKey: ["time", "attendance", view, query.toString()],
    queryFn: () =>
      api<Page<Attendance & RosterRow>>(
        `time/${daily ? "roster" : "attendance"}?${query}`,
      ),
    enabled:
      !!s &&
      !requests &&
      !manual &&
      !rosters &&
      !devices &&
      !face &&
      (view !== "own" || !!s.employee),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["time"] });
  };
  async function punch() {
    if (!s) return;
    setBusy(true);
    setActionError(null);
    try {
      notify(punchedText(await markAttendance(s)));
      await refresh();
    } catch (e) {
      setActionError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  if (summary.error) return <Notice error={summary.error} />;
  if (!s) return <div className="empty">Loading attendance…</div>;
  const timezone = s.timezone;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Time & presence</div>
          <h1>Attendance</h1>
          {me.permissions.includes("ai.reports") && (
            <Link
              className="text-blue-700 underline"
              href="/hr-copilot?report=attendance"
            >
              AI Summary
            </Link>
          )}
          <p>
            Check in, review daily presence, and track working hours ·{" "}
            {timezone}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setImporting(true)}>
              Import device CSV
            </Button>
            <Button
              onClick={() => {
                setView("manual");
                setPage(1);
              }}
            >
              <Plus />
              Add attendance
            </Button>
          </div>
        )}
      </div>
      <Notice error={actionError} />
      {canSelf && (
        <section className="card p-6 mb-6 flex flex-wrap gap-6 items-center justify-between">
          <div>
            <p className="eyebrow mb-2">My attendance · {s.today}</p>
            <h2 className="text-lg font-semibold">
              {s.open
                ? `Checked in at ${timestamp(s.open.checkIn, timezone)}`
                : s.current?.checkOut
                  ? "Today’s attendance is complete"
                  : "Ready to start your day?"}
            </h2>
            <p className="muted mt-2">
              {s.employee
                ? `${s.employee.shift?.active ? s.employee.shift.name : "No shift assigned"} · ${s.employee.branch?.name || "No work location assigned"} · ${s.employee.attendanceMode === "OPEN" ? "Open attendance anywhere" : s.employee.attendanceMode === "GPS" ? "GPS attendance anywhere" : s.employee.attendanceMode === "GEOFENCE" ? "Assigned geofence required" : s.employeePolicy.geofenceEnabled ? "GPS attendance area enabled" : s.employeePolicy.gpsTrackingEnabled ? "GPS tracking enabled" : "Location is not required"}`
                : "Ask HR to link your account to an active employee record."}
            </p>
            {(s.employeePolicy.geofenceEnabled ||
              s.employeePolicy.gpsTrackingEnabled) && (
              <p className="text-sm muted mt-2">
                Pressing check in/out requests your current GPS location and
                saves it with attendance. You and authorized attendance managers
                can view it. Tracking stops after each event.
              </p>
            )}
            {s.open && dateOnly(s.open.workDate) !== s.today && (
              <p className="text-sm mt-2">
                Open attendance from {dateOnly(s.open.workDate)}. Check out to
                close it.
              </p>
            )}
          </div>
          {faceMode(s) && s.employee ? (
            <div>
              <FaceScan
                s={s}
                onError={setActionError}
                onDone={async (saved) => {
                  setActionError(null);
                  notify(punchedText(saved));
                  await refresh();
                }}
              />
              <p className="muted mt-2">
                First verified scan checks in. Later scans update today’s
                check-out.
              </p>
            </div>
          ) : (
            <Button
              disabled={busy || !s.employee || (!s.open && !!s.current)}
              onClick={punch}
            >
              <Clock3 />
              {busy ? "Please wait…" : s.open ? "Check out" : "Check in"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!s.employee}
            onClick={() => setMissing(true)}
          >
            Missed punch?
          </Button>
        </section>
      )}
      <FieldTracking
        me={me}
        enabled={
          s.policy.fieldTrackingEnabled && !!s.employee?.fieldTrackingAllowed
        }
        employeeId={s.employee?.id}
        intervalSeconds={s.policy.fieldTrackingIntervalSeconds}
      />
      <div className="section-tabs">
        {[
          ...(canRead
            ? [
                ["daily", "Daily register"],
                ["company", "Company records"],
              ]
            : []),
          ...(canSelf ? [["own", "My records"]] : []),
          ...(canSelf || canManage ? [["requests", "Missed punches"]] : []),
          ...(canManage ? [["manual", "Manual attendance"]] : []),
          ...(canRead ? [["rosters", "Rosters"]] : []),
          ...(canRead && me.subscription?.plan.features.includes("biometric")
            ? [["devices", "Devices"]]
            : []),
          ...(canManage && me.subscription?.plan.features.includes("face")
            ? [["face", "Face"]]
            : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={view === key ? "active" : ""}
            onClick={() => {
              setView(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {face ? (
        <FaceAdmin notify={notify} />
      ) : devices ? (
        <BiometricDevices me={me} notify={notify} />
      ) : rosters ? (
        <Rosters me={me} s={s} notify={notify} />
      ) : manual ? (
        <ManualAttendance s={s} notify={notify} refresh={refresh} />
      ) : requests ? (
        <Regularizations
          me={me}
          notify={notify}
          timezone={timezone}
          refresh={refresh}
        />
      ) : (
        <>
          <section className="card">
            <div className="toolbar">
              {daily ? (
                <label>
                  Date
                  <input
                    type="date"
                    value={date || s.today}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              ) : (
                <>
                  <label>
                    From
                    <input
                      type="date"
                      value={from || s.today.slice(0, 7) + "-01"}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={to || s.today}
                      onChange={(e) => {
                        setTo(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                </>
              )}
              {view !== "own" && (
                <label>
                  Work location
                  <select
                    value={branchId}
                    onChange={(event) => {
                      setBranchId(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All locations</option>
                    {s.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                  <span className="muted text-xs">
                    Based on current employee assignment
                  </span>
                </label>
              )}
              {view !== "own" && (
                <label>
                  Search employee
                  <input
                    value={search}
                    placeholder="Name or code"
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!list.data?.items.length}
                onClick={() => {
                  const rows = daily
                    ? [
                        [
                          "Employee code",
                          "Name",
                          "Date",
                          "Status",
                          "Check in",
                          "Check out",
                        ],
                        ...(list.data?.items ?? []).map((r) => [
                          r.employeeCode,
                          personName(r),
                          date || s.today,
                          r.status,
                          r.attendance?.checkIn ?? "",
                          r.attendance?.checkOut ?? "",
                        ]),
                      ]
                    : [
                        [
                          "Employee code",
                          "Date",
                          "Check in",
                          "Check out",
                          "Worked minutes",
                          "Late minutes",
                          "Overtime minutes",
                          "Source",
                        ],
                        ...(list.data?.items ?? []).map((r) => [
                          r.employee?.employeeCode ?? "",
                          dateOnly(r.workDate),
                          r.checkIn,
                          r.checkOut ?? "",
                          String(r.workedMinutes),
                          String(r.lateMinutes),
                          String(r.overtimeMinutes),
                          r.source,
                        ]),
                      ];
                  downloadCsv(rows, `attendance-page-${page}.csv`);
                }}
              >
                <Download />
                Export this page
              </Button>
            </div>
            <Notice error={list.error} />
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(daily
                      ? [
                          "Employee",
                          "Status",
                          "Shift",
                          "Check in",
                          "Check out",
                          "Worked",
                          "GPS",
                          "Actions",
                        ]
                      : [
                          "Employee",
                          "Work date",
                          "Status",
                          "Check in",
                          "Check out",
                          "Worked",
                          "Late",
                          "Early exit",
                          "Overtime",
                          "Source",
                          "GPS",
                          "Actions",
                        ]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data?.items.map((row) => {
                    const a = daily ? row.attendance : row,
                      e = daily ? row : row.employee!;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="font-semibold">{personName(e)}</div>
                          <span className="muted text-xs">
                            {e.employeeCode}
                          </span>
                        </td>
                        {daily ? (
                          <>
                            <td>
                              <span
                                className={`badge ${["Present", "Checked in"].includes(row.status) ? "positive" : ""}`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td>{row.shift?.active ? row.shift.name : "—"}</td>
                          </>
                        ) : (
                          <>
                            <td>{dateOnly(row.workDate)}</td>
                            <td>
                              <span
                                className={`badge ${["PRESENT"].includes(row.status) && row.checkOut ? "positive" : ["HALF_DAY", "SHORT", "PENDING_REVIEW"].includes(row.status) ? "amber" : ""}`}
                              >
                                {dayStatusLabel(row)}
                              </span>
                            </td>
                          </>
                        )}
                        <td>{timestamp(a?.checkIn ?? null, timezone)}</td>
                        <td>{timestamp(a?.checkOut ?? null, timezone)}</td>
                        <td>{a?.checkOut ? minutes(a.workedMinutes) : "—"}</td>
                        {!daily && (
                          <>
                            <td>{minutes(row.lateMinutes)}</td>
                            <td>{minutes(row.earlyExitMinutes)}</td>
                            <td>
                              {minutes(row.overtimeMinutes)}
                              {row.overtimeStatus !== "NONE" && (
                                <p className="muted text-xs mt-1">
                                  {row.overtimeStatus === "PENDING"
                                    ? "Awaiting approval"
                                    : row.overtimeStatus === "APPROVED"
                                      ? `Approved ${minutes(row.approvedOvertimeMinutes)}`
                                      : "Rejected"}
                                </p>
                              )}
                              {canManage &&
                                row.overtimeStatus === "PENDING" && (
                                  <div className="flex gap-1 mt-1">
                                    {(["APPROVED", "REJECTED"] as const).map(
                                      (status) => (
                                        <Button
                                          key={status}
                                          size="sm"
                                          variant="outline"
                                          onClick={async () => {
                                            try {
                                              await api(
                                                `time/overtime/${row.id}`,
                                                {
                                                  method: "PUT",
                                                  body: JSON.stringify({
                                                    status,
                                                  }),
                                                },
                                              );
                                              notify(
                                                status === "APPROVED"
                                                  ? "Overtime approved."
                                                  : "Overtime rejected.",
                                              );
                                              await refresh();
                                            } catch (e) {
                                              setActionError(e as Error);
                                            }
                                          }}
                                        >
                                          {status === "APPROVED"
                                            ? "Approve"
                                            : "Reject"}
                                        </Button>
                                      ),
                                    )}
                                  </div>
                                )}
                            </td>
                            <td>
                              {row.source}
                              {row.correctionReason && (
                                <p className="muted text-xs mt-1">
                                  {row.correctionReason}
                                </p>
                              )}
                            </td>
                          </>
                        )}
                        <td>
                          {a && (a.checkInLocation || a.checkOutLocation) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setGeoRecord({ ...a, employee: e })
                              }
                            >
                              <MapPin />
                              View GPS
                            </Button>
                          ) : (
                            <span className="muted text-xs">Not recorded</span>
                          )}
                        </td>
                        <td>
                          {canManage && a && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEdit({ ...a, employee: e })}
                            >
                              Correct
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.isLoading && <div className="empty">Loading attendance…</div>}
            {!list.isLoading && !list.data?.items.length && (
              <div className="empty">
                No attendance records for this selection.
              </div>
            )}
            <Pager data={list.data} page={page} setPage={setPage} />
          </section>
          {!daily && list.data?.totals && (
            <p className="muted mt-4">
              Totals for the full selected range:{" "}
              {minutes(list.data.totals.workedMinutes ?? 0)} worked ·{" "}
              {minutes(list.data.totals.lateMinutes ?? 0)} late ·{" "}
              {minutes(list.data.totals.overtimeMinutes ?? 0)} overtime
            </p>
          )}
        </>
      )}
      <Dialog
        open={missing}
        onOpenChange={setMissing}
        title="Missed punch request"
        description="Tell HR the times you actually worked and why the punch was missed. Once HR approves, your attendance is updated automatically."
      >
        {missing && (
          <SaveForm
            label="Submit request"
            onSave={async (f) => {
              await api("time/regularizations", {
                method: "POST",
                body: JSON.stringify({
                  workDate: f.get("workDate"),
                  ...(f.get("checkIn") ? { checkIn: f.get("checkIn") } : {}),
                  checkOut: f.get("checkOut"),
                  reason: f.get("reason"),
                }),
              });
              setMissing(false);
              notify("Missed punch request sent to HR for approval.");
              await refresh();
            }}
          >
            <MissedPunchFields s={s} />
          </SaveForm>
        )}
      </Dialog>
      <Dialog
        open={!!geoRecord}
        onOpenChange={(open) => {
          if (!open) setGeoRecord(null);
        }}
        title="Attendance GPS locations"
        description={
          geoRecord?.employee
            ? `${personName(geoRecord.employee)} · ${dateOnly(geoRecord.workDate)}`
            : "Check-in and check-out locations"
        }
      >
        {geoRecord && (
          <div className="space-y-4">
            <AttendanceLocationCard
              label="Check-in location"
              location={geoRecord.checkInLocation}
              time={timestamp(geoRecord.checkIn, timezone)}
            />
            <AttendanceLocationCard
              label="Check-out location"
              location={geoRecord.checkOutLocation}
              time={
                geoRecord.checkOut
                  ? timestamp(geoRecord.checkOut, timezone)
                  : "Not checked out"
              }
            />
            <p className="text-xs muted">
              These are device-reported positions captured at attendance events.
              Opening a map shares the selected coordinates with Google Maps.
            </p>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add attendance" : "Correct attendance"}
        description="Enter actual times with an explicit time-zone offset, for example 2026-09-23T09:00:00+05:30. A reason is required and recorded in the audit trail."
      >
        {edit && (
          <SaveForm
            key={typeof edit === "string" ? edit : edit.id}
            onSave={async (f) => {
              await api(
                `time/attendance${edit !== "new" ? "/" + edit.id : ""}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    employeeId: f.get("employeeId"),
                    checkIn: f.get("checkIn"),
                    checkOut: f.get("checkOut"),
                    reason: f.get("reason"),
                  }),
                },
              );
              setEdit(null);
              notify("Attendance saved.");
              await refresh();
            }}
          >
            {edit === "new" ? (
              <EmployeePicker />
            ) : (
              <>
                <input
                  type="hidden"
                  name="employeeId"
                  value={edit.employeeId}
                />
                <p>{edit.employee ? personName(edit.employee) : "Employee"}</p>
              </>
            )}
            <label>
              Check in *
              <input
                name="checkIn"
                required
                defaultValue={edit === "new" ? "" : edit.checkIn}
                placeholder="YYYY-MM-DDTHH:mm:ss+05:30"
              />
            </label>
            <label>
              Check out *
              <input
                name="checkOut"
                required
                defaultValue={edit === "new" ? "" : (edit.checkOut ?? "")}
                placeholder="YYYY-MM-DDTHH:mm:ss+05:30"
              />
            </label>
            <label>
              Reason *
              <textarea name="reason" required minLength={5} maxLength={500} />
            </label>
          </SaveForm>
        )}
      </Dialog>
      <Dialog
        open={importing}
        onOpenChange={setImporting}
        title="Import biometric/device attendance"
        description="Upload a normalized CSV of completed daily sessions. This does not connect to a device directly. Up to 100 rows; the entire import is rejected if any row conflicts."
      >
        <SaveForm
          label="Import attendance"
          onSave={async (f) => {
            const file = f.get("file") as File;
            if (!file?.size || file.size > 50000)
              throw new Error("Choose a CSV file under 50 KB.");
            const result = await api<{ imported: number }>("time/import", {
              method: "POST",
              body: JSON.stringify({
                csv: await file.text(),
                reason: f.get("reason"),
              }),
            });
            notify(`Imported ${result.imported} attendance records.`);
            setImporting(false);
            await refresh();
          }}
        >
          <p className="text-xs muted break-all">
            Header: employeeCode,checkIn,checkOut
            <br />
            Times must include seconds and a UTC offset. Use unquoted values and
            your employee codes. Existing records are never overwritten.
          </p>
          <label>
            CSV file *
            <input name="file" type="file" accept=".csv,text/csv" required />
          </label>
          <label>
            Import reason / device *
            <input name="reason" required minLength={5} maxLength={500} />
          </label>
        </SaveForm>
      </Dialog>
    </>
  );
}

export function LeavePage({ me, notify }: Props) {
  const summary = useSummary(),
    client = useQueryClient();
  const canReview = me.permissions.includes("timeoff.manage"),
    canSelf = me.permissions.includes("timeoff.self"),
    canTeam = me.permissions.includes("timeoff.team.read");
  const [halfDay, setHalfDay] = useState(false);
  const [scope, setScope] = useState(canReview ? "company" : "own"),
    [page, setPage] = useState(1),
    [requesting, setRequesting] = useState(false);
  const [review, setReview] = useState<{ item: Leave; status: string } | null>(
      null,
    ),
    [year, setYear] = useState("");
  const s = summary.data;
  const list = useQuery({
    queryKey: ["time", "leave", scope, page],
    queryFn: () => api<Page<Leave>>(`time/leave?scope=${scope}&page=${page}`),
    enabled: !!s && (scope !== "own" || !!s.employee),
  });
  const balance = useQuery({
    queryKey: ["time", "balances", year || s?.today.slice(0, 4)],
    queryFn: () =>
      api<LeaveBalance[]>(`time/balances?year=${year || s!.today.slice(0, 4)}`),
    enabled: !!s?.employee && canSelf,
  });
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["time"] });
  }
  if (summary.error) return <Notice error={summary.error} />;
  if (!s) return <div className="empty">Loading leave…</div>;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Time off</div>
          <h1>Leave & holidays</h1>
          <p>Request leave, review approvals, and see company holidays.</p>
        </div>
        {canSelf && (
          <Button
            disabled={!s.employee || !s.leaveTypes.some((t) => t.active)}
            onClick={() => setRequesting(true)}
          >
            <Plus />
            Request leave
          </Button>
        )}
      </div>
      {canSelf && (
        <section className="mb-6">
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <h2 className="font-semibold">My leave balances</h2>
            <label>
              Calendar year
              <input
                className="max-w-28"
                type="number"
                min="2000"
                max="2200"
                value={year || s.today.slice(0, 4)}
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
          </div>
          <Notice error={balance.error} />
          <div className="stat-grid">
            {balance.data?.map((b) => (
              <div className="card stat" key={b.id}>
                <div className="stat-label">
                  {b.name} · {b.paid ? "Paid" : "Unpaid"}
                </div>
                <div className="stat-value">
                  {b.paid ? b.remaining : b.approved}
                  <span className="text-sm muted">
                    {b.paid ? " days left" : " days taken"}
                  </span>
                </div>
                <p className="muted text-xs">
                  {b.compOff
                    ? `${b.compOffEarned} earned${b.lapsed ? ` · ${b.lapsed} lapsed` : ""}`
                    : b.paid
                      ? `${b.accrued} ${b.accrual === "MONTHLY" ? "accrued" : "entitled"}${b.carriedForward ? ` · ${b.carriedForward} carried` : ""}${b.adjusted ? ` · ${b.adjusted > 0 ? "+" : ""}${b.adjusted} adjusted` : ""}${b.encashed ? ` · ${b.encashed} encashed` : ""}`
                      : "Unpaid, no balance limit"}{" "}
                  · {b.approved} approved · {b.pending} pending
                </p>
              </div>
            ))}
          </div>
          {!s.leaveTypes.length && (
            <p className="muted">
              HR must configure leave types and annual allowances before
              requests can be submitted.
            </p>
          )}
          {!s.employee && (
            <p className="muted">
              Ask HR to link your account to an active employee record.
            </p>
          )}
          <p className="muted text-xs">
            Pending leave reserves balance. Company working days, holidays and
            your chosen optional holidays determine charged days. Monthly
            accrual, carry-forward, adjustments and encashment are included.
          </p>
        </section>
      )}
      <div className="section-tabs">
        {[
          ...(canReview ? [["company", "Approval inbox"]] : []),
          ...(canTeam ? [["team", "My team"]] : []),
          ...(canSelf ? [["own", "My requests"]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={scope === key ? "active" : ""}
            onClick={() => {
              setScope(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="card">
        <Notice error={list.error} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Employee",
                  "Leave type",
                  "Dates",
                  "Days",
                  "Reason",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {personName(r.employee)}
                    <p className="muted text-xs">{r.employee.employeeCode}</p>
                  </td>
                  <td>{r.leaveType.name}</td>
                  <td>
                    {dateOnly(r.startDate)} → {dateOnly(r.endDate)}
                    {r.halfDay && (
                      <p className="muted text-xs">
                        {r.session === "SECOND" ? "Second" : "First"} half
                      </p>
                    )}
                  </td>
                  <td>{r.days}</td>
                  <td className="max-w-xs whitespace-normal break-words">
                    {r.reason}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.status === "Approved" ? "positive" : ""}`}
                    >
                      {r.status}
                    </span>
                    {r.status === "Pending" && (r.level ?? 1) > 1 && (
                      <p className="muted text-xs mt-1">
                        Manager approved · awaiting HR
                      </p>
                    )}
                    {r.reviewNote && (
                      <p className="muted mt-1">{r.reviewNote}</p>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-2 flex-wrap">
                      {(canReview ||
                        (scope === "team" &&
                          (r.level ?? 1) === 1 &&
                          (r.leaveType.approvalLevels ?? 1) > 1)) &&
                        r.status === "Pending" &&
                        r.employee.userId !== me.userId && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                setReview({ item: r, status: "Approved" })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setReview({ item: r, status: "Rejected" })
                              }
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      {["Pending", "Approved"].includes(r.status) &&
                        (canReview || r.employee.userId === me.userId) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setReview({ item: r, status: "Cancelled" })
                            }
                          >
                            Cancel
                          </Button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.data?.items.length && (
          <div className="empty">
            {list.isLoading ? "Loading requests…" : "No leave requests yet."}
          </div>
        )}
        <Pager data={list.data} page={page} setPage={setPage} />
      </section>
      <section className="card mt-6">
        <div className="card-title">
          <h2 className="flex gap-2 items-center">
            <CalendarDays size={18} />
            Company holidays
          </h2>
        </div>
        <div className="p-6 flex gap-4 flex-wrap">
          {s.holidays.map((h) => (
            <div
              key={h.id}
              className="rounded-lg border border-[var(--border)] p-4"
            >
              <p className="font-semibold">{h.name}</p>
              <p className="muted mt-1">
                {dateOnly(h.date)}
                {h.optional ? " · optional" : ""}
              </p>
            </div>
          ))}
          {!s.holidays.length && (
            <p className="muted">No company holidays configured.</p>
          )}
        </div>
      </section>
      {canSelf && s.employee && <OptionalHolidays notify={notify} />}
      {(canSelf || canReview) && (
        <CompOffPanel
          canSelf={canSelf && !!s.employee}
          canReview={canReview}
          notify={notify}
        />
      )}
      {canReview && (
        <LeaveTools leaveTypes={s.leaveTypes} today={s.today} notify={notify} />
      )}
      <Dialog
        open={requesting}
        onOpenChange={setRequesting}
        title="Request leave"
      >
        <SaveForm
          label="Submit request"
          onSave={async (f) => {
            const half = f.get("halfDay") === "on";
            await api("time/leave", {
              method: "POST",
              body: JSON.stringify({
                leaveTypeId: f.get("leaveTypeId"),
                startDate: f.get("startDate"),
                endDate: half ? f.get("startDate") : f.get("endDate"),
                reason: f.get("reason"),
                halfDay: half,
                session: half ? f.get("session") : null,
              }),
            });
            setRequesting(false);
            setHalfDay(false);
            notify("Leave request submitted for review.");
            await refresh();
          }}
        >
          <label>
            Leave type *
            <select name="leaveTypeId" required>
              <option value="">Select a type</option>
              {s.leaveTypes
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              From *
              <input name="startDate" type="date" required min={s.today} />
            </label>
            {!halfDay && (
              <label>
                To *<input name="endDate" type="date" required min={s.today} />
              </label>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input
              name="halfDay"
              type="checkbox"
              checked={halfDay}
              onChange={(e) => setHalfDay(e.target.checked)}
            />
            Half day
          </label>
          {halfDay && (
            <label>
              Which half *
              <select name="session" required defaultValue="FIRST">
                <option value="FIRST">First half</option>
                <option value="SECOND">Second half</option>
              </select>
            </label>
          )}
          <label>
            Reason *
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <p className="muted text-xs">
            Use one calendar year per request. Weekends and configured holidays
            do not consume leave.
          </p>
        </SaveForm>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(v) => !v && setReview(null)}
        title={`${review?.status === "Approved" ? "Approve" : review?.status === "Rejected" ? "Reject" : "Cancel"} leave`}
      >
        {review && (
          <SaveForm
            label="Confirm"
            onSave={async (f) => {
              await api(`time/leave/${review.item.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  status: review.status,
                  note: f.get("note"),
                }),
              });
              setReview(null);
              notify("Leave request updated.");
              await refresh();
            }}
          >
            <p>
              {personName(review.item.employee)} · {review.item.days} days ·{" "}
              {dateOnly(review.item.startDate)} to{" "}
              {dateOnly(review.item.endDate)}
            </p>
            <label>
              Note
              <textarea name="note" maxLength={500} />
            </label>
          </SaveForm>
        )}
      </Dialog>
    </>
  );
}

export function TimeSettings({ me, notify }: Props) {
  const summary = useSummary(),
    client = useQueryClient();
  const [editor, setEditor] = useState<{
    kind: "shifts" | "holidays" | "leave-types";
    item?: Shift | Holiday | LeaveType;
  } | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const s = summary.data;
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["time"] });
    notify("Time settings saved.");
  }
  if (summary.error) return <Notice error={summary.error} />;
  if (!s) return <div className="empty">Loading time settings…</div>;
  const shift =
    editor?.kind === "shifts" ? (editor.item as Shift | undefined) : undefined;
  const leaveType =
    editor?.kind === "leave-types"
      ? (editor.item as LeaveType | undefined)
      : undefined;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Attendance policy</div>
          <h1>Time settings</h1>
          <p>
            Configure shifts, holidays, leave allowances, and GPS attendance.
          </p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4 flex gap-2 items-center">
            <MapPin size={20} />
            Geo tracking & default attendance area
          </h2>
          <p className="text-sm muted mb-4">
            Each work location can have its own GPS attendance area. The default
            below applies to employees whose location has no area configured.
          </p>
          {me.permissions.includes("organization.read") && (
            <Link
              className="text-blue-700 underline block mb-4"
              href="/organization?tab=branches"
            >
              Manage locations & attendance areas
            </Link>
          )}
          <SaveForm
            key={JSON.stringify(s.policy)}
            onSave={async (f) => {
              await api("time/policy", {
                method: "PUT",
                body: JSON.stringify({
                  gpsTrackingEnabled: f.get("gpsTrackingEnabled") === "on",
                  fieldTrackingEnabled: f.get("fieldTrackingEnabled") === "on",
                  fieldTrackingIntervalSeconds: Number(
                    f.get("fieldTrackingIntervalSeconds"),
                  ),
                  fieldTrackingMaxMinutes: Number(
                    f.get("fieldTrackingMaxMinutes"),
                  ),
                  faceAttendanceEnabled:
                    f.get("faceAttendanceEnabled") === "on",
                  overtimeRequiresApproval:
                    f.get("overtimeRequiresApproval") === "on",
                  faceLivenessRequired: f.get("faceLivenessRequired") === "on",
                  faceConfidenceThreshold: Number(
                    f.get("faceConfidenceThreshold"),
                  ),
                  faceMaxFailedAttempts: Number(
                    f.get("faceMaxFailedAttempts") || 5,
                  ),
                  faceLockoutMinutes: Number(f.get("faceLockoutMinutes") || 15),
                  faceFallback: f.get("faceFallback"),
                  compOffEnabled: f.get("compOffEnabled") === "on",
                  compOffExpiryDays: Number(f.get("compOffExpiryDays") || 90),
                  optionalHolidayLimit: Number(
                    f.get("optionalHolidayLimit") || 0,
                  ),
                  geofenceEnabled: f.get("enabled") === "on",
                  latitude: String(f.get("latitude"))
                    ? Number(f.get("latitude"))
                    : null,
                  longitude: String(f.get("longitude"))
                    ? Number(f.get("longitude"))
                    : null,
                  radiusMeters: Number(f.get("radiusMeters")),
                }),
              });
              await refresh();
            }}
          >
            <label className="flex items-center gap-2">
              <input
                name="gpsTrackingEnabled"
                type="checkbox"
                defaultChecked={s.policy.gpsTrackingEnabled}
              />
              Record GPS at every check-in and check-out
            </label>
            <p className="muted text-sm">
              Captures attendance locations for all employees, including field
              staff outside an office boundary. Location-specific attendance
              boundaries still apply where configured.
            </p>
            <label className="flex items-center gap-2 mt-4">
              <input
                name="fieldTrackingEnabled"
                type="checkbox"
                defaultChecked={s.policy.fieldTrackingEnabled}
              />
              Allow consent-based live field tracking
            </label>
            <p className="muted text-sm">
              Employees must be checked in and explicitly start a session. GPS
              points are collected only during the active session and expire
              automatically.
            </p>
            <div className="form-grid">
              <label>
                Update interval (seconds)
                <input
                  name="fieldTrackingIntervalSeconds"
                  type="number"
                  min="15"
                  max="300"
                  required
                  defaultValue={s.policy.fieldTrackingIntervalSeconds}
                />
              </label>
              <label>
                Maximum session (minutes)
                <input
                  name="fieldTrackingMaxMinutes"
                  type="number"
                  min="15"
                  max="1440"
                  required
                  defaultValue={s.policy.fieldTrackingMaxMinutes}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 mt-4">
              <input
                name="overtimeRequiresApproval"
                type="checkbox"
                defaultChecked={s.policy.overtimeRequiresApproval ?? true}
              />
              Overtime needs HR approval before it counts
            </label>
            <label className="flex items-center gap-2">
              <input
                name="faceAttendanceEnabled"
                type="checkbox"
                defaultChecked={s.policy.faceAttendanceEnabled}
              />
              Require face registration and matching for all employees
            </label>
            <label className="flex items-center gap-2">
              <input
                name="faceLivenessRequired"
                type="checkbox"
                checked
                readOnly
              />
              Require liveness verification
            </label>
            <label>
              Minimum face confidence (0.5–0.99)
              <input
                name="faceConfidenceThreshold"
                type="number"
                min="0.5"
                max="0.99"
                step="0.01"
                required
                defaultValue={s.policy.faceConfidenceThreshold}
              />
            </label>
            <label>
              Failed face scans before lockout
              <input
                name="faceMaxFailedAttempts"
                type="number"
                min="1"
                max="20"
                defaultValue={s.faceRules?.maxFailed ?? 5}
              />
            </label>
            <label>
              Lockout minutes
              <input
                name="faceLockoutMinutes"
                type="number"
                min="1"
                max="1440"
                defaultValue={s.faceRules?.lockoutMinutes ?? 15}
              />
            </label>
            <label>
              When face cannot be used
              <select
                name="faceFallback"
                defaultValue={s.faceRules?.fallback ?? "NONE"}
              >
                <option value="NONE">
                  Face required (missed punch request or HR entry)
                </option>
                <option value="WEB">
                  Allow web/GPS attendance, labelled face fallback
                </option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={s.policy.geofenceEnabled}
              />
              Require GPS inside the attendance area
            </label>
            <div className="form-grid mt-4">
              <label className="flex items-center gap-2">
                <input
                  name="compOffEnabled"
                  type="checkbox"
                  defaultChecked={!!s.policy.compOffEnabled}
                />
                Compensatory off for work on weekly offs and holidays
              </label>
              <label>
                Comp-off expires after (days)
                <input
                  name="compOffExpiryDays"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={s.policy.compOffExpiryDays ?? 90}
                />
              </label>
              <label>
                Optional holidays per employee a year
                <input
                  name="optionalHolidayLimit"
                  type="number"
                  min="0"
                  max="30"
                  defaultValue={s.policy.optionalHolidayLimit ?? 0}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Latitude
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  defaultValue={s.policy.latitude ?? ""}
                />
              </label>
              <label>
                Longitude
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  defaultValue={s.policy.longitude ?? ""}
                />
              </label>
            </div>
            <label>
              Radius (meters) *
              <input
                name="radiusMeters"
                type="number"
                required
                min="50"
                max="10000"
                defaultValue={s.policy.radiusMeters}
              />
            </label>
            <p className="muted text-xs">
              Location is collected only when the employee presses check in/out
              and GPS tracking or an attendance area is enabled. Browser GPS is
              not a biometric identity check.
            </p>
          </SaveForm>
        </section>
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Assign employee shift</h2>
          <SaveForm
            onSave={async (f) => {
              await api("time/assign-shift", {
                method: "PUT",
                body: JSON.stringify({
                  employeeId: f.get("employeeId"),
                  shiftId: f.get("shiftId") || null,
                }),
              });
              await refresh();
            }}
          >
            <EmployeePicker />
            <label>
              Shift
              <select name="shiftId">
                <option value="">No shift</option>
                {s.shifts
                  .filter((t) => t.active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {clockTime(t.startMinute)}–
                      {clockTime(t.endMinute)}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted text-xs">
              Assignments affect new punches. Existing records retain their
              shift snapshot. Company timezone: {s.timezone}.
            </p>
          </SaveForm>
          <p className="mt-4 text-xs muted">
            Working weekdays are configured in{" "}
            <Link className="underline" href="/company">
              Company settings
            </Link>
            .
          </p>
        </section>
      </div>
      {(["shifts", "leave-types", "holidays"] as const).map((kind) => {
        const items =
          kind === "shifts"
            ? s.shifts
            : kind === "holidays"
              ? s.holidays
              : s.leaveTypes;
        return (
          <section key={kind} className="card mt-6">
            <div className="card-title">
              <h2>
                {kind === "shifts"
                  ? "Shifts"
                  : kind === "holidays"
                    ? "Holidays"
                    : "Leave types & annual allowances"}
              </h2>
              <div className="flex gap-2">
                {kind === "leave-types" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const r = await api<{ added: string[] }>(
                          "time/leave-types/defaults",
                          { method: "POST" },
                        );
                        notify(
                          r.added.length
                            ? `Added: ${r.added.join(", ")}.`
                            : "All standard leave types already exist.",
                        );
                        await refresh();
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    Add standard types
                  </Button>
                )}
                <Button size="sm" onClick={() => setEditor({ kind })}>
                  <Plus />
                  Add
                </Button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Details</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>
                        {"startMinute" in item
                          ? `${clockTime(item.startMinute)}–${clockTime(item.endMinute)}${item.endMinute < item.startMinute ? " (overnight)" : ""} · ${item.breakMinutes}m break · ${item.graceMinutes}m grace${item.active ? "" : " · Inactive"}`
                          : "annualDays" in item
                            ? `${item.annualDays} days/year · ${item.paid ? "Paid" : "Unpaid"}${item.active ? "" : " · Inactive"}`
                            : dateOnly(item.date)}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditor({ kind, item })}
                          >
                            Edit
                          </Button>
                          {"date" in item && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleting(item)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!items.length && (
              <div className="empty">
                No {kind.replace("-", " ")} configured. Add your company’s
                policy to get started.
              </div>
            )}
          </section>
        );
      })}
      <Dialog
        open={!!editor}
        onOpenChange={(v) => !v && setEditor(null)}
        title={`${editor?.item ? "Edit" : "Add"} ${editor?.kind === "leave-types" ? "leave type" : editor?.kind === "shifts" ? "shift" : "holiday"}`}
      >
        {editor && (
          <SaveForm
            key={editor.kind + (editor.item?.id ?? "new")}
            onSave={async (f) => {
              const body =
                editor.kind === "shifts"
                  ? {
                      name: f.get("name"),
                      kind: f.get("kind"),
                      startMinute: timeValue(f.get("start")),
                      endMinute: timeValue(f.get("end")),
                      splitStartMinute:
                        f.get("kind") === "SPLIT" && f.get("splitStart")
                          ? timeValue(f.get("splitStart"))
                          : null,
                      splitEndMinute:
                        f.get("kind") === "SPLIT" && f.get("splitEnd")
                          ? timeValue(f.get("splitEnd"))
                          : null,
                      graceMinutes: Number(f.get("graceMinutes")),
                      breakMinutes: Number(f.get("breakMinutes")),
                      minimumMinutes: optionalNumber(f.get("minimumMinutes")),
                      halfDayMinutes: optionalNumber(f.get("halfDayMinutes")),
                      earlyExitGraceMinutes: Number(
                        f.get("earlyExitGraceMinutes") || 0,
                      ),
                      overtimeAfterMinutes: Number(
                        f.get("overtimeAfterMinutes") || 0,
                      ),
                      active: f.get("active") === "on",
                    }
                  : editor.kind === "holidays"
                    ? {
                        name: f.get("name"),
                        date: f.get("date"),
                        optional: f.get("optional") === "on",
                      }
                    : {
                        name: f.get("name"),
                        annualDays: Number(f.get("annualDays")),
                        paid: f.get("paid") === "on",
                        active: f.get("active") === "on",
                        accrual: f.get("accrual"),
                        carryForwardMax: Number(f.get("carryForwardMax") || 0),
                        encashable: f.get("encashable") === "on",
                        encashMax: Number(f.get("encashMax") || 0),
                        halfDayAllowed: f.get("halfDayAllowed") === "on",
                        approvalLevels: Number(f.get("approvalLevels") || 1),
                        compOff: f.get("compOff") === "on",
                      };
              await api(
                `time/${editor.kind}${editor.item ? "/" + editor.item.id : ""}`,
                {
                  method: editor.item ? "PUT" : "POST",
                  body: JSON.stringify(body),
                },
              );
              setEditor(null);
              await refresh();
            }}
          >
            <label>
              Name *
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={editor.item?.name ?? ""}
              />
            </label>
            {editor.kind === "shifts" ? (
              <>
                <label>
                  Shift type *
                  <select name="kind" defaultValue={shift?.kind ?? "FIXED"}>
                    <option value="FIXED">
                      Fixed (day or night; end before start = overnight)
                    </option>
                    <option value="FLEXIBLE">
                      Flexible (minimum hours, no late mark)
                    </option>
                    <option value="SPLIT">Split (two segments)</option>
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Start time *
                    <input
                      name="start"
                      type="time"
                      required
                      defaultValue={clockTime(shift?.startMinute ?? 540)}
                    />
                  </label>
                  <label>
                    End time *
                    <input
                      name="end"
                      type="time"
                      required
                      defaultValue={clockTime(shift?.endMinute ?? 1080)}
                    />
                  </label>
                  <label>
                    Grace minutes *
                    <input
                      name="graceMinutes"
                      type="number"
                      min="0"
                      max="120"
                      required
                      defaultValue={shift?.graceMinutes ?? 10}
                    />
                  </label>
                  <label>
                    Unpaid break minutes *
                    <input
                      name="breakMinutes"
                      type="number"
                      min="0"
                      max="240"
                      required
                      defaultValue={shift?.breakMinutes ?? 60}
                    />
                  </label>
                  <label>
                    Second segment start (split)
                    <input
                      name="splitStart"
                      type="time"
                      defaultValue={
                        shift?.splitStartMinute != null
                          ? clockTime(shift.splitStartMinute)
                          : ""
                      }
                    />
                  </label>
                  <label>
                    Second segment end (split)
                    <input
                      name="splitEnd"
                      type="time"
                      defaultValue={
                        shift?.splitEndMinute != null
                          ? clockTime(shift.splitEndMinute)
                          : ""
                      }
                    />
                  </label>
                  <label>
                    Minimum minutes for a full day
                    <input
                      name="minimumMinutes"
                      type="number"
                      min="30"
                      max="1440"
                      placeholder="Scheduled hours"
                      defaultValue={shift?.minimumMinutes ?? ""}
                    />
                  </label>
                  <label>
                    Minimum minutes for a half day
                    <input
                      name="halfDayMinutes"
                      type="number"
                      min="30"
                      max="1440"
                      placeholder="Half of a full day"
                      defaultValue={shift?.halfDayMinutes ?? ""}
                    />
                  </label>
                  <label>
                    Early-exit grace minutes
                    <input
                      name="earlyExitGraceMinutes"
                      type="number"
                      min="0"
                      max="240"
                      defaultValue={shift?.earlyExitGraceMinutes ?? 0}
                    />
                  </label>
                  <label>
                    Overtime counts after (extra minutes)
                    <input
                      name="overtimeAfterMinutes"
                      type="number"
                      min="0"
                      max="720"
                      defaultValue={shift?.overtimeAfterMinutes ?? 0}
                    />
                  </label>
                </div>
                <p className="muted text-xs">
                  Late after start plus grace. Worked time below the half-day
                  minimum is Short, below the full-day minimum is Half day.
                  Leaving before the scheduled end (beyond its grace) records an
                  early exit. Break minutes are deducted once. End earlier than
                  start means an overnight shift. Rotate employees between
                  shifts with Attendance → Rosters.
                </p>
              </>
            ) : editor.kind === "holidays" ? (
              <label>
                Date *
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={
                    editor.item ? dateOnly((editor.item as Holiday).date) : ""
                  }
                />
                <span className="flex items-center gap-2 mt-2">
                  <input
                    name="optional"
                    type="checkbox"
                    defaultChecked={
                      !!(editor.item as Holiday | undefined)?.optional
                    }
                  />
                  Optional holiday (employees choose within the yearly limit)
                </span>
              </label>
            ) : (
              <>
                <label>
                  Annual allowance (days) *
                  <input
                    name="annualDays"
                    type="number"
                    min="0"
                    max="366"
                    required
                    defaultValue={leaveType?.annualDays ?? ""}
                  />
                </label>
                <label className="flex gap-2 items-center">
                  <input
                    name="paid"
                    type="checkbox"
                    defaultChecked={leaveType?.paid ?? true}
                  />
                  Paid leave (unpaid types such as loss of pay have no balance
                  limit)
                </label>
                <div className="form-grid">
                  <label>
                    Accrual
                    <select
                      name="accrual"
                      defaultValue={leaveType?.accrual ?? "ANNUAL"}
                    >
                      <option value="ANNUAL">Full allowance each year</option>
                      <option value="MONTHLY">Monthly (allowance / 12)</option>
                    </select>
                  </label>
                  <label>
                    Carry forward up to (days)
                    <input
                      name="carryForwardMax"
                      type="number"
                      min="0"
                      max="366"
                      defaultValue={leaveType?.carryForwardMax ?? 0}
                    />
                  </label>
                  <label>
                    Encash up to (days a year)
                    <input
                      name="encashMax"
                      type="number"
                      min="0"
                      max="366"
                      defaultValue={leaveType?.encashMax ?? 0}
                    />
                  </label>
                  <label>
                    Approval
                    <select
                      name="approvalLevels"
                      defaultValue={String(leaveType?.approvalLevels ?? 1)}
                    >
                      <option value="1">HR</option>
                      <option value="2">Reporting manager, then HR</option>
                    </select>
                  </label>
                </div>
                <label className="flex gap-2 items-center">
                  <input
                    name="encashable"
                    type="checkbox"
                    defaultChecked={leaveType?.encashable ?? false}
                  />
                  Can be encashed
                </label>
                <label className="flex gap-2 items-center">
                  <input
                    name="halfDayAllowed"
                    type="checkbox"
                    defaultChecked={leaveType?.halfDayAllowed ?? true}
                  />
                  Half days allowed
                </label>
                <label className="flex gap-2 items-center">
                  <input
                    name="compOff"
                    type="checkbox"
                    defaultChecked={leaveType?.compOff ?? false}
                  />
                  Compensatory off (balance comes from approved comp-off
                  credits)
                </label>
                <p className="muted text-xs">
                  Allowance and paid status are locked once requests exist.
                </p>
              </>
            )}
            {editor.kind !== "holidays" && (
              <label className="flex items-center gap-2">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={shift?.active ?? leaveType?.active ?? true}
                />
                Active
              </label>
            )}
          </SaveForm>
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete holiday"
      >
        {deleting && (
          <SaveForm
            label="Delete holiday"
            onSave={async () => {
              await api(`time/holidays/${deleting.id}`, { method: "DELETE" });
              setDeleting(null);
              await refresh();
            }}
          >
            <p>
              Delete {deleting.name} on {dateOnly(deleting.date)}?
            </p>
          </SaveForm>
        )}
      </Dialog>
      <AttendanceLocations notify={notify} />
    </>
  );
}
