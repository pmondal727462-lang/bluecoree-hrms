"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Confirm, Table, when, type Notify } from "./platform";

type Row = {
  category: string;
  minimumDays: number;
  action: string;
  retainDays: number | null;
  enabled: boolean;
  wouldAffect: number | null;
};
type Data = {
  legalHold: boolean;
  policies: Row[];
  runs: {
    id: string;
    category: string;
    cutoff: string;
    dryRun: boolean;
    affected: number;
    createdAt: string;
  }[];
};
const label = (s: string) => s.replaceAll("_", " ");

// Data retention (spec §80): per-category periods above a minimum, a
// preview of what would change, explicit confirmation and a legal hold.
export function RetentionSettings({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["retention"],
    queryFn: () => api<Data>("security/retention"),
  });
  const [days, setDays] = useState<Record<string, string>>({});
  const [run, setRun] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["retention"] });
  const d = data.data;
  if (!d)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const save = async (r: Row, enabled: boolean) => {
    try {
      await api("security/retention", {
        method: "PUT",
        body: JSON.stringify({
          category: r.category,
          retainDays: Number(days[r.category] ?? r.retainDays ?? r.minimumDays),
          enabled,
        }),
      });
      notify("Retention policy saved.");
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <section className="card">
      <div className="toolbar">
        <p className="text-sm max-w-2xl">
          Nothing is removed automatically unless a policy is enabled. Periods
          cannot go below the minimum. Payroll, payslips and statutory records
          are never removed by these policies.
        </p>
        <Button
          size="sm"
          variant={d.legalHold ? "default" : "outline"}
          onClick={async () => {
            const reason = window.prompt(
              d.legalHold
                ? "Reason for lifting the legal hold"
                : "Reason for the legal hold",
            );
            if (!reason) return;
            await api("security/retention/legal-hold", {
              method: "PUT",
              body: JSON.stringify({ enabled: !d.legalHold, reason }),
            });
            await refresh();
          }}
        >
          {d.legalHold ? "Legal hold is ON — lift" : "Place legal hold"}
        </Button>
      </div>
      <Table
        headers={[
          "Data",
          "What happens",
          "Keep for (days)",
          "Would affect now",
          "Policy",
          "",
        ]}
        empty=""
        rows={d.policies.map((r) => [
          label(r.category),
          <span key="a" className="text-xs">
            {r.action}
          </span>,
          <input
            key="d"
            type="number"
            min={r.minimumDays}
            className="w-28"
            value={days[r.category] ?? r.retainDays ?? r.minimumDays}
            onChange={(e) => setDays({ ...days, [r.category]: e.target.value })}
            aria-label={`Days to keep ${label(r.category)}`}
          />,
          r.wouldAffect ?? "—",
          r.enabled ? (
            <span key="e" className="badge positive">
              enabled
            </span>
          ) : (
            "off"
          ),
          <div key="b" className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(r, !r.enabled)}
            >
              {r.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(r, r.enabled)}
            >
              Save
            </Button>
            {r.enabled && !d.legalHold && (
              <Button size="sm" onClick={() => setRun(r.category)}>
                Run now
              </Button>
            )}
          </div>,
        ])}
      />
      <div className="card-title">
        <h2>Recent runs</h2>
      </div>
      <Table
        headers={["When", "Data", "Cutoff", "Type", "Records"]}
        empty="No runs yet."
        rows={d.runs.map((x) => [
          when(x.createdAt),
          label(x.category),
          x.cutoff.slice(0, 10),
          x.dryRun ? "preview" : "applied",
          x.affected,
        ])}
      />
      <Confirm
        open={!!run}
        title={`Apply ${run ? label(run) : ""} retention`}
        text="Records older than the period are permanently removed or anonymised. This cannot be undone. A backup should exist before you continue."
        label="Remove permanently"
        onClose={() => setRun(null)}
        onConfirm={async () => {
          const r = await api<{ affected: number }>("security/retention/run", {
            method: "POST",
            body: JSON.stringify({
              category: run,
              dryRun: false,
              confirm: true,
            }),
          });
          notify(`${r.affected} records processed.`);
          await refresh();
        }}
      />
    </section>
  );
}
