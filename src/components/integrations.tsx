"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Confirm, Heading, Pages, Table, when, type Notify } from "./platform";

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type Connection = {
  id: string;
  category: string;
  provider: string;
  name: string;
  active: boolean;
  config: { endpointUrl?: string; accountMapping?: Record<string, string> };
  lastStatus: string | null;
  lastUsedAt: string | null;
  credential: { hint: string; rotatedAt: string } | null;
};
type Overview = {
  items: Connection[];
  categories: string[];
  webhookEvents: string[];
  apiScopes: string[];
};
type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  failedDeliveries: number;
};
type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
};
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type Log = {
  id: string;
  event: string;
  status: string;
  errorMessage: string | null;
  requestId: string;
  createdAt: string;
  integrationId: string | null;
  integration: { name: string } | null;
  requestData: unknown;
  responseData: unknown;
};
type ApiLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  createdAt: string;
  apiKey: { name: string; prefix: string } | null;
};
const mappingFields = [
  ["salaryExpense", "Salary expense account"],
  ["pfEmployerContribution", "PF employer contribution account"],
  ["esiEmployerContribution", "ESI employer contribution account"],
  ["tdsPayable", "TDS payable account"],
  ["salaryPayable", "Salary payable account"],
  ["otherDeductions", "Other deductions account"],
  ["pfPayable", "PF payable account"],
  ["esiPayable", "ESI payable account"],
  ["ptPayable", "Professional tax payable account"],
  ["reimbursementExpense", "Reimbursement expense account"],
];
const badge = (s: string | null) => (
  <span className={`badge ${s === "SUCCESS" ? "positive" : ""}`}>
    {s ?? "Not used"}
  </span>
);
function Secret({ value, onClose }: { value: string; onClose: () => void }) {
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title="Copy this secret now"
      description="It is stored only in encrypted or hashed form and cannot be shown again."
    >
      <code className="block break-all p-4 rounded-lg bg-[var(--muted)] text-sm">
        {value}
      </code>
      <div className="flex justify-end gap-3 mt-6">
        <Button
          variant="outline"
          onClick={() => navigator.clipboard?.writeText(value)}
        >
          Copy
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}

export function IntegrationsPage({ notify }: { me: Me; notify: Notify }) {
  const [tab, setTab] = useState("connections");
  const overview = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<Overview>("integrations"),
  });
  return (
    <>
      <Heading
        eyebrow="Integration hub"
        title="Integrations"
        text="Connect external systems, issue API keys, send webhooks and export accounting journals."
      />
      <div className="section-tabs">
        {[
          ["connections", "Connections"],
          ["webhooks", "Webhooks"],
          ["keys", "API keys"],
          ["logs", "Logs"],
          ["accounting", "Accounting export"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {overview.error && <div className="error">{overview.error.message}</div>}
      {overview.data &&
        (tab === "connections" ? (
          <Connections data={overview.data} notify={notify} />
        ) : tab === "webhooks" ? (
          <Webhooks events={overview.data.webhookEvents} notify={notify} />
        ) : tab === "keys" ? (
          <ApiKeys scopes={overview.data.apiScopes} notify={notify} />
        ) : tab === "logs" ? (
          <Logs notify={notify} />
        ) : (
          <Accounting connections={overview.data.items} notify={notify} />
        ))}
    </>
  );
}

function Connections({ data, notify }: { data: Overview; notify: Notify }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState<Connection | "new" | null>(null);
  const [testing, setTesting] = useState("");
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Connections</h2>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          Add connection
        </Button>
      </div>
      <p className="muted text-xs px-6 pt-4">
        Connections call an HTTPS endpoint you provide, with the stored secret
        sent as a bearer token. Vendor-specific connectors (for example a
        particular accounting product) need that vendor's API and are not built
        in.
      </p>
      <Table
        headers={[
          "Name",
          "Category",
          "Endpoint",
          "Secret",
          "Last result",
          "Status",
          "Actions",
        ]}
        empty="No connections yet."
        rows={data.items.map((c) => [
          <div key="n">
            <div className="font-semibold">{c.name}</div>
            <span className="muted text-xs">{c.provider}</span>
          </div>,
          c.category.replaceAll("_", " "),
          <span key="u" className="break-all text-xs">
            {c.config.endpointUrl ?? "—"}
          </span>,
          c.credential?.hint ?? "Not set",
          <div key="l">
            {badge(c.lastStatus)}
            <p className="muted text-xs mt-1">{when(c.lastUsedAt)}</p>
          </div>,
          c.active ? "Enabled" : "Disabled",
          <div key="a" className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setEdit(c)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!c.config.endpointUrl || !c.active || testing === c.id}
              onClick={async () => {
                setTesting(c.id);
                try {
                  const log = await api<Log>(
                    `integrations/connections/${c.id}/test`,
                    { method: "POST" },
                  );
                  notify(
                    log.status === "SUCCESS"
                      ? "Connection test succeeded."
                      : `Connection test failed: ${log.errorMessage}`,
                  );
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setTesting("");
                  await client.invalidateQueries({
                    queryKey: ["integrations"],
                  });
                }
              }}
            >
              Test
            </Button>
          </div>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add connection" : "Edit connection"}
        description="Leave the secret blank to keep the current one. Accounting mappings apply to accounting connections."
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { active: "true", category: "ACCOUNTING" }
                : {
                    ...edit,
                    active: String(edit.active),
                    endpointUrl: edit.config.endpointUrl,
                    ...edit.config.accountMapping,
                  }
            }
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "provider", label: "Provider", required: true },
              {
                key: "category",
                label: "Category",
                type: "select",
                required: true,
                options: data.categories.map((c) => ({
                  value: c,
                  label: c.replaceAll("_", " "),
                })),
              },
              {
                key: "active",
                label: "Status",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Enabled" },
                  { value: "false", label: "Disabled" },
                ],
              },
              { key: "endpointUrl", label: "HTTPS endpoint" },
              { key: "secret", label: "Secret / API token", type: "password" },
              ...mappingFields.map(([key, label]) => ({
                key,
                label,
                section: "Accounting account mapping (optional)",
              })),
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              const mapping = Object.fromEntries(
                mappingFields.map(([k]) => [k, v[k]]),
              );
              const hasMapping = Object.values(mapping).some(Boolean);
              if (hasMapping && Object.values(mapping).some((x) => !x))
                throw new Error("Fill every account mapping field or none.");
              await api(
                `integrations/connections${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    name: v.name,
                    provider: v.provider,
                    category: v.category,
                    active: v.active === "true",
                    config: {
                      ...(v.endpointUrl ? { endpointUrl: v.endpointUrl } : {}),
                      ...(hasMapping ? { accountMapping: mapping } : {}),
                    },
                    ...(v.secret ? { secret: v.secret } : {}),
                  }),
                },
              );
              setEdit(null);
              notify("Connection saved.");
              await client.invalidateQueries({ queryKey: ["integrations"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Webhooks({ events, notify }: { events: string[]; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["integrations", "webhooks"],
    queryFn: () => api<Webhook[]>("integrations/webhooks"),
  });
  const [edit, setEdit] = useState<Webhook | "new" | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [secret, setSecret] = useState(""),
    [viewing, setViewing] = useState<Webhook | null>(null);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["integrations", "webhooks"] });
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Webhooks</h2>
        <Button
          size="sm"
          onClick={() => {
            setSelected([]);
            setEdit("new");
          }}
        >
          <Plus />
          Add webhook
        </Button>
      </div>
      <p className="muted text-xs px-6 pt-4">
        Each delivery is signed: verify the <code>x-hrms-signature</code> header
        as <code>sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code>{" "}
        using <code>x-hrms-timestamp</code>. Failed deliveries retry with
        backoff up to 6 times. Payroll and candidate events are listed for
        future modules and are not emitted yet.
      </p>
      <Table
        headers={["Name", "URL", "Events", "Failed", "Status", "Actions"]}
        loading={list.isLoading}
        error={list.error}
        empty="No webhooks yet."
        rows={(list.data ?? []).map((w) => [
          w.name,
          <span key="u" className="break-all text-xs">
            {w.url}
          </span>,
          <span key="e" className="text-xs">
            {w.events.join(", ")}
          </span>,
          w.failedDeliveries,
          w.active ? "Enabled" : "Disabled",
          <div key="a" className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setViewing(w)}>
              Deliveries
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelected(w.events);
                setEdit(w);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await api<{ secret: string }>(
                  `integrations/webhooks/${w.id}/rotate-secret`,
                  { method: "POST" },
                );
                setSecret(r.secret);
              }}
            >
              Rotate secret
            </Button>
          </div>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add webhook" : "Edit webhook"}
        description="Only public HTTPS URLs are accepted."
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { active: "true" }
                : { ...edit, active: String(edit.active) }
            }
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "url", label: "HTTPS URL", required: true },
              {
                key: "active",
                label: "Status",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Enabled" },
                  { value: "false", label: "Disabled" },
                ],
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              if (!selected.length)
                throw new Error("Choose at least one event.");
              const saved = await api<{ secret?: string }>(
                `integrations/webhooks${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    name: v.name,
                    url: v.url,
                    active: v.active === "true",
                    events: selected,
                  }),
                },
              );
              setEdit(null);
              if (saved.secret) setSecret(saved.secret);
              notify("Webhook saved.");
              await refresh();
            }}
          >
            <fieldset className="grid sm:grid-cols-2 gap-2 mt-5">
              {events.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={selected.includes(e)}
                    onChange={(x) =>
                      setSelected(
                        x.target.checked
                          ? [...selected, e]
                          : selected.filter((s) => s !== e),
                      )
                    }
                  />
                  {e}
                </label>
              ))}
            </fieldset>
          </RecordForm>
        )}
      </Dialog>
      <Secret value={secret} onClose={() => setSecret("")} />
      <Dialog
        open={!!viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        title={`Deliveries · ${viewing?.name ?? ""}`}
        description="Most recent deliveries first."
      >
        {viewing && <Deliveries webhook={viewing} notify={notify} />}
      </Dialog>
    </section>
  );
}
function Deliveries({ webhook, notify }: { webhook: Webhook; notify: Notify }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["integrations", "deliveries", webhook.id, page],
    queryFn: () =>
      api<Paged<Delivery>>(
        `integrations/webhooks/${webhook.id}/deliveries?page=${page}&pageSize=10`,
      ),
  });
  return (
    <>
      <Table
        headers={["Event", "Status", "Attempts", "Response", "Created", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No deliveries yet."
        rows={(list.data?.items ?? []).map((d) => [
          d.event,
          badge(d.status),
          d.attempts,
          d.responseStatus ?? d.errorMessage ?? "—",
          when(d.createdAt),
          ["FAILED", "PENDING"].includes(d.status) ? (
            <Button
              key="r"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const r = await api<Delivery>(
                    `integrations/deliveries/${d.id}/retry`,
                    { method: "POST" },
                  );
                  notify(`Delivery ${r.status.toLowerCase()}.`);
                } catch (e) {
                  notify((e as Error).message);
                }
                await client.invalidateQueries({ queryKey: ["integrations"] });
              }}
            >
              Retry
            </Button>
          ) : null,
        ])}
      />
      <Pages data={list.data} page={page} setPage={setPage} />
    </>
  );
}

function ApiKeys({ scopes, notify }: { scopes: string[]; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["integrations", "keys"],
    queryFn: () => api<ApiKey[]>("integrations/api-keys"),
  });
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [key, setKey] = useState(""),
    [revoking, setRevoking] = useState<ApiKey | null>(null);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["integrations", "keys"] });
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>API keys</h2>
        <Button
          size="sm"
          onClick={() => {
            setSelected([]);
            setCreating(true);
          }}
        >
          <Plus />
          Create key
        </Button>
      </div>
      <p className="muted text-xs px-6 pt-4">
        Send the key as <code>x-api-key</code> or{" "}
        <code>Authorization: Bearer</code> to read-only endpoints:{" "}
        <code>GET /api/v1/employees</code>, <code>/attendance</code>,{" "}
        <code>/leave</code>, <code>/payroll</code>, <code>/payslips</code>.
        Identity and bank data are never returned.
      </p>
      <Table
        headers={[
          "Name",
          "Key",
          "Scopes",
          "Last used",
          "Expires",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No API keys yet."
        rows={(list.data ?? []).map((k) => [
          k.name,
          <code key="p">{k.prefix}_…</code>,
          <span key="s" className="text-xs">
            {k.scopes.join(", ")}
          </span>,
          when(k.lastUsedAt),
          when(k.expiresAt),
          k.revokedAt ? "Revoked" : "Active",
          k.revokedAt ? null : (
            <Button
              key="r"
              size="sm"
              variant="outline"
              onClick={() => setRevoking(k)}
            >
              Revoke
            </Button>
          ),
        ])}
      />
      <Dialog open={creating} onOpenChange={setCreating} title="Create API key">
        {creating && (
          <RecordForm
            fields={[
              { key: "name", label: "Name", required: true },
              {
                key: "expiresInDays",
                label: "Expires after (days, optional)",
                type: "number",
              },
            ]}
            onCancel={() => setCreating(false)}
            onSave={async (v) => {
              if (!selected.length)
                throw new Error("Choose at least one scope.");
              const created = await api<{ key: string }>(
                "integrations/api-keys",
                {
                  method: "POST",
                  body: JSON.stringify({
                    name: v.name,
                    scopes: selected,
                    ...(v.expiresInDays
                      ? { expiresInDays: Number(v.expiresInDays) }
                      : {}),
                  }),
                },
              );
              setCreating(false);
              setKey(created.key);
              await refresh();
            }}
          >
            <fieldset className="space-y-2 mt-5">
              {scopes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={selected.includes(s)}
                    onChange={(x) =>
                      setSelected(
                        x.target.checked
                          ? [...selected, s]
                          : selected.filter((v) => v !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </fieldset>
          </RecordForm>
        )}
      </Dialog>
      <Secret value={key} onClose={() => setKey("")} />
      <Confirm
        open={!!revoking}
        title="Revoke API key"
        text={`Revoke ${revoking?.name}? Systems using it lose access immediately.`}
        label="Revoke"
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          await api(`integrations/api-keys/${revoking!.id}`, {
            method: "DELETE",
          });
          notify("API key revoked.");
          await refresh();
        }}
      />
    </section>
  );
}

function Logs({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [apiPage, setApiPage] = useState(1),
    [detail, setDetail] = useState<Log | null>(null);
  const logs = useQuery({
    queryKey: ["integrations", "logs", page],
    queryFn: () => api<Paged<Log>>(`integrations/logs?page=${page}`),
  });
  const apiLogs = useQuery({
    queryKey: ["integrations", "api-logs", apiPage],
    queryFn: () => api<Paged<ApiLog>>(`integrations/api-logs?page=${apiPage}`),
  });
  return (
    <>
      <section className="card mb-6">
        <div className="card-title">
          <h2>Integration requests</h2>
        </div>
        <Table
          headers={["Time", "Integration", "Event", "Status", "Error", ""]}
          loading={logs.isLoading}
          error={logs.error}
          empty="No integration requests yet."
          rows={(logs.data?.items ?? []).map((l) => [
            when(l.createdAt),
            l.integration?.name ?? "Removed",
            l.event,
            badge(l.status),
            l.errorMessage ?? "—",
            <div key="a" className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDetail(l)}>
                Details
              </Button>
              {l.status !== "SUCCESS" && l.integrationId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const r = await api<Log>(
                        `integrations/logs/${l.id}/retry`,
                        {
                          method: "POST",
                        },
                      );
                      notify(`Retry ${r.status.toLowerCase()}.`);
                    } catch (e) {
                      notify((e as Error).message);
                    }
                    await client.invalidateQueries({
                      queryKey: ["integrations"],
                    });
                  }}
                >
                  Retry
                </Button>
              )}
            </div>,
          ])}
        />
        <Pages data={logs.data} page={page} setPage={setPage} />
      </section>
      <section className="card">
        <div className="card-title">
          <h2>Public API calls</h2>
        </div>
        <Table
          headers={["Time", "Key", "Request", "Status", "Duration"]}
          loading={apiLogs.isLoading}
          error={apiLogs.error}
          empty="No API calls yet."
          rows={(apiLogs.data?.items ?? []).map((l) => [
            when(l.createdAt),
            l.apiKey ? `${l.apiKey.name} (${l.apiKey.prefix})` : "Deleted key",
            `${l.method} ${l.path}`,
            l.status,
            `${l.durationMs} ms`,
          ])}
        />
        <Pages data={apiLogs.data} page={apiPage} setPage={setApiPage} />
      </section>
      <Dialog
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        title="Request details"
        description={detail ? `Request ID ${detail.requestId}` : undefined}
      >
        <pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto p-4 rounded-lg bg-[var(--muted)]">
          {detail &&
            JSON.stringify(
              { request: detail.requestData, response: detail.responseData },
              null,
              2,
            )}
        </pre>
      </Dialog>
    </>
  );
}

function Accounting({
  connections,
  notify,
}: {
  connections: Connection[];
  notify: Notify;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01"),
    [to, setTo] = useState(today),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false);
  const accounting = connections.filter(
    (c) => c.category === "ACCOUNTING" && c.active,
  );
  return (
    <section className="card p-6 space-y-5">
      <p className="muted text-sm">
        Builds a payroll journal from issued payslips: salary expense (gross)
        against salary payable (net) and other deductions. Account names come
        from the first accounting connection&apos;s mapping. PF, ESI and TDS
        lines are not produced because payroll does not yet record those
        components separately.
      </p>
      <div className="flex flex-wrap gap-4 items-end">
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {(["csv", "xlsx", "json"] as const).map((f) => (
          <a
            key={f}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[var(--border)] text-sm font-semibold"
            href={`/api/integrations/accounting-export?from=${from}&to=${to}&format=${f}`}
          >
            <Download size={16} />
            {f === "xlsx" ? "Excel" : f.toUpperCase()}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 items-end">
        <label>
          Send to accounting connection
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select connection</option>
            {accounting.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!target || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const log = await api<Log>(
                "integrations/accounting-export/push",
                {
                  method: "POST",
                  body: JSON.stringify({ integrationId: target, from, to }),
                },
              );
              notify(
                log.status === "SUCCESS"
                  ? "Journal sent to the accounting system."
                  : `Sending failed: ${log.errorMessage}. Retry it from Logs.`,
              );
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Send via API
        </Button>
      </div>
    </section>
  );
}
