"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  salaryPeriod,
  defaultSalaryPeriod,
  type SalaryPeriodPolicy,
} from "@/modules/payroll/period";
import { formatCompanyDate } from "@/lib/company-date";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";

export function useSalaryPeriodPolicy() {
  return useQuery({
    queryKey: ["payroll", "period-policy"],
    queryFn: () => api<SalaryPeriodPolicy>("payroll/period-policy"),
  });
}
export function SalaryPeriodSettings({
  manage,
  notify,
  me,
}: {
  manage: boolean;
  notify: (s: string) => void;
  me: Me;
}) {
  const policy = useSalaryPeriodPolicy();
  const client = useQueryClient();
  const [draft, setDraft] = useState<SalaryPeriodPolicy | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const selected = draft ?? policy.data ?? defaultSalaryPeriod;
  const example = month ? salaryPeriod(month, selected) : null;
  if (policy.error) return <p className="error">{policy.error.message}</p>;
  if (!policy.data) return <p className="empty">Loading salary policy…</p>;
  return (
    <section className="card p-6 max-w-3xl space-y-5">
      <div>
        <h2 className="font-semibold">Salary calculation period</h2>
        <p className="muted mt-2">
          Choose the attendance and leave dates used to calculate your company's
          monthly salary. The payroll month names the month the period ends.
        </p>
      </div>
      <label className="block">
        Salary cycle
        <select
          disabled={!manage || busy}
          value={selected.salaryPeriodMode}
          onChange={(e) =>
            setDraft({
              ...selected,
              salaryPeriodMode: e.target
                .value as SalaryPeriodPolicy["salaryPeriodMode"],
            })
          }
        >
          <option value="CALENDAR_MONTH">
            Calendar month — 1st to last day
          </option>
          <option value="START_DAY">
            Start on a fixed day — e.g. 25th to 24th
          </option>
          <option value="END_DAY">
            End on a fixed day — e.g. 26th to 25th
          </option>
        </select>
      </label>
      {selected.salaryPeriodMode !== "CALENDAR_MONTH" && (
        <label className="block">
          {selected.salaryPeriodMode === "START_DAY"
            ? "Cycle starts on day"
            : "Cycle ends on day"}
          <select
            disabled={!manage || busy}
            value={selected.salaryBoundaryDay}
            onChange={(e) =>
              setDraft({
                ...selected,
                salaryBoundaryDay: Number(e.target.value),
              })
            }
          >
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        Preview payroll month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {example && (
        <p className="rounded-lg bg-[var(--muted)] p-4">
          {formatCompanyDate(
            example.start.toISOString(),
            me.company.dateFormat,
          )}{" "}
          to{" "}
          {formatCompanyDate(example.end.toISOString(), me.company.dateFormat)}{" "}
          (inclusive) · {example.days} salary days
        </p>
      )}
      <p className="muted text-sm">
        Each day belongs to one cycle. For a 29th–31st boundary missing in a
        shorter month, the last day of that month is used. Monthly pay is
        prorated using the number of calendar days in this period. Absence
        deductions follow Statutory settings.
      </p>
      <p className="muted text-sm">
        Changes apply to new runs. Existing drafts and completed payroll keep
        their original dates. A new run cannot overlap an existing run or leave
        unpaid dates between consecutive months.
      </p>
      {manage && (
        <Button
          disabled={busy || !draft}
          onClick={async () => {
            setBusy(true);
            try {
              await api("payroll/period-policy", {
                method: "PUT",
                body: JSON.stringify(selected),
              });
              await client.invalidateQueries({
                queryKey: ["payroll", "period-policy"],
              });
              setDraft(null);
              notify("Company salary period policy saved.");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save salary period policy"}
        </Button>
      )}
    </section>
  );
}
