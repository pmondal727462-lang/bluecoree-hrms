"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Table } from "./platform";
import { ReferenceSelect } from "./reference-select";

type Notify = (message: string) => void;
type LeaveTypeLite = {
  id: string;
  name: string;
  active: boolean;
  encashable?: boolean;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";

// Employee: choose optional holidays within the company limit.
export function OptionalHolidays({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["time", "optional-holidays"],
    queryFn: () =>
      api<{
        limit: number;
        selected: number;
        items: { id: string; name: string; date: string; selected: boolean }[];
      }>("time/optional-holidays"),
  });
  if (!data.data?.items.length) return null;
  return (
    <section className="card mt-6">
      <div className="card-title">
        <h2>
          Optional holidays · {data.data.selected} of {data.data.limit} chosen
        </h2>
      </div>
      <div className="p-6 flex gap-3 flex-wrap">
        {data.data.items.map((h) => (
          <div
            key={h.id}
            className="rounded-lg border border-[var(--border)] p-4 space-y-2"
          >
            <p className="font-semibold">{h.name}</p>
            <p className="muted">{h.date.slice(0, 10)}</p>
            <Button
              size="sm"
              variant={h.selected ? "outline" : "default"}
              onClick={async () => {
                try {
                  await api(`time/optional-holidays/${h.id}`, {
                    method: h.selected ? "DELETE" : "POST",
                  });
                  await client.invalidateQueries({ queryKey: ["time"] });
                } catch (e) {
                  notify(errorText(e));
                }
              }}
            >
              {h.selected ? "Remove" : "Take this holiday"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

type CompOff = {
  id: string;
  workDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote: string | null;
  expiresAt: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
};
// Compensatory off: employees claim work on off days; HR approves credits.
export function CompOffPanel({
  canSelf,
  canReview,
  notify,
}: {
  canSelf: boolean;
  canReview: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const [scope, setScope] = useState(canReview ? "company" : "own");
  const [form, setForm] = useState({ workDate: "", days: "1", reason: "" });
  const list = useQuery({
    queryKey: ["time", "comp-off", scope],
    queryFn: () => api<CompOff[]>(`time/comp-off?scope=${scope}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["time"] });
  return (
    <section className="card mt-6">
      <div className="card-title flex flex-wrap gap-3 items-center justify-between">
        <h2>Compensatory off</h2>
        {canSelf && canReview && (
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="company">All requests</option>
            <option value="own">My requests</option>
          </select>
        )}
      </div>
      {canSelf && (
        <form
          className="form-grid px-6 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("time/comp-off", {
                method: "POST",
                body: JSON.stringify({
                  workDate: form.workDate,
                  days: Number(form.days),
                  reason: form.reason,
                }),
              });
              notify("Compensatory off request sent to HR.");
              setForm({ workDate: "", days: "1", reason: "" });
              await refresh();
            } catch (err) {
              notify(errorText(err));
            }
          }}
        >
          <label>
            Date worked (weekly off or holiday) *
            <input
              type="date"
              required
              value={form.workDate}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
            />
          </label>
          <label>
            Credit *
            <select
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            >
              <option value="1">Full day</option>
              <option value="0.5">Half day</option>
            </select>
          </label>
          <label>
            Reason *
            <input
              required
              minLength={5}
              maxLength={500}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button type="submit">Request credit</Button>
          </div>
        </form>
      )}
      <Table
        headers={["Employee", "Worked on", "Credit", "Reason", "Status", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No compensatory off requests."
        rows={(list.data ?? []).map((r) => [
          `${r.employee.employeeCode} · ${r.employee.firstName} ${r.employee.lastName}`,
          r.workDate.slice(0, 10),
          `${r.days} day`,
          r.reason,
          <div key="s">
            <span
              className={`badge ${r.status === "Approved" ? "positive" : ""}`}
            >
              {r.status}
            </span>
            {r.expiresAt && (
              <p className="muted text-xs">Use by {r.expiresAt.slice(0, 10)}</p>
            )}
          </div>,
          canReview && scope === "company" && r.status === "Pending" ? (
            <div key="a" className="flex gap-2">
              {(["Approved", "Rejected"] as const).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={status === "Approved" ? "default" : "outline"}
                  onClick={async () => {
                    try {
                      await api(`time/comp-off/${r.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ status }),
                      });
                      notify(`Request ${status.toLowerCase()}.`);
                      await refresh();
                    } catch (e) {
                      notify(errorText(e));
                    }
                  }}
                >
                  {status === "Approved" ? "Approve" : "Reject"}
                </Button>
              ))}
            </div>
          ) : (
            ""
          ),
        ])}
      />
    </section>
  );
}

// HR: year-end carry-forward, encashment and balance adjustment.
export function LeaveTools({
  leaveTypes,
  today,
  notify,
}: {
  leaveTypes: LeaveTypeLite[];
  today: string;
  notify: Notify;
}) {
  const client = useQueryClient();
  const year = Number(today.slice(0, 4));
  const [carryYear, setCarryYear] = useState(String(year - 1));
  const [employeeId, setEmployeeId] = useState("");
  const [form, setForm] = useState({
    leaveTypeId: "",
    days: "",
    note: "",
    kind: "adjust",
  });
  const run = async (fn: () => Promise<string>) => {
    try {
      notify(await fn());
      await client.invalidateQueries({ queryKey: ["time"] });
    } catch (e) {
      notify(errorText(e));
    }
  };
  return (
    <section className="card mt-6">
      <div className="card-title">
        <h2>Leave administration</h2>
      </div>
      <div className="p-6 grid gap-6">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            Carry forward balances from year
            <input
              type="number"
              min={2000}
              max={year - 1}
              value={carryYear}
              onChange={(e) => setCarryYear(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            onClick={() =>
              run(async () => {
                const r = await api<{ carried: number; employees: number }>(
                  "time/leave-carry-forward",
                  {
                    method: "POST",
                    body: JSON.stringify({ fromYear: Number(carryYear) }),
                  },
                );
                return `${r.carried} balances carried forward for ${r.employees} employees.`;
              })
            }
          >
            Run carry-forward
          </Button>
          <p className="muted text-xs max-w-md">
            Unused balance up to each type&apos;s carry-forward limit moves to
            the next year. Running it again does not add twice.
          </p>
        </div>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (!employeeId) return notify("Choose an employee.");
            void run(async () => {
              if (form.kind === "encash") {
                await api("time/leave-encash", {
                  method: "POST",
                  body: JSON.stringify({
                    employeeId,
                    leaveTypeId: form.leaveTypeId,
                    year,
                    days: Number(form.days),
                    note: form.note,
                  }),
                });
                return "Leave encashment recorded.";
              }
              await api("time/leave-adjust", {
                method: "POST",
                body: JSON.stringify({
                  entries: [
                    {
                      employeeId,
                      leaveTypeId: form.leaveTypeId,
                      year,
                      days: Number(form.days),
                      note: form.note,
                    },
                  ],
                }),
              });
              return "Balance adjusted.";
            });
          }}
        >
          <ReferenceSelect
            resource="employees"
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            required
          />
          <label>
            Action *
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="adjust">Adjust balance (+/- days)</option>
              <option value="encash">Encash days</option>
            </select>
          </label>
          <label>
            Leave type *
            <select
              required
              value={form.leaveTypeId}
              onChange={(e) =>
                setForm({ ...form, leaveTypeId: e.target.value })
              }
            >
              <option value="">Select</option>
              {leaveTypes
                .filter(
                  (t) => t.active && (form.kind !== "encash" || t.encashable),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Days * ({year})
            <input
              type="number"
              step="0.5"
              required
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            />
          </label>
          <label>
            Note {form.kind === "adjust" ? "*" : ""}
            <input
              required={form.kind === "adjust"}
              minLength={form.kind === "adjust" ? 3 : 0}
              maxLength={300}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button type="submit">Save</Button>
          </div>
        </form>
        <p className="muted text-xs">
          Encashed days are recorded for payroll; amounts are calculated in
          payroll.
        </p>
      </div>
    </section>
  );
}
