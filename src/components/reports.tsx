"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Play, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Confirm, Heading, Table, type Notify } from "./platform";

type FieldDef = { key: string; label: string; type: string };
type Dataset = {
  key: string;
  label: string;
  dateLabel: string;
  fields: FieldDef[];
};
type Filter = { field: string; op: string; value?: string };
type Aggregate = { field: string; fn: string };
type Config = {
  columns: string[];
  filters: Filter[];
  dateFrom?: string;
  dateTo?: string;
  groupBy?: string;
  aggregates: Aggregate[];
  sort?: { field: string; dir: "asc" | "desc" };
  chart?: { type: "bar" };
};
type Result = {
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, string | number | boolean | null>[];
  total: number;
  truncated: boolean;
  chart: { type: string } | null;
};
type Definition = {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  config: Config;
  shared: boolean;
  createdBy: string;
};
const ops = [
  ["eq", "equals"],
  ["neq", "does not equal"],
  ["contains", "contains"],
  ["gt", ">"],
  ["gte", "≥"],
  ["lt", "<"],
  ["lte", "≤"],
  ["empty", "is empty"],
  ["notEmpty", "is not empty"],
];
const blank = (): Config => ({ columns: [], filters: [], aggregates: [] });

export function ReportsPage({ me, notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const datasets = useQuery({
    queryKey: ["reports", "datasets"],
    queryFn: () => api<Dataset[]>("reports/datasets"),
  });
  const saved = useQuery({
    queryKey: ["reports", "definitions"],
    queryFn: () => api<Definition[]>("reports/definitions"),
  });
  const [dataset, setDataset] = useState(""),
    [config, setConfig] = useState<Config>(blank()),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [shared, setShared] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [deleting, setDeleting] = useState<Definition | null>(null);
  const ds = datasets.data?.find((d) => d.key === dataset);
  const numeric = ds?.fields.filter((f) => f.type === "number") ?? [];
  const set = (c: Partial<Config>) => setConfig({ ...config, ...c });
  const run = async () => {
    setError("");
    try {
      setResult(
        await api<Result>("reports/run", {
          method: "POST",
          body: JSON.stringify({ dataset, config: clean(config) }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const clean = (c: Config): Config => ({
    ...c,
    columns: c.columns.length ? c.columns : ds ? [ds.fields[0].key] : [],
    dateFrom: c.dateFrom || undefined,
    dateTo: c.dateTo || undefined,
    groupBy: c.groupBy || undefined,
    filters: c.filters.map((f) => ({
      ...f,
      value: ["empty", "notEmpty"].includes(f.op)
        ? undefined
        : ds?.fields.find((x) => x.key === f.field)?.type === "number"
          ? (Number(f.value) as unknown as string)
          : f.value,
    })),
  });
  const chartKey = result?.columns.find(
    (c, i) => i > 0 && c.type === "number",
  )?.key;
  return (
    <>
      <Heading
        eyebrow="Analytics"
        title="Custom reports"
        text="Build reports from the data you are allowed to see. Identity and bank details are never available here."
      />
      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <section className="card p-5 space-y-4 self-start">
          <label>
            Dataset
            <select
              value={dataset}
              onChange={(e) => {
                setDataset(e.target.value);
                setConfig(blank());
                setResult(null);
                setEditing(null);
              }}
            >
              <option value="">Choose data</option>
              {(datasets.data ?? []).map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {datasets.error && (
            <div className="error">{datasets.error.message}</div>
          )}
          {ds && (
            <>
              <div className="form-grid">
                <label>
                  {ds.dateLabel} from
                  <input
                    type="date"
                    value={config.dateFrom ?? ""}
                    onChange={(e) => set({ dateFrom: e.target.value })}
                  />
                </label>
                <label>
                  to
                  <input
                    type="date"
                    value={config.dateTo ?? ""}
                    onChange={(e) => set({ dateTo: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Group by
                <select
                  value={config.groupBy ?? ""}
                  onChange={(e) =>
                    set({
                      groupBy: e.target.value,
                      chart: e.target.value ? { type: "bar" } : undefined,
                    })
                  }
                >
                  <option value="">No grouping (list rows)</option>
                  {ds.fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {config.groupBy ? (
                <div className="space-y-2">
                  <p className="subheading">Measures</p>
                  {config.aggregates.map((a, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={a.fn}
                        onChange={(e) =>
                          set({
                            aggregates: config.aggregates.map((x, j) =>
                              j === i ? { ...x, fn: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        {["count", "sum", "avg", "min", "max"].map((fn) => (
                          <option key={fn}>{fn}</option>
                        ))}
                      </select>
                      <select
                        value={a.field}
                        onChange={(e) =>
                          set({
                            aggregates: config.aggregates.map((x, j) =>
                              j === i ? { ...x, field: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        {(a.fn === "count" ? ds.fields : numeric).map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove measure"
                        onClick={() =>
                          set({
                            aggregates: config.aggregates.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      set({
                        aggregates: [
                          ...config.aggregates,
                          {
                            fn: numeric.length ? "sum" : "count",
                            field: (numeric[0] ?? ds.fields[0]).key,
                          },
                        ],
                      })
                    }
                  >
                    <Plus />
                    Add measure
                  </Button>
                  <p className="muted text-xs">
                    Without measures, each group shows a row count.
                  </p>
                </div>
              ) : (
                <fieldset className="space-y-1">
                  <p className="subheading">Columns</p>
                  {ds.fields.map((f) => (
                    <label
                      key={f.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="w-auto"
                        checked={config.columns.includes(f.key)}
                        onChange={(e) =>
                          set({
                            columns: e.target.checked
                              ? [...config.columns, f.key]
                              : config.columns.filter((c) => c !== f.key),
                          })
                        }
                      />
                      {f.label}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="space-y-2">
                <p className="subheading">Filters</p>
                {config.filters.map((flt, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1"
                  >
                    <select
                      value={flt.field}
                      onChange={(e) =>
                        set({
                          filters: config.filters.map((x, j) =>
                            j === i ? { ...x, field: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {ds.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={flt.op}
                      onChange={(e) =>
                        set({
                          filters: config.filters.map((x, j) =>
                            j === i ? { ...x, op: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {ops.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input
                      disabled={["empty", "notEmpty"].includes(flt.op)}
                      value={flt.value ?? ""}
                      onChange={(e) =>
                        set({
                          filters: config.filters.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove filter"
                      onClick={() =>
                        set({
                          filters: config.filters.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    set({
                      filters: [
                        ...config.filters,
                        { field: ds.fields[0].key, op: "eq", value: "" },
                      ],
                    })
                  }
                >
                  <Plus />
                  Add filter
                </Button>
              </div>
              <Button className="w-full" onClick={run}>
                <Play />
                Run report
              </Button>
              <div className="border-t border-[var(--border)] pt-4 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Report name"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={shared}
                    onChange={(e) => setShared(e.target.checked)}
                  />
                  Share with colleagues who can see this data
                </label>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={name.trim().length < 2}
                  onClick={async () => {
                    try {
                      await api(
                        `reports/definitions${editing ? "/" + editing : ""}`,
                        {
                          method: editing ? "PUT" : "POST",
                          body: JSON.stringify({
                            name,
                            dataset,
                            config: clean(config),
                            shared,
                            description: null,
                          }),
                        },
                      );
                      notify("Report saved.");
                      await client.invalidateQueries({ queryKey: ["reports"] });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {editing ? "Update saved report" : "Save report"}
                </Button>
              </div>
            </>
          )}
        </section>
        <div className="space-y-6 min-w-0">
          {error && <div className="error">{error}</div>}
          {result && (
            <section className="card">
              <div className="card-title">
                <h2>
                  Results · {result.total} rows
                  {result.truncated &&
                    " (limited; narrow the date range for complete results)"}
                </h2>
              </div>
              {result.chart && chartKey && (
                <div className="p-4" style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={result.rows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey={result.columns[0].key}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar
                        dataKey={chartKey}
                        name={
                          result.columns.find((c) => c.key === chartKey)?.label
                        }
                        fill="var(--accent)"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="max-h-[480px] overflow-auto">
                <Table
                  headers={result.columns.map((c) => c.label)}
                  empty="No rows match."
                  rows={result.rows.map((r) =>
                    result.columns.map((c) =>
                      r[c.key] === null ? "—" : String(r[c.key]),
                    ),
                  )}
                />
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-title">
              <h2>Saved reports</h2>
            </div>
            <Table
              headers={["Name", "Data", "Shared", ""]}
              loading={saved.isLoading}
              error={saved.error}
              empty="No saved reports yet."
              rows={(saved.data ?? []).map((d) => [
                d.name,
                datasets.data?.find((x) => x.key === d.dataset)?.label ??
                  d.dataset,
                d.shared ? "Yes" : "No",
                <div key="a" className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setDataset(d.dataset);
                      setConfig({ ...blank(), ...d.config });
                      setName(d.name);
                      setShared(d.shared);
                      setEditing(d.createdBy === me.userId ? d.id : null);
                      try {
                        setResult(
                          await api<Result>(`reports/definitions/${d.id}/run`),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Open
                  </Button>
                  {(["csv", "xlsx", "pdf"] as const).map((f) => (
                    <a
                      key={f}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold"
                      href={`/api/reports/definitions/${d.id}/run?format=${f}`}
                    >
                      <Download size={14} />
                      {f === "xlsx" ? "Excel" : f.toUpperCase()}
                    </a>
                  ))}
                  {d.createdBy === me.userId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleting(d)}
                    >
                      Delete
                    </Button>
                  )}
                </div>,
              ])}
            />
          </section>
        </div>
      </div>
      <Confirm
        open={!!deleting}
        title="Delete report"
        text={`Delete "${deleting?.name}"? Colleagues it was shared with lose access too.`}
        label="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await api(`reports/definitions/${deleting!.id}`, {
            method: "DELETE",
          });
          await client.invalidateQueries({ queryKey: ["reports"] });
        }}
      />
    </>
  );
}
