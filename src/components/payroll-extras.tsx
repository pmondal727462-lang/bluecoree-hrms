"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Table, type Notify } from "./platform";

type Loan = {
  id: string;
  kind: "LOAN" | "ADVANCE";
  principal: number;
  instalment: number;
  balance: number;
  startPeriod: string;
  status: string;
  note: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
  repayments: { amount: number; run: { period: string } }[];
};
type Rule = {
  id: string;
  scope: "COMPANY" | "PLATFORM";
  ruleType: string;
  name: string;
  state: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  employeeRate: number | null;
  employerRate: number | null;
  threshold: number | null;
  ceiling: number | null;
  calculationMethod: string;
  config: Record<string, unknown>;
  active: boolean;
};
const inr = (v: number | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v ?? 0);

export function Loans({ manage, notify }: { manage: boolean; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["payroll", "loans"],
    queryFn: () => api<Loan[]>("payroll/loans"),
  });
  const [add, setAdd] = useState(false),
    [edit, setEdit] = useState<Loan | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["payroll"] });
  return (
    <section className="card">
      {manage && (
        <div className="toolbar">
          <p className="muted text-xs max-w-xl">
            Instalments are deducted from the first payroll month onwards and
            never take net pay below zero. Repayments are recorded when a
            payroll run is processed.
          </p>
          <Button onClick={() => setAdd(true)}>
            <Plus />
            Add loan or advance
          </Button>
        </div>
      )}
      <Table
        headers={[
          "Employee",
          "Type",
          "Amount",
          "Instalment",
          "Balance",
          "From",
          "Status",
          "Repaid",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No loans or advances."
        rows={(list.data ?? []).map((l) => [
          `${l.employee.employeeCode} · ${l.employee.firstName} ${l.employee.lastName}`,
          l.kind === "LOAN" ? "Loan" : "Advance",
          inr(l.principal),
          inr(l.instalment),
          inr(l.balance),
          l.startPeriod,
          <span
            key="s"
            className={`badge ${l.status === "ACTIVE" ? "amber" : "positive"}`}
          >
            {l.status.toLowerCase()}
          </span>,
          l.repayments.length
            ? l.repayments.map((r) => r.run.period).join(", ")
            : "—",
          manage && l.status !== "CLOSED" ? (
            <Button
              key="e"
              size="sm"
              variant="outline"
              onClick={() => setEdit(l)}
            >
              Edit
            </Button>
          ) : null,
        ])}
      />
      <Dialog
        open={add}
        onOpenChange={(v) => !v && setAdd(false)}
        title="Add loan or advance"
      >
        {add && (
          <RecordForm
            initial={{
              kind: "LOAN",
              startPeriod: new Date().toISOString().slice(0, 7),
            }}
            fields={[
              {
                key: "employeeId",
                label: "Employee",
                type: "select",
                reference: "employees",
                required: true,
              },
              {
                key: "kind",
                label: "Type",
                type: "select",
                required: true,
                options: [
                  { value: "LOAN", label: "Loan" },
                  { value: "ADVANCE", label: "Salary advance" },
                ],
              },
              {
                key: "principal",
                label: "Amount (₹)",
                type: "number",
                required: true,
              },
              {
                key: "instalment",
                label: "Monthly instalment (₹; blank = full advance)",
                type: "number",
              },
              {
                key: "startPeriod",
                label: "First deduction month (YYYY-MM)",
                required: true,
              },
              { key: "note", label: "Note", type: "textarea" },
            ]}
            onCancel={() => setAdd(false)}
            onSave={async (v) => {
              await api("payroll/loans", {
                method: "POST",
                body: JSON.stringify({
                  employeeId: v.employeeId,
                  kind: v.kind,
                  principal: Number(v.principal),
                  ...(v.instalment ? { instalment: Number(v.instalment) } : {}),
                  startPeriod: v.startPeriod,
                  ...(v.note ? { note: v.note } : {}),
                }),
              });
              setAdd(false);
              notify("Saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title="Edit loan"
      >
        {edit && (
          <RecordForm
            initial={{ instalment: edit.instalment, status: edit.status }}
            fields={[
              {
                key: "instalment",
                label: "Monthly instalment (₹)",
                type: "number",
                required: true,
              },
              {
                key: "status",
                label: "Status",
                type: "select",
                required: true,
                options: [
                  { value: "ACTIVE", label: "Active" },
                  { value: "PAUSED", label: "Paused (skip deductions)" },
                  { value: "CLOSED", label: "Closed" },
                ],
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(`payroll/loans/${edit.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  instalment: Number(v.instalment),
                  status: v.status,
                }),
              });
              setEdit(null);
              notify("Saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
export function StatutoryRules({
  manage,
  notify,
}: {
  manage: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [add, setAdd] = useState(false);
  const list = useQuery({
    queryKey: ["payroll", "rules", period],
    queryFn: () =>
      api<{ items: Rule[]; applied: Record<string, string | null> | null }>(
        `payroll/statutory-rules?period=${period}`,
      ),
  });
  const applied = new Set(Object.values(list.data?.applied ?? {}));
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Rules effective in
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <p className="muted text-xs max-w-xl">
          Platform rules are maintained by the provider. A company rule of the
          same type and state replaces them from its effective date. Rules
          marked “In use” apply to payroll for the selected month.
        </p>
        {manage && (
          <Button onClick={() => setAdd(true)}>
            <Plus />
            Add company rule
          </Button>
        )}
      </div>
      <Table
        headers={[
          "Type",
          "Name",
          "Scope",
          "State",
          "Effective",
          "Employee",
          "Employer",
          "Threshold / ceiling",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No statutory rules."
        rows={(list.data?.items ?? []).map((r) => [
          r.ruleType,
          r.name,
          r.scope === "COMPANY" ? "Company" : "Platform",
          r.state ?? "—",
          `${r.effectiveFrom.slice(0, 10)} → ${r.effectiveTo?.slice(0, 10) ?? "open"}`,
          pct(r.employeeRate),
          pct(r.employerRate),
          [r.threshold, r.ceiling]
            .map((v) => (v === null ? "—" : inr(v)))
            .join(" / "),
          applied.has(r.id) ? (
            <span key="u" className="badge positive">
              In use
            </span>
          ) : !r.active ? (
            <span key="u" className="badge">
              Inactive
            </span>
          ) : null,
        ])}
      />
      <Dialog
        open={add}
        onOpenChange={(v) => !v && setAdd(false)}
        title="Add company statutory rule"
        description="For PF and ESI rates. PT slabs are set in Statutory settings; income-tax slabs come from the platform."
      >
        {add && (
          <RecordForm
            initial={{
              ruleType: "PF",
              effectiveFrom: `${period}-01`,
            }}
            fields={[
              {
                key: "ruleType",
                label: "Type",
                type: "select",
                required: true,
                options: [
                  { value: "PF", label: "Provident fund" },
                  { value: "ESI", label: "Employee state insurance" },
                ],
              },
              { key: "name", label: "Name", required: true },
              {
                key: "effectiveFrom",
                label: "Effective from",
                type: "date",
                required: true,
              },
              { key: "effectiveTo", label: "Effective to", type: "date" },
              {
                key: "employeeRate",
                label: "Employee rate %",
                type: "number",
                required: true,
              },
              {
                key: "employerRate",
                label: "Employer rate %",
                type: "number",
                required: true,
              },
              {
                key: "limit",
                label: "PF wage ceiling / ESI threshold (₹)",
                type: "number",
                required: true,
              },
            ]}
            onCancel={() => setAdd(false)}
            onSave={async (v) => {
              const pf = v.ruleType === "PF";
              await api("payroll/statutory-rules", {
                method: "POST",
                body: JSON.stringify({
                  ruleType: v.ruleType,
                  name: v.name,
                  effectiveFrom: v.effectiveFrom,
                  ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
                  employeeRate: Number(v.employeeRate),
                  employerRate: Number(v.employerRate),
                  ...(pf
                    ? { ceiling: Number(v.limit) }
                    : { threshold: Number(v.limit) }),
                  calculationMethod: pf
                    ? "PERCENT_OF_BASIC"
                    : "PERCENT_OF_GROSS",
                }),
              });
              setAdd(false);
              notify("Rule saved.");
              await client.invalidateQueries({ queryKey: ["payroll"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
