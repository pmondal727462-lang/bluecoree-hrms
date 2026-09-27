"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Heading, Table, type Notify } from "./platform";

type Person = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  status: string;
};
type History = {
  id: string;
  eventType: string;
  effectiveDate: string;
  fromValue: Record<string, unknown> | null;
  toValue: Record<string, unknown> | null;
  notes: string | null;
  createdByName: string;
};
type Settlement = {
  exitType: string;
  resignationDate: string | null;
  lastWorkingDay: string;
  noticeDays: number;
  noticeServedDays: number;
  pendingSalary: number;
  leaveEncashment: number;
  gratuity: number;
  otherEarnings: number;
  noticeRecovery: number;
  otherDeductions: number;
  netPayable: number;
  status: string;
  details: {
    serviceYears?: number;
    waiveNoticeRecovery?: boolean;
    salaryStructureMissing?: boolean;
    notes?: string;
  } | null;
};
type Named = { id: string; name: string };
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);

export function LifecyclePage({ me, notify }: { me: Me; notify: Notify }) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Person | null>(null);
  const people = useQuery({
    queryKey: ["lifecycle", "people", search],
    queryFn: () =>
      api<{ items: Person[] }>(
        `employees?pageSize=25&search=${encodeURIComponent(search)}`,
      ),
  });
  return (
    <>
      <Heading
        eyebrow="Core HR"
        title="Employee lifecycle"
        text="Confirmation, promotion, transfer, resignation, exit and full & final settlement, with a complete history."
      />
      <div className="grid lg:grid-cols-[300px_1fr] gap-6">
        <section className="card p-4 space-y-3 self-start">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees"
          />
          {people.error && <div className="error">{people.error.message}</div>}
          <div className="space-y-1 max-h-[520px] overflow-auto">
            {(people.data?.items ?? []).map((p) => (
              <button
                key={p.id}
                className={`w-full text-left rounded-lg p-2 text-sm ${selected?.id === p.id ? "bg-[var(--muted)] font-semibold" : "hover:bg-[var(--muted)]"}`}
                onClick={() => setSelected(p)}
              >
                {p.employeeCode} · {p.firstName} {p.lastName}
                <span className="muted text-xs block">{p.status}</span>
              </button>
            ))}
          </div>
        </section>
        {selected ? (
          <EmployeeLifecycle
            key={selected.id}
            person={selected}
            me={me}
            notify={notify}
          />
        ) : (
          <div className="card empty">Choose an employee.</div>
        )}
      </div>
    </>
  );
}
function EmployeeLifecycle({
  person,
  me,
  notify,
}: {
  person: Person;
  me: Me;
  notify: Notify;
}) {
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["lifecycle", "history", person.id],
    queryFn: () => api<History[]>(`employees/${person.id}/history`),
  });
  const settlement = useQuery({
    queryKey: ["lifecycle", "settlement", person.id],
    queryFn: () => api<Settlement | null>(`employees/${person.id}/settlement`),
  });
  const refs = useQuery({
    queryKey: ["lifecycle", "refs"],
    queryFn: async () => {
      const [departments, designations, branches] = await Promise.all(
        ["departments", "designations", "branches"].map((r) =>
          api<{ items: Named[] } | Named[]>(`${r}?pageSize=100`),
        ),
      );
      const list = (v: { items: Named[] } | Named[]) =>
        Array.isArray(v) ? v : v.items;
      return {
        departments: list(departments),
        designations: list(designations),
        branches: list(branches),
      };
    },
  });
  const [event, setEvent] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["lifecycle"] });
  const names = (field: string, id: unknown) => {
    const pool =
      field === "departmentId"
        ? refs.data?.departments
        : field === "designationId"
          ? refs.data?.designations
          : field === "branchId"
            ? refs.data?.branches
            : null;
    return pool?.find((x) => x.id === id)?.name ?? String(id ?? "—");
  };
  const describe = (v: Record<string, unknown> | null) =>
    v
      ? Object.entries(v)
          .filter(([, x]) => x !== null && x !== undefined)
          .map(([k, x]) => `${label(k.replace(/Id$/, ""))}: ${names(k, x)}`)
          .join(", ")
      : "";
  const opts = (xs?: Named[]) =>
    (xs ?? []).map((x) => ({ value: x.id, label: x.name }));
  const s = settlement.data;
  const canPay = me.permissions.includes("payroll.manage");
  return (
    <div className="space-y-6 min-w-0">
      <section className="card p-6">
        <h2 className="font-semibold mb-4">
          {person.firstName} {person.lastName} · {person.status}
        </h2>
        {me.permissions.includes("employees.write") && (
          <>
            <label className="max-w-xs">
              Record an event
              <select value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="">Choose…</option>
                {[
                  "CONFIRMATION",
                  "PROMOTION",
                  "TRANSFER",
                  "RESIGNATION",
                  "TERMINATION",
                  "RETIREMENT",
                  "EXIT",
                  "REHIRE",
                ].map((e) => (
                  <option key={e} value={e}>
                    {label(e)}
                  </option>
                ))}
              </select>
            </label>
            {event && (
              <div className="mt-4">
                <RecordForm
                  key={event}
                  initial={{
                    effectiveDate: new Date().toISOString().slice(0, 10),
                  }}
                  fields={[
                    {
                      key: "effectiveDate",
                      label:
                        event === "RESIGNATION"
                          ? "Resignation date"
                          : "Effective date",
                      type: "date",
                      required: true,
                    },
                    ...(["RESIGNATION", "TERMINATION", "RETIREMENT"].includes(
                      event,
                    )
                      ? [
                          {
                            key: "lastWorkingDay",
                            label: "Last working day",
                            type: "date" as const,
                            required: true,
                          },
                        ]
                      : []),
                    ...(event === "PROMOTION"
                      ? [
                          {
                            key: "designationId",
                            label: "New designation",
                            type: "select" as const,
                            required: true,
                            options: opts(refs.data?.designations),
                          },
                        ]
                      : []),
                    ...(["PROMOTION", "TRANSFER"].includes(event)
                      ? [
                          {
                            key: "departmentId",
                            label: "Department",
                            type: "select" as const,
                            options: opts(refs.data?.departments),
                          },
                        ]
                      : []),
                    ...(event === "TRANSFER"
                      ? [
                          {
                            key: "branchId",
                            label: "Work location",
                            type: "select" as const,
                            options: opts(refs.data?.branches),
                          },
                        ]
                      : []),
                    ...(["RESIGNATION", "TERMINATION", "RETIREMENT"].includes(
                      event,
                    )
                      ? [
                          {
                            key: "reason",
                            label: "Reason",
                            type: "textarea" as const,
                          },
                        ]
                      : []),
                    { key: "notes", label: "Notes", type: "textarea" },
                  ]}
                  submitLabel={`Record ${label(event)}`}
                  onCancel={() => setEvent("")}
                  onSave={async (v) => {
                    const pick = (k: string) => (v[k] ? { [k]: v[k] } : {});
                    await api(`employees/${person.id}/lifecycle`, {
                      method: "POST",
                      body: JSON.stringify({
                        eventType: event,
                        effectiveDate: v.effectiveDate,
                        ...pick("lastWorkingDay"),
                        ...pick("designationId"),
                        ...pick("departmentId"),
                        ...pick("branchId"),
                        ...pick("reason"),
                        ...pick("notes"),
                      }),
                    });
                    setEvent("");
                    notify(`${label(event)} recorded.`);
                    await refresh();
                    await client.invalidateQueries({ queryKey: ["employees"] });
                  }}
                />
              </div>
            )}
          </>
        )}
      </section>
      {s && (
        <section className="card p-6 space-y-4">
          <h2 className="font-semibold">
            Full & final settlement ·{" "}
            <span className="badge">{label(s.status)}</span>
          </h2>
          <p className="text-sm muted">
            {label(s.exitType)} · last working day{" "}
            {s.lastWorkingDay.slice(0, 10)} · service{" "}
            {s.details?.serviceYears ?? "—"} years · notice {s.noticeServedDays}
            /{s.noticeDays} days served
            {s.details?.salaryStructureMissing &&
              " · no salary structure, so pay amounts are zero"}
          </p>
          <Table
            headers={["Component", "Amount"]}
            empty=""
            rows={[
              ["Pending salary", inr(s.pendingSalary)],
              ["Leave encashment", inr(s.leaveEncashment)],
              ["Gratuity", inr(s.gratuity)],
              ["Other earnings", inr(s.otherEarnings)],
              ["Notice recovery", `− ${inr(s.noticeRecovery)}`],
              ["Other deductions", `− ${inr(s.otherDeductions)}`],
              [
                <strong key="n">Net payable</strong>,
                <strong key="v">{inr(s.netPayable)}</strong>,
              ],
            ]}
          />
          <p className="muted text-xs">
            Income tax on the settlement is not calculated here; review it with
            payroll before payment.
          </p>
          {canPay && s.status === "DRAFT" && (
            <RecordForm
              initial={{
                leaveEncashment: s.leaveEncashment,
                otherEarnings: s.otherEarnings,
                otherDeductions: s.otherDeductions,
                noticeServedDays: s.noticeServedDays,
                waiveNoticeRecovery: String(!!s.details?.waiveNoticeRecovery),
                notes: s.details?.notes,
              }}
              fields={[
                {
                  key: "leaveEncashment",
                  label: "Leave encashment",
                  type: "number",
                  required: true,
                },
                {
                  key: "otherEarnings",
                  label: "Other earnings",
                  type: "number",
                  required: true,
                },
                {
                  key: "otherDeductions",
                  label: "Other deductions (loans, assets)",
                  type: "number",
                  required: true,
                },
                {
                  key: "noticeServedDays",
                  label: "Notice days served",
                  type: "number",
                  required: true,
                },
                {
                  key: "waiveNoticeRecovery",
                  label: "Waive notice recovery",
                  type: "select",
                  required: true,
                  options: [
                    { value: "false", label: "No" },
                    { value: "true", label: "Yes" },
                  ],
                },
                { key: "notes", label: "Notes", type: "textarea" },
              ]}
              submitLabel="Recalculate"
              onSave={async (v) => {
                await api(`employees/${person.id}/settlement`, {
                  method: "PUT",
                  body: JSON.stringify({
                    leaveEncashment: Number(v.leaveEncashment),
                    otherEarnings: Number(v.otherEarnings),
                    otherDeductions: Number(v.otherDeductions),
                    noticeServedDays: Number(v.noticeServedDays),
                    waiveNoticeRecovery: v.waiveNoticeRecovery === "true",
                    ...(v.notes ? { notes: v.notes } : {}),
                  }),
                });
                await refresh();
              }}
            />
          )}
          {canPay && ["DRAFT", "APPROVED"].includes(s.status) && (
            <Button
              onClick={async () => {
                try {
                  await api(
                    `employees/${person.id}/settlement/${s.status === "DRAFT" ? "approve" : "paid"}`,
                    { method: "POST" },
                  );
                  notify(
                    s.status === "DRAFT"
                      ? "Settlement approved."
                      : "Settlement marked paid.",
                  );
                  await refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              {s.status === "DRAFT" ? "Approve settlement" : "Mark paid"}
            </Button>
          )}
        </section>
      )}
      <section className="card">
        <div className="card-title">
          <h2>History</h2>
        </div>
        <Table
          headers={["Effective", "Event", "From", "To", "Notes", "Recorded by"]}
          loading={history.isLoading}
          error={history.error}
          empty="No history yet."
          rows={(history.data ?? []).map((h) => [
            h.effectiveDate.slice(0, 10),
            label(h.eventType),
            describe(h.fromValue),
            describe(h.toValue),
            h.notes ?? "",
            `${h.createdByName}`,
          ])}
        />
        <p className="muted text-xs p-4">
          Salary revisions are listed without amounts.
        </p>
      </section>
    </div>
  );
}
