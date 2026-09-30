"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Confirm, Heading, Table, when, type Notify } from "./platform";
import { Loans, StatutoryRules } from "./payroll-extras";
import { salaryPeriod } from "@/modules/payroll/period";
import { formatCompanyDate } from "@/lib/company-date";
import {
  SalaryPeriodSettings,
  useSalaryPeriodPolicy,
} from "./salary-period-settings";

type Run = {
  id: string;
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  processedAt: string | null;
  submittedBy: string | null;
  reviewNote: string | null;
  totals: Record<string, number> | null;
};
const statusBadge: Record<string, [string, string]> = {
  DRAFT: ["Draft", "amber"],
  SUBMITTED: ["Awaiting approval", "amber"],
  APPROVED: ["Approved", "positive"],
  PROCESSED: ["Processed", "positive"],
};
type Item = {
  id: string;
  employee: { employeeCode: string; firstName: string; lastName: string };
  totalDays: number;
  lopDays: number;
  paidDays: number;
  gross: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  reimbursements: number;
  otherDeductions: number;
  netPay: number;
  employerCost: number;
  absentDays: number;
  bonus: number;
  incentive: number;
  otherEarnings: number;
  overtimePay: number;
  encashmentPay: number;
  loanDeduction: number;
  advanceDeduction: number;
};
type Structure = {
  basic: number;
  hra: number;
  conveyance: number;
  specialAllowance: number;
  otherAllowance: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: "NEW" | "OLD";
  section80C: number;
  section80D: number;
  hraExemption: number;
  otherDeductions: number;
  effectiveFrom: string;
};
type Person = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  salaryStructure: Structure | null;
};
type Slab = {
  min: number;
  max: number | null;
  amount: number;
  februaryAmount?: number;
};
type Statutory = {
  config: Record<string, number | boolean> & { ptSlabs: Slab[] };
  options: Record<string, number | boolean | string>;
  ptState: string | null;
  configured: boolean;
  ptTemplates: Record<string, Slab[]>;
};
const inr = (v: number | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v ?? 0);
const bool = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export function PayrollPage({ me, notify }: { me: Me; notify: Notify }) {
  const [tab, setTab] = useState("runs");
  const manage = me.permissions.includes("payroll.manage");
  const approve = me.permissions.includes("payroll.approve");
  return (
    <>
      <Heading
        eyebrow="Payroll"
        title="Payroll processing"
        text="Monthly payroll with PF, ESI, professional tax and TDS, statutory files and payslips."
      />
      <div className="section-tabs">
        {[
          ["runs", "Payroll runs"],
          ["period-policy", "Salary period policy"],
          ["structures", "Salary structures"],
          ["loans", "Loans & advances"],
          ["statutory", "Statutory settings"],
          ["rules", "Statutory rules"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "runs" ? (
        <Runs manage={manage} approve={approve} me={me} notify={notify} />
      ) : tab === "period-policy" ? (
        <SalaryPeriodSettings manage={manage} notify={notify} me={me} />
      ) : tab === "structures" ? (
        <Structures manage={manage} notify={notify} />
      ) : tab === "loans" ? (
        <Loans manage={manage} notify={notify} />
      ) : tab === "rules" ? (
        <StatutoryRules manage={manage} notify={notify} />
      ) : (
        <StatutorySettings manage={manage} notify={notify} />
      )}
    </>
  );
}

function Runs({
  manage,
  approve,
  me,
  notify,
}: {
  manage: boolean;
  approve: boolean;
  me: Me;
  notify: Notify;
}) {
  const client = useQueryClient();
  const runs = useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: () => api<Run[]>("payroll/runs"),
  });
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [open, setOpen] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("period");
    if (selected && /^\d{4}-(0[1-9]|1[0-2])$/.test(selected))
      setPeriod(selected);
  }, []);
  const policy = useSalaryPeriodPolicy();
  const dates =
    period && policy.data ? salaryPeriod(period, policy.data) : null;
  const refresh = () => client.invalidateQueries({ queryKey: ["payroll"] });
  return (
    <>
      {manage && (
        <section className="card p-6 mb-6 flex flex-wrap gap-4 items-end">
          <label>
            Payroll month
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !period || !policy.data}
            onClick={async () => {
              setBusy(true);
              try {
                const run = await api<Run>("payroll/runs", {
                  method: "POST",
                  body: JSON.stringify({ period }),
                });
                notify("Draft payroll calculated.");
                await refresh();
                setOpen(run.id);
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Plus />
            Calculate draft payroll
          </Button>
          {policy.error && <p className="error">{policy.error.message}</p>}
          {dates && (
            <p className="text-sm font-semibold">
              Salary period:{" "}
              {formatCompanyDate(
                dates.start.toISOString(),
                me.company.dateFormat,
              )}{" "}
              to{" "}
              {formatCompanyDate(
                dates.end.toISOString(),
                me.company.dateFormat,
              )}{" "}
              · {dates.days} days
            </p>
          )}
          <p className="muted text-xs max-w-xl">
            Unpaid leave and days before joining reduce pay automatically;
            absences too when enabled in Statutory settings. Approved overtime,
            encashed leave, loan instalments and expense claims are included. A
            run is submitted for review, approved by another person, then
            processed; attendance and leave for this salary period lock on
            submission.
          </p>
        </section>
      )}
      <section className="card">
        <Table
          headers={[
            "Month",
            "Salary period",
            "Status",
            "Employees",
            "Gross",
            "Net pay",
            "Employer cost",
            "Missing structures",
            "",
          ]}
          loading={runs.isLoading}
          error={runs.error}
          empty="No payroll runs yet."
          rows={(runs.data ?? []).map((r) => [
            r.period,
            r.periodStart && r.periodEnd
              ? `${formatCompanyDate(r.periodStart, me.company.dateFormat)} – ${formatCompanyDate(r.periodEnd, me.company.dateFormat)}`
              : "Calendar month",
            <span
              key="s"
              className={`badge ${statusBadge[r.status]?.[1] ?? "amber"}`}
            >
              {r.status === "PROCESSED"
                ? `Processed ${when(r.processedAt)}`
                : (statusBadge[r.status]?.[0] ?? r.status)}
            </span>,
            r.totals?.employees ?? 0,
            inr(r.totals?.gross),
            inr(r.totals?.netPay),
            inr(r.totals?.employerCost),
            r.totals?.missingStructures ?? 0,
            <Button
              key="o"
              size="sm"
              variant="outline"
              onClick={() => setOpen(r.id)}
            >
              Open
            </Button>,
          ])}
        />
      </section>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Payroll run"
      >
        {open && (
          <RunDetail
            id={open}
            manage={manage}
            approve={approve}
            me={me}
            notify={notify}
            onClose={() => setOpen(null)}
          />
        )}
      </Dialog>
    </>
  );
}
function RunDetail({
  id,
  manage,
  approve,
  me,
  notify,
  onClose,
}: {
  id: string;
  manage: boolean;
  approve: boolean;
  me: Me;
  notify: Notify;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["payroll", "run", id],
    queryFn: () => api<Run & { items: Item[] }>(`payroll/runs/${id}`),
  });
  const [adjust, setAdjust] = useState<Item | null>(null),
    [confirm, setConfirm] = useState<
      "process" | "delete" | "submit" | "approve" | null
    >(null),
    [reject, setReject] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["payroll"] });
  const r = run.data;
  if (!r)
    return <div className="empty">{run.error?.message ?? "Loading…"}</div>;
  const draft = r.status === "DRAFT";
  return (
    <div className="space-y-4">
      {r.periodStart && r.periodEnd && (
        <p className="font-semibold">
          {formatCompanyDate(r.periodStart, me.company.dateFormat)} to{" "}
          {formatCompanyDate(r.periodEnd, me.company.dateFormat)} (inclusive)
        </p>
      )}
      <p className="text-sm">
        {r.period} ·{" "}
        {draft
          ? "Draft — values can still change"
          : r.status === "PROCESSED"
            ? "Processed and locked"
            : `${statusBadge[r.status]?.[0]} — attendance and leave for this salary period are locked`}
        {r.reviewNote && ` · Reviewer note: ${r.reviewNote}`}
        {!!r.totals?.missingStructures &&
          ` · ${r.totals.missingStructures} active employees have no salary structure and are not included`}
      </p>
      <div className="flex flex-wrap gap-2">
        {manage && draft && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await api(`payroll/runs/${id}/recalculate`, { method: "POST" });
                notify("Recalculated.");
                await refresh();
              }}
            >
              Recalculate
            </Button>
            <Button size="sm" onClick={() => setConfirm("submit")}>
              Submit for approval
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("delete")}
            >
              Delete draft
            </Button>
          </>
        )}
        {approve && r.status === "SUBMITTED" && r.submittedBy !== me.userId && (
          <Button size="sm" onClick={() => setConfirm("approve")}>
            Approve
          </Button>
        )}
        {approve && ["SUBMITTED", "APPROVED"].includes(r.status) && (
          <Button size="sm" variant="outline" onClick={() => setReject(true)}>
            Send back to draft
          </Button>
        )}
        {manage && r.status === "APPROVED" && (
          <Button size="sm" onClick={() => setConfirm("process")}>
            Process & issue payslips
          </Button>
        )}
        {[
          ["pf-ecr", "PF ECR"],
          ["esi", "ESI"],
          ["pt", "PT"],
          ["tds", "TDS"],
          ["register", "Salary register"],
        ].map(([k, l]) => (
          <a
            key={k}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold"
            href={`/api/payroll/runs/${id}/reports/${k}`}
          >
            <Download size={14} />
            {l}
          </a>
        ))}
      </div>
      <div className="max-h-96 overflow-auto">
        <Table
          headers={[
            "Employee",
            "Paid days",
            "Gross",
            "PF",
            "ESI",
            "PT",
            "TDS",
            "Variable pay",
            "Loans",
            "Other",
            "Reimb.",
            "Net",
            "",
          ]}
          empty="No employees in this run."
          rows={r.items.map((i) => [
            `${i.employee.employeeCode} · ${i.employee.firstName} ${i.employee.lastName}`,
            `${i.paidDays}/${i.totalDays}`,
            inr(i.gross),
            inr(i.pfEmployee),
            inr(i.esiEmployee),
            inr(i.pt),
            inr(i.tds),
            inr(
              i.bonus +
                i.incentive +
                i.otherEarnings +
                i.overtimePay +
                i.encashmentPay,
            ),
            inr(i.loanDeduction + i.advanceDeduction),
            inr(i.otherDeductions),
            inr(i.reimbursements),
            <strong key="n">{inr(i.netPay)}</strong>,
            manage && draft ? (
              <Button
                key="a"
                size="sm"
                variant="outline"
                onClick={() => setAdjust(i)}
              >
                Adjust
              </Button>
            ) : null,
          ])}
        />
      </div>
      <Dialog
        open={!!adjust}
        onOpenChange={(v) => !v && setAdjust(null)}
        title="Adjust payroll line"
        description="Changes are recorded in the audit trail with your reason."
      >
        {adjust && (
          <RecordForm
            initial={{
              lopDays: adjust.lopDays,
              otherDeductions: adjust.otherDeductions,
              bonus: adjust.bonus,
              incentive: adjust.incentive,
              otherEarnings: adjust.otherEarnings,
            }}
            fields={[
              {
                key: "lopDays",
                label: "Loss-of-pay days",
                type: "number",
                required: true,
              },
              {
                key: "otherDeductions",
                label: "Other deductions (₹)",
                type: "number",
                required: true,
              },
              { key: "bonus", label: "Bonus (₹)", type: "number" },
              { key: "incentive", label: "Incentive (₹)", type: "number" },
              {
                key: "otherEarnings",
                label: "Other earnings (₹)",
                type: "number",
              },
              {
                key: "reason",
                label: "Reason",
                type: "textarea",
                required: true,
              },
            ]}
            onCancel={() => setAdjust(null)}
            onSave={async (v) => {
              await api(`payroll/runs/${id}/items/${adjust.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  lopDays: Number(v.lopDays),
                  otherDeductions: Number(v.otherDeductions),
                  bonus: Number(v.bonus || 0),
                  incentive: Number(v.incentive || 0),
                  otherEarnings: Number(v.otherEarnings || 0),
                  reason: v.reason,
                }),
              });
              setAdjust(null);
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={reject}
        onOpenChange={(v) => !v && setReject(false)}
        title="Send payroll back to draft"
        description="The preparer sees your note. Attendance and leave unlock."
      >
        {reject && (
          <RecordForm
            fields={[
              {
                key: "note",
                label: "Reason",
                type: "textarea",
                required: true,
              },
            ]}
            onCancel={() => setReject(false)}
            onSave={async (v) => {
              await api(`payroll/runs/${id}/reject`, {
                method: "POST",
                body: JSON.stringify({ note: v.note }),
              });
              setReject(false);
              notify("Payroll sent back to draft.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Confirm
        open={!!confirm}
        title={confirmText[confirm ?? "delete"][0]}
        text={confirmText[confirm ?? "delete"][1]}
        label={confirmText[confirm ?? "delete"][2]}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await api(
            `payroll/runs/${id}${confirm === "delete" ? "" : `/${confirm}`}`,
            {
              method: confirm === "delete" ? "DELETE" : "POST",
              ...(confirm === "approve" ? { body: "{}" } : {}),
            },
          );
          notify(confirmText[confirm ?? "delete"][3]);
          await refresh();
          if (confirm === "delete") onClose();
        }}
      />
    </div>
  );
}

const confirmText: Record<string, [string, string, string, string]> = {
  submit: [
    "Submit for approval",
    "Values are recalculated and the run goes to an approver. Attendance and leave for the month lock until it is sent back.",
    "Submit",
    "Payroll submitted for approval.",
  ],
  approve: [
    "Approve payroll",
    "You confirm the reviewed values. HR can then process the run and issue payslips.",
    "Approve",
    "Payroll approved.",
  ],
  process: [
    "Process payroll",
    "Payslips are issued, loan instalments and encashed leave are settled, reimbursed claims are closed and the run is locked. This cannot be undone.",
    "Process",
    "Payroll processed and payslips issued.",
  ],
  delete: [
    "Delete draft",
    "The draft and its calculations are removed. Linked expense claims return to approved.",
    "Delete",
    "Draft deleted.",
  ],
};

function Structures({ manage, notify }: { manage: boolean; notify: Notify }) {
  const client = useQueryClient();
  const [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Person | null>(null);
  const list = useQuery({
    queryKey: ["payroll", "structures", search],
    queryFn: () =>
      api<Person[]>(`payroll/structures?search=${encodeURIComponent(search)}`),
  });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code"
          />
        </label>
      </div>
      <Table
        headers={[
          "Employee",
          "Monthly gross",
          "Basic",
          "Regime",
          "PF / ESI / PT",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No active employees."
        rows={(list.data ?? []).map((p) => {
          const s = p.salaryStructure;
          return [
            `${p.employeeCode} · ${p.firstName} ${p.lastName}`,
            s ? (
              inr(
                s.basic +
                  s.hra +
                  (s.conveyance ?? 0) +
                  s.specialAllowance +
                  s.otherAllowance,
              )
            ) : (
              <span key="x" className="badge amber">
                Not set
              </span>
            ),
            s ? inr(s.basic) : "—",
            s?.taxRegime ?? "—",
            s
              ? [s.pfApplicable, s.esiApplicable, s.ptApplicable]
                  .map((b) => (b ? "Yes" : "No"))
                  .join(" / ")
              : "—",
            manage ? (
              <Button
                key="e"
                size="sm"
                variant="outline"
                onClick={() => setEdit(p)}
              >
                {s ? "Edit" : "Set up"}
              </Button>
            ) : null,
          ];
        })}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={`Salary structure · ${edit?.firstName ?? ""} ${edit?.lastName ?? ""}`}
        description="Monthly amounts. Basic is used as PF wages. Old-regime declarations are annual."
      >
        {edit && (
          <RecordForm
            initial={
              edit.salaryStructure
                ? {
                    ...edit.salaryStructure,
                    pfApplicable: String(edit.salaryStructure.pfApplicable),
                    esiApplicable: String(edit.salaryStructure.esiApplicable),
                    ptApplicable: String(edit.salaryStructure.ptApplicable),
                  }
                : {
                    hra: 0,
                    conveyance: 0,
                    specialAllowance: 0,
                    otherAllowance: 0,
                    pfApplicable: "true",
                    esiApplicable: "true",
                    ptApplicable: "true",
                    taxRegime: "NEW",
                    section80C: 0,
                    section80D: 0,
                    hraExemption: 0,
                    otherDeductions: 0,
                    effectiveFrom: new Date().toISOString().slice(0, 10),
                  }
            }
            fields={[
              {
                key: "basic",
                label: "Basic (incl. DA)",
                type: "number",
                required: true,
                section: "Monthly earnings",
              },
              {
                key: "hra",
                label: "HRA",
                type: "number",
                required: true,
                section: "Monthly earnings",
              },
              {
                key: "conveyance",
                label: "Conveyance",
                type: "number",
                required: true,
                section: "Monthly earnings",
              },
              {
                key: "specialAllowance",
                label: "Special allowance",
                type: "number",
                required: true,
                section: "Monthly earnings",
              },
              {
                key: "otherAllowance",
                label: "Other allowance",
                type: "number",
                required: true,
                section: "Monthly earnings",
              },
              {
                key: "pfApplicable",
                label: "PF applicable",
                type: "select",
                required: true,
                options: bool,
                section: "Statutory",
              },
              {
                key: "esiApplicable",
                label: "ESI applicable",
                type: "select",
                required: true,
                options: bool,
                section: "Statutory",
              },
              {
                key: "ptApplicable",
                label: "Professional tax applicable",
                type: "select",
                required: true,
                options: bool,
                section: "Statutory",
              },
              {
                key: "taxRegime",
                label: "Tax regime",
                type: "select",
                required: true,
                options: [
                  { value: "NEW", label: "New regime" },
                  { value: "OLD", label: "Old regime" },
                ],
                section: "Statutory",
              },
              {
                key: "section80C",
                label: "80C investments (annual, old regime)",
                type: "number",
                required: true,
                section: "Declarations",
              },
              {
                key: "section80D",
                label: "80D health insurance (annual)",
                type: "number",
                required: true,
                section: "Declarations",
              },
              {
                key: "hraExemption",
                label: "HRA exemption (annual)",
                type: "number",
                required: true,
                section: "Declarations",
              },
              {
                key: "otherDeductions",
                label: "Other deductions (annual)",
                type: "number",
                required: true,
                section: "Declarations",
              },
              {
                key: "effectiveFrom",
                label: "Effective from",
                type: "date",
                required: true,
                section: "Declarations",
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              const n = (k: string) => Number(v[k] || 0);
              await api(`payroll/structures/${edit.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  basic: n("basic"),
                  hra: n("hra"),
                  conveyance: n("conveyance"),
                  specialAllowance: n("specialAllowance"),
                  otherAllowance: n("otherAllowance"),
                  pfApplicable: v.pfApplicable === "true",
                  esiApplicable: v.esiApplicable === "true",
                  ptApplicable: v.ptApplicable === "true",
                  taxRegime: v.taxRegime,
                  section80C: n("section80C"),
                  section80D: n("section80D"),
                  hraExemption: n("hraExemption"),
                  otherDeductions: n("otherDeductions"),
                  effectiveFrom: v.effectiveFrom,
                }),
              });
              setEdit(null);
              notify("Salary structure saved.");
              await client.invalidateQueries({ queryKey: ["payroll"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function StatutorySettings({
  manage,
  notify,
}: {
  manage: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["payroll", "statutory"],
    queryFn: () => api<Statutory>("payroll/statutory"),
  });
  const [slabs, setSlabs] = useState<Slab[] | null>(null),
    [state, setState] = useState<string | null>(null);
  const d = data.data;
  if (!d)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const current = slabs ?? d.config.ptSlabs;
  const ptState = state ?? d.ptState ?? "";
  const c = d.config;
  return (
    <section className="card p-6">
      {!d.configured && (
        <div className="error mb-5">
          Defaults are shown. Review each rate with your payroll adviser and
          save before running payroll.
        </div>
      )}
      <RecordForm
        initial={Object.fromEntries(
          Object.entries({ ...c, ...d.options })
            .filter(([k]) => k !== "ptSlabs")
            .map(([k, v]) => [k, String(v)]),
        )}
        submitLabel={manage ? "Save statutory settings" : "Read only"}
        fields={[
          {
            key: "pfEnabled",
            label: "PF enabled",
            type: "select",
            required: true,
            options: bool,
            section: "Provident Fund",
          },
          {
            key: "pfWageCeiling",
            label: "PF wage ceiling (₹)",
            type: "number",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "pfCapAtCeiling",
            label: "Limit contributions to the ceiling",
            type: "select",
            required: true,
            options: bool,
            section: "Provident Fund",
          },
          {
            key: "pfEmployeeRate",
            label: "Employee rate %",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "pfEmployerRate",
            label: "Employer rate %",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "epsRate",
            label: "EPS rate % (on capped wage)",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "edliRate",
            label: "EDLI rate %",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "pfAdminRate",
            label: "Admin charges %",
            required: true,
            section: "Provident Fund",
          },
          {
            key: "esiEnabled",
            label: "ESI enabled",
            type: "select",
            required: true,
            options: bool,
            section: "ESI",
          },
          {
            key: "esiWageThreshold",
            label: "Coverage threshold (₹ gross per month)",
            type: "number",
            required: true,
            section: "ESI",
          },
          {
            key: "esiEmployeeRate",
            label: "Employee rate %",
            required: true,
            section: "ESI",
          },
          {
            key: "esiEmployerRate",
            label: "Employer rate %",
            required: true,
            section: "ESI",
          },
          {
            key: "ptEnabled",
            label: "Professional tax enabled",
            type: "select",
            required: true,
            options: bool,
            section: "Professional tax & TDS",
          },
          {
            key: "tdsEnabled",
            label: "Deduct TDS on salary",
            type: "select",
            required: true,
            options: bool,
            section: "Professional tax & TDS",
          },
          {
            key: "lopFromAttendance",
            label: "Deduct absences from attendance",
            type: "select",
            required: true,
            options: bool,
            section: "Pay rules",
          },
          {
            key: "overtimeMultiplier",
            label: "Overtime multiplier",
            required: true,
            section: "Pay rules",
          },
          {
            key: "overtimeBasis",
            label: "Overtime hourly rate from",
            type: "select",
            required: true,
            options: [
              { value: "BASIC", label: "Basic" },
              { value: "GROSS", label: "Gross" },
            ],
            section: "Pay rules",
          },
          {
            key: "hoursPerDay",
            label: "Hours per day (for hourly rate)",
            required: true,
            section: "Pay rules",
          },
          {
            key: "encashmentDivisor",
            label: "Leave encashment divisor (days)",
            required: true,
            section: "Pay rules",
          },
        ]}
        onSave={async (v) => {
          if (!manage) return;
          const b = (k: string) => v[k] === "true";
          const n = (k: string) => Number(v[k]);
          await api("payroll/statutory", {
            method: "PUT",
            body: JSON.stringify({
              pfEnabled: b("pfEnabled"),
              pfWageCeiling: n("pfWageCeiling"),
              pfCapAtCeiling: b("pfCapAtCeiling"),
              pfEmployeeRate: n("pfEmployeeRate"),
              pfEmployerRate: n("pfEmployerRate"),
              epsRate: n("epsRate"),
              edliRate: n("edliRate"),
              pfAdminRate: n("pfAdminRate"),
              esiEnabled: b("esiEnabled"),
              esiWageThreshold: n("esiWageThreshold"),
              esiEmployeeRate: n("esiEmployeeRate"),
              esiEmployerRate: n("esiEmployerRate"),
              ptEnabled: b("ptEnabled"),
              ptState: ptState || null,
              ptSlabs: current,
              tdsEnabled: b("tdsEnabled"),
              lopFromAttendance: b("lopFromAttendance"),
              overtimeMultiplier: n("overtimeMultiplier"),
              overtimeBasis: v.overtimeBasis,
              hoursPerDay: n("hoursPerDay"),
              encashmentDivisor: n("encashmentDivisor"),
            }),
          });
          notify("Statutory settings saved.");
          await client.invalidateQueries({ queryKey: ["payroll"] });
        }}
      >
        <div className="mt-6 space-y-3">
          <p className="subheading">Professional tax slabs (monthly gross)</p>
          <div className="flex flex-wrap gap-3 items-end">
            <label>
              State
              <input
                value={ptState}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. West Bengal"
              />
            </label>
            {Object.keys(d.ptTemplates).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setState(t);
                  setSlabs(d.ptTemplates[t]);
                }}
              >
                Load {t} template
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setSlabs([...current, { min: 0, max: null, amount: 0 }])
              }
            >
              Add slab
            </Button>
          </div>
          <p className="muted text-xs">
            Templates are starting points; state rules change. Confirm the
            current slabs before use.
          </p>
          {current.map((s, i) => (
            <div key={i} className="grid grid-cols-5 gap-2 items-end">
              {(["min", "max", "amount", "februaryAmount"] as const).map(
                (k) => (
                  <label key={k} className="text-xs">
                    {k === "februaryAmount" ? "February amount" : k}
                    <input
                      type="number"
                      value={s[k] ?? ""}
                      onChange={(e) => {
                        const next = [...current];
                        const val =
                          e.target.value === ""
                            ? k === "max"
                              ? null
                              : undefined
                            : Number(e.target.value);
                        next[i] = { ...s, [k]: val };
                        setSlabs(next);
                      }}
                    />
                  </label>
                ),
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSlabs(current.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </RecordForm>
    </section>
  );
}
