"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Field, Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Table, when, type Notify } from "./platform";
type Person = {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
};
type Job = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  branchId: string | null;
  branch: { name: string } | null;
  status: string;
};
type Assignment = {
  id: string;
  jobId: string;
  employeeId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  progress: number;
  note: string | null;
  job: { name: string };
  employee: Person;
};
type Log = {
  id: string;
  jobId: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  job: { name: string };
  employee: Person;
};
type Agency = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
};
type Contract = {
  id: string;
  employeeId: string;
  agencyId: string;
  startsOn: string;
  endsOn: string;
  status: string;
  reference: string | null;
  notes: string | null;
  agency: { name: string };
  employee: Person;
};
type Edit = {
  kind: "jobs" | "assignments" | "progress" | "agencies" | "contracts";
  id?: string;
  initial?: Record<string, unknown>;
};
const person = (p: Person) =>
  `${p.firstName} ${p.lastName} (${p.employeeCode})`;
const iso = (v: string) => new Date(v).toISOString();
const localInput = (v: string) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function csvDownload(name: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map(
          (v) =>
            `"${String(v)
              .replace(/^[=+@-]/, "'$&")
              .replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkforcePage({ me, notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient(),
    manage = me.permissions.includes("attendance.manage"),
    hr = me.permissions.includes("employees.write");
  const features = me.subscription?.plan.features ?? [],
    planning = features.includes("workplanning"),
    contractors = features.includes("contractors") && hr;
  const [tab, setTab] = useState("jobs"),
    [edit, setEdit] = useState<Edit | null>(null),
    [job, setJob] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    );
  const period = `from=${from}&to=${to}`;
  const jobs = useQuery({
    queryKey: ["workforce", "jobs"],
    queryFn: () => api<Job[]>("workforce/jobs"),
  });
  const assignments = useQuery({
    queryKey: ["workforce", "assignments", period],
    queryFn: () => api<Assignment[]>(`workforce/assignments?${period}`),
    enabled: planning,
  });
  const logs = useQuery({
    queryKey: ["workforce", "logs", period],
    queryFn: () => api<Log[]>(`workforce/logs?${period}`),
    refetchInterval: 30000,
  });
  const agencies = useQuery({
    queryKey: ["workforce", "agencies"],
    queryFn: () => api<Agency[]>("workforce/agencies"),
    enabled: contractors,
  });
  const contracts = useQuery({
    queryKey: ["workforce", "contracts"],
    queryFn: () => api<Contract[]>("workforce/contracts"),
    enabled: contractors,
  });
  // The employee identity comes from the authenticated attendance summary.
  const summary = useQuery({
    queryKey: ["workforce", "own"],
    queryFn: () => api<{ employee: Person | null }>("time/summary"),
    enabled: me.permissions.includes("attendance.self"),
  });
  const running = logs.data?.find(
    (l) => !l.endedAt && l.employee.id === summary.data?.employee?.id,
  );
  const refresh = () => client.invalidateQueries({ queryKey: ["workforce"] });
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      await api(`workforce/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
      notify("Saved.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const options = (jobs.data ?? []).map((j) => ({
    value: j.id,
    label: `${j.code} · ${j.name}`,
  }));
  const select = (key: string, label: string, values: string[]): Field => ({
    key,
    label,
    type: "select",
    options: values.map((v) => ({ value: v, label: v })),
    required: true,
  });
  let fields: Field[] = [];
  if (edit?.kind === "jobs")
    fields = [
      { key: "code", label: "Job code", required: true },
      { key: "name", label: "Job name", required: true },
      { key: "branchId", label: "Site", reference: "branches" },
      { key: "description", label: "Description", type: "textarea" },
      select("status", "Status", ["ACTIVE", "COMPLETED", "ARCHIVED"]),
    ];
  if (edit?.kind === "assignments")
    fields = [
      { key: "jobId", label: "Job", type: "select", options, required: true },
      {
        key: "employeeId",
        label: "Employee",
        reference: "employees",
        required: true,
      },
      { key: "title", label: "Activity / task", required: true },
      {
        key: "startsAt",
        label: "Starts (your local time)",
        type: "datetime-local",
        required: true,
      },
      {
        key: "endsAt",
        label: "Ends (your local time)",
        type: "datetime-local",
        required: true,
      },
      { key: "note", label: "Instructions", type: "textarea" },
    ];
  if (edit?.kind === "progress")
    fields = [
      select("status", "Activity status", [
        "PLANNED",
        "IN_PROGRESS",
        "COMPLETED",
        ...(manage ? ["CANCELLED"] : []),
      ]),
      {
        key: "progress",
        label: "Progress (0–100%)",
        type: "number",
        required: true,
      },
      { key: "note", label: "Progress note", type: "textarea" },
    ];
  if (edit?.kind === "agencies")
    fields = [
      { key: "name", label: "Agency name", required: true },
      { key: "contactName", label: "Contact person" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone" },
      select("active", "Active", ["true", "false"]),
    ];
  if (edit?.kind === "contracts")
    fields = [
      {
        key: "employeeId",
        label: "Contract worker (employee record)",
        reference: "employees",
        required: true,
      },
      {
        key: "agencyId",
        label: "Agency",
        type: "select",
        options: (agencies.data ?? []).map((a) => ({
          value: a.id,
          label: a.name,
        })),
        required: true,
      },
      {
        key: "startsOn",
        label: "Contract starts",
        type: "date",
        required: true,
      },
      { key: "endsOn", label: "Contract ends", type: "date", required: true },
      { key: "reference", label: "Contract reference" },
      { key: "notes", label: "Terms / notes", type: "textarea" },
      select("status", "Status", ["ACTIVE", "ENDED"]),
    ];
  const save = async (v: Record<string, string>) => {
    if (!edit) return;
    let body: Record<string, unknown> = { ...v };
    if (edit.kind === "jobs")
      body = {
        ...v,
        branchId: v.branchId || null,
        description: v.description || null,
      };
    if (edit.kind === "assignments")
      body = {
        ...v,
        startsAt: iso(v.startsAt),
        endsAt: iso(v.endsAt),
        note: v.note || null,
      };
    if (edit.kind === "progress")
      body = { ...v, progress: Number(v.progress), note: v.note || null };
    if (edit.kind === "agencies")
      body = {
        ...v,
        active: v.active === "true",
        email: v.email || null,
        phone: v.phone || null,
        contactName: v.contactName || null,
      };
    if (edit.kind === "contracts")
      body = { ...v, notes: v.notes || null, reference: v.reference || null };
    const path =
      edit.kind === "progress"
        ? `assignments/${edit.id}/progress`
        : `${edit.kind}${edit.id ? `/${edit.id}` : ""}`;
    await api(`workforce/${path}`, {
      method: edit.id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    setEdit(null);
    await refresh();
    notify("Saved.");
  };
  const minutes = (l: Log) =>
    Math.max(
      0,
      Math.floor(
        (Date.parse(l.endedAt ?? new Date().toISOString()) -
          Date.parse(l.startedAt)) /
          60000,
      ),
    );
  return (
    <>
      <Heading
        eyebrow="Workforce"
        title="Jobs & activities"
        text="Plan work, record job time and manage agency workers."
      />
      <div className="section-tabs">
        {[
          ["jobs", "Jobs & timers"],
          ["logs", "Job timesheets"],
          ...(planning ? [["assignments", "Schedule & activities"]] : []),
          ...(contractors
            ? [
                ["agencies", "Agencies"],
                ["contracts", "Contract workers"],
              ]
            : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={key === tab ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {["logs", "assignments"].includes(tab) && (
        <div className="flex gap-4 flex-wrap mb-5">
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <p className="muted text-sm">
            Up to 1,000 records per view. Narrow dates for larger teams.
          </p>
        </div>
      )}
      {tab === "jobs" && (
        <>
          <section className="card p-5 mb-5">
            <h2 className="font-bold mb-3">My job timer</h2>
            <p className="muted text-sm mb-4">
              Check in first. Only one timer can run; breaks and check-out stop
              it.
            </p>
            {running ? (
              <>
                <p>
                  {running.job.name} · started {when(running.startedAt)}
                </p>
                <Button
                  disabled={busy}
                  onClick={() => void act("logs/stop", { note: note || null })}
                >
                  Stop job timer
                </Button>
              </>
            ) : (
              <div className="flex gap-3 flex-wrap">
                <label>
                  Job
                  <select value={job} onChange={(e) => setJob(e.target.value)}>
                    <option value="">Choose job</option>
                    {(jobs.data ?? [])
                      .filter((j) => j.status === "ACTIVE")
                      .map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Work note
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <Button
                  disabled={busy || !job}
                  onClick={() =>
                    void act("logs/start", { jobId: job, note: note || null })
                  }
                >
                  Start job timer
                </Button>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-title flex justify-between">
              <h2>Jobs</h2>
              {manage && (
                <Button
                  onClick={() =>
                    setEdit({ kind: "jobs", initial: { status: "ACTIVE" } })
                  }
                >
                  Add job
                </Button>
              )}
            </div>
            <Table
              headers={["Code", "Job", "Site", "Status", ""]}
              rows={(jobs.data ?? []).map((j) => [
                j.code,
                j.name,
                j.branch?.name ?? "Any site",
                j.status,
                manage ? (
                  <Button
                    key="edit"
                    variant="outline"
                    onClick={() =>
                      setEdit({ kind: "jobs", id: j.id, initial: { ...j } })
                    }
                  >
                    Edit
                  </Button>
                ) : null,
              ])}
              loading={jobs.isLoading}
              error={jobs.error}
              empty="No jobs yet."
            />
          </section>
        </>
      )}
      {tab === "logs" && (
        <section className="card">
          <div className="card-title flex justify-between">
            <h2>Job timesheets</h2>
            <Button
              onClick={() =>
                csvDownload("job-timesheets.csv", [
                  ["Employee", "Job", "Start", "End", "Minutes", "Note"],
                  ...(logs.data ?? []).map((l) => [
                    person(l.employee),
                    l.job.name,
                    l.startedAt,
                    l.endedAt ?? "Running",
                    minutes(l),
                    l.note ?? "",
                  ]),
                ])
              }
            >
              Download CSV
            </Button>
          </div>
          <Table
            headers={["Employee", "Job", "Start", "End", "Minutes", "Note"]}
            rows={(logs.data ?? []).map((l) => [
              person(l.employee),
              l.job.name,
              when(l.startedAt),
              l.endedAt ? when(l.endedAt) : "Running",
              minutes(l),
              l.note,
            ])}
            loading={logs.isLoading}
            error={logs.error}
            empty="No job time in this period."
          />
          <div className="p-5">
            <strong>
              Total recorded time:{" "}
              {(logs.data ?? []).reduce((sum, l) => sum + minutes(l), 0)}{" "}
              minutes
            </strong>
            <p className="muted text-sm">
              Job allocation is separate from payroll attendance. Running timers
              show elapsed time.
            </p>
          </div>
        </section>
      )}
      {tab === "assignments" && (
        <section className="card">
          <div className="card-title flex justify-between">
            <h2>Schedule & activity progress</h2>
            {manage && (
              <Button onClick={() => setEdit({ kind: "assignments" })}>
                Schedule activity
              </Button>
            )}
          </div>
          <Table
            headers={[
              "Employee",
              "Job / activity",
              "Start",
              "End",
              "Progress",
              "Actions",
            ]}
            rows={(assignments.data ?? []).map((a) => [
              person(a.employee),
              `${a.job.name} · ${a.title}`,
              when(a.startsAt),
              when(a.endsAt),
              `${a.status} · ${a.progress}%`,
              <div key="actions" className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setEdit({
                      kind: "progress",
                      id: a.id,
                      initial: {
                        status: a.status,
                        progress: a.progress,
                        note: a.note,
                      },
                    })
                  }
                >
                  Update progress
                </Button>
                {manage && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setEdit({
                        kind: "assignments",
                        id: a.id,
                        initial: {
                          ...a,
                          startsAt: localInput(a.startsAt),
                          endsAt: localInput(a.endsAt),
                        },
                      })
                    }
                  >
                    Reschedule
                  </Button>
                )}
              </div>,
            ])}
            loading={assignments.isLoading}
            error={assignments.error}
            empty="No scheduled work in this period."
          />
        </section>
      )}
      {tab === "agencies" && (
        <section className="card">
          <div className="card-title flex justify-between">
            <h2>Contractor agencies</h2>
            <Button
              onClick={() =>
                setEdit({ kind: "agencies", initial: { active: "true" } })
              }
            >
              Add agency
            </Button>
          </div>
          <Table
            headers={["Agency", "Contact", "Email", "Phone", "Active", ""]}
            rows={(agencies.data ?? []).map((a) => [
              a.name,
              a.contactName,
              a.email,
              a.phone,
              a.active ? "Yes" : "No",
              <Button
                key="edit"
                variant="outline"
                onClick={() =>
                  setEdit({
                    kind: "agencies",
                    id: a.id,
                    initial: { ...a, active: String(a.active) },
                  })
                }
              >
                Edit
              </Button>,
            ])}
            loading={agencies.isLoading}
            error={agencies.error}
            empty="No agencies yet."
          />
        </section>
      )}
      {tab === "contracts" && (
        <section className="card">
          <div className="card-title flex justify-between">
            <h2>Contract workers</h2>
            <Button
              onClick={() =>
                setEdit({ kind: "contracts", initial: { status: "ACTIVE" } })
              }
            >
              Add contract
            </Button>
          </div>
          <p className="p-5 muted text-sm">
            Create the employee in the directory first, then link their agency
            contract here. Attendance and payroll use the same employee record.
          </p>
          <Table
            headers={[
              "Employee",
              "Agency",
              "Starts",
              "Ends",
              "Status",
              "Reference",
              "",
            ]}
            rows={(contracts.data ?? []).map((c) => [
              person(c.employee),
              c.agency.name,
              c.startsOn.slice(0, 10),
              c.endsOn.slice(0, 10),
              c.status === "ACTIVE" &&
              c.endsOn.slice(0, 10) < new Date().toISOString().slice(0, 10)
                ? "EXPIRED"
                : c.status,
              c.reference,
              <Button
                key="edit"
                variant="outline"
                onClick={() =>
                  setEdit({ kind: "contracts", id: c.id, initial: { ...c } })
                }
              >
                Edit / end
              </Button>,
            ])}
            loading={contracts.isLoading}
            error={contracts.error}
            empty="No contractor assignments."
          />
        </section>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit ? `${edit.id ? "Edit" : "Add"} ${edit.kind}` : ""}
      >
        {edit && (
          <RecordForm
            key={`${edit.kind}:${edit.id ?? "new"}`}
            initial={edit.initial}
            fields={fields}
            onSave={save}
            onCancel={() => setEdit(null)}
          />
        )}
      </Dialog>
    </>
  );
}
type Site = {
  id: string | null;
  name: string;
  geofenceEnabled: boolean;
  employees: number;
  attended: number;
  checkedIn: number;
  onLeave: number;
  noPunch: number;
  late: number;
  workedMinutes: number;
  overtimeMinutes: number;
};
export function SiteDashboard() {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const sites = useQuery({
    queryKey: ["workforce", "sites", date],
    queryFn: () =>
      api<{ date: string; sites: Site[] }>(`workforce/sites?date=${date}`),
    refetchInterval: 60000,
  });
  const rows = sites.data?.sites ?? [];
  return (
    <>
      <Heading
        eyebrow="Attendance"
        title="Multi-site dashboard"
        text="Compare attendance, leave and completed hours across company sites."
      />
      <div className="flex justify-between mb-5">
        <label>
          Work date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <Button
          onClick={() =>
            csvDownload(`sites-${date}.csv`, [
              [
                "Site",
                "Employees",
                "Attended",
                "Checked in",
                "On leave",
                "No punch",
                "Late",
                "Worked minutes",
                "Overtime minutes",
              ],
              ...rows.map((r) => [
                r.name,
                r.employees,
                r.attended,
                r.checkedIn,
                r.onLeave,
                r.noPunch,
                r.late,
                r.workedMinutes,
                r.overtimeMinutes,
              ]),
            ])
          }
        >
          Download CSV
        </Button>
      </div>
      <section className="card">
        <Table
          headers={[
            "Site",
            "Staff",
            "Attended",
            "Checked in",
            "On leave",
            "No punch",
            "Late",
            "Hours",
            "Overtime",
            "Geofence",
          ]}
          rows={rows.map((r) => [
            r.name,
            r.employees,
            r.attended,
            r.checkedIn,
            r.onLeave,
            r.noPunch,
            r.late,
            (r.workedMinutes / 60).toFixed(1),
            (r.overtimeMinutes / 60).toFixed(1),
            r.geofenceEnabled ? "On" : "Off",
          ])}
          loading={sites.isLoading}
          error={sites.error}
          empty="No sites."
        />
      </section>
      <p className="muted text-sm mt-4">
        No punch does not necessarily mean absent: holidays, weekly offs and
        pending corrections must be reviewed. Hours reflect completed
        attendance. Site grouping uses current employee assignments.
      </p>
    </>
  );
}
export function BreakControls() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const data = useQuery({
    queryKey: ["workforce", "breaks"],
    queryFn: () =>
      api<{ id: string; startedAt: string; endedAt: string | null }[]>(
        "workforce/breaks",
      ),
    refetchInterval: 30000,
  });
  const active = data.data?.find((b) => !b.endedAt);
  async function act() {
    setBusy(true);
    setError("");
    try {
      await api(`workforce/breaks/${active ? "stop" : "start"}`, {
        method: "POST",
        body: "{}",
      });
      await client.invalidateQueries({ queryKey: ["workforce"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-5 mb-5">
      <h2 className="font-bold">Break time</h2>
      <p className="muted text-sm my-3">
        {active
          ? `On break since ${when(active.startedAt)}.`
          : "Record your unpaid breaks after checking in."}{" "}
        The deduction is the higher of the scheduled break or total recorded
        breaks, never both added together.
      </p>
      <Button
        disabled={busy || data.isLoading || !!data.error}
        onClick={() => void act()}
      >
        {active ? "End break" : "Start unpaid break"}
      </Button>
      {(error || data.error) && (
        <p role="alert" className="error mt-3">
          {error || data.error?.message}
        </p>
      )}
      <details className="mt-4">
        <summary>Recent breaks</summary>
        {data.data?.slice(0, 10).map((b) => (
          <p key={b.id} className="text-sm my-2">
            {when(b.startedAt)} — {b.endedAt ? when(b.endedAt) : "Running"}
          </p>
        ))}
      </details>
    </section>
  );
}
