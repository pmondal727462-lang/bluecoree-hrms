"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Pages, Table, when, type Notify } from "./platform";
import { PlatformBilling } from "./platform-billing";
import { featureLabels } from "./saas";
import { CompanyList } from "./settings";
import {
  Conversation,
  Reply,
  label,
  priorities,
  readAttachment,
  statusBadge,
  type Thread,
  type Ticket,
} from "./support";

type Overview = {
  companies: number;
  subscriptions: Record<string, number>;
  activeUsers: number;
  usersActiveLast30Days: number;
  employees: number;
  apiCallsThisMonth: number;
  aiRequestsThisMonth: number;
  storageMb: number;
  openTickets: number;
  failingIntegrations: number;
  payments: { configured: boolean; note: string };
};
type CompanyRow = {
  id: string;
  deletionBlockedReason: string | null;
  companyStatus: string;
  suspendReason: string | null;
  lastLoginAt: string | null;
  name: string;
  code: string;
  plan: string | null;
  planCode: string | null;
  storedStatus: string | null;
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceDays: number | null;
  notes: string | null;
  enabledFeatures: string[];
  disabledFeatures: string[];
  employees: number;
  users: number;
  employeeLimit: number | null;
  effectiveEmployeeLimit: number | null;
  activeUsers30d: number;
  apiCalls: number;
  aiRequests: number;
  integrations: { active: number; failing: number };
};
type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number | null;
  priceAnnual: number | null;
  pricePerEmployeeMonthly: number | null;
  pricePerEmployeeAnnual: number | null;
  minimumMonthly: number | null;
  currency: string;
  employeeLimit: number | null;
  deviceLimit?: number | null;
  adminLimit: number | null;
  storageLimitMb: number | null;
  apiCallLimitMonthly: number | null;
  aiRequestLimitMonthly: number | null;
  features: string[];
  trialDays: number | null;
  active: boolean;
  public: boolean;
  sortOrder: number;
};
type Check = {
  component: string;
  status: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};
type Backup = {
  id: string;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  sizeBytes: number | null;
  location: string | null;
  checksum: string | null;
  verificationStatus: string | null;
  restoreTestedAt: string | null;
  deletedAt: string | null;
  error: string | null;
};
const tone = (s: string | null) =>
  s && ["UP", "ACTIVE", "TRIAL", "SUCCESS"].includes(s)
    ? "positive"
    : s && ["DEGRADED", "GRACE", "NOT_CONFIGURED"].includes(s)
      ? "amber"
      : "";
const size = (b: number | null) =>
  b === null
    ? "—"
    : b > 1048576
      ? `${(b / 1048576).toFixed(1)} MB`
      : `${Math.ceil(b / 1024)} KB`;
const isoOrNull = (v: string) => (v ? new Date(v).toISOString() : null);
const num = (v: string) => (v === "" || v === undefined ? null : Number(v));

export function PlatformPage({ me, notify }: { me: Me; notify: Notify }) {
  const [tab, setTab] = useState(me.isSuperAdmin ? "companies" : "overview");
  return (
    <>
      <Heading
        eyebrow={me.isSuperAdmin ? "Software owner" : "Platform support"}
        title="Management dashboard"
        text="Manage your clients, their subscriptions and access rights, and the prices published on your website."
      />
      <div className="section-tabs">
        {(me.isSuperAdmin
          ? [
              ["companies", "Client list"],
              ["subscriptions", "Client subscriptions"],
              ["add-client", "Add client"],
              ["plans", "Pricing"],
            ]
          : [
              ["overview", "Overview"],
              ["companies", "Clients & subscriptions"],
              ["plans", "Website pricing & plans"],
              ["billing", "Billing"],
              ["support", "Support"],
              ["health", "System health"],
              ["backups", "Backups"],
              ["audit", "Audit logs"],
            ]
        ).map(([key, text]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <OverviewTab />
      ) : tab === "companies" || tab === "subscriptions" ? (
        <Companies
          me={me}
          notify={notify}
          subscriptions={tab === "subscriptions"}
        />
      ) : tab === "add-client" ? (
        <CompanyList notify={notify} createOnly />
      ) : tab === "billing" ? (
        <PlatformBilling me={me} notify={notify} />
      ) : tab === "plans" ? (
        <>
          <Plans notify={notify} />
          <div className="mt-6">
            <PlatformBilling me={me} notify={notify} pricingOnly />
          </div>
        </>
      ) : tab === "support" ? (
        <Desk me={me} notify={notify} />
      ) : tab === "health" ? (
        <Health />
      ) : tab === "backups" ? (
        <Backups />
      ) : (
        <Audit />
      )}
    </>
  );
}

function OverviewTab() {
  const data = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => api<Overview>("platform/overview"),
  });
  const d = data.data;
  if (!d)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const stats: [string, string | number][] = [
    ["Companies", d.companies],
    ["On trial", d.subscriptions.TRIAL],
    ["Active subscriptions", d.subscriptions.ACTIVE],
    ["In grace period", d.subscriptions.GRACE],
    ["Expired", d.subscriptions.EXPIRED],
    ["Active users", d.activeUsers],
    ["Users active in 30 days", d.usersActiveLast30Days],
    ["Active employees", d.employees],
    ["API calls this month", d.apiCallsThisMonth],
    ["AI requests this month", d.aiRequestsThisMonth],
    ["Stored files (MB)", d.storageMb],
    ["Open tickets", d.openTickets],
    ["Failing integrations", d.failingIntegrations],
  ];
  return (
    <>
      <div className="stat-grid">
        {stats.map(([k, v]) => (
          <div className="card stat" key={k}>
            <div className="stat-label">{k}</div>
            <div className="stat-value">{v}</div>
          </div>
        ))}
      </div>
      <p className="muted text-sm mt-6">Payments: {d.payments.note}</p>
    </>
  );
}

function Companies({
  me,
  notify,
  subscriptions = false,
}: {
  me: Me;
  notify: Notify;
  subscriptions?: boolean;
}) {
  const client = useQueryClient();
  const [reset, setReset] = useState<{
    user: { name: string; email: string; role: string };
    resetUrl: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<CompanyRow | null>(null);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const act = async (
    c: CompanyRow,
    action: string,
    body: Record<string, unknown>,
  ) => {
    try {
      const r = await api<Record<string, unknown>>(
        `platform/companies/${c.id}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (action === "reset-access") setReset(r as never);
      else notify("Company updated.");
      await client.invalidateQueries({ queryKey: ["platform"] });
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const [edit, setEdit] = useState<CompanyRow | null>(null),
    [creating, setCreating] = useState(false);
  const [rights, setRights] = useState<CompanyRow | null>(null);
  const list = useQuery({
    queryKey: ["platform", "companies"],
    queryFn: () => api<CompanyRow[]>("platform/companies"),
  });
  const plans = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => api<Plan[]>("platform/plans"),
  });
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>{subscriptions ? "Client subscription details" : "Clients"}</h2>
        {!me.isSuperAdmin && (
          <Button size="sm" onClick={() => setCreating(!creating)}>
            <Plus />
            {creating ? "Hide company creation" : "Create company"}
          </Button>
        )}
      </div>
      {creating && (
        <div className="p-6">
          <CompanyList notify={notify} />
        </div>
      )}
      <Table
        headers={[
          "Company",
          "Plan",
          "Status",
          "Ends",
          "Employees / licence limit",
          ...(subscriptions
            ? [
                "Annual price / employee",
                "Annual base fee",
                "Annual plan estimate (before tax/add-ons)",
              ]
            : ["Users", "Last login"]),
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No companies."
        rows={(list.data ?? []).map((c) => [
          <div key="c">
            <div className="font-semibold">{c.name}</div>
            <span className="muted text-xs">{c.code}</span>
          </div>,
          c.plan ?? "None",
          <div key="s">
            <span className={`badge ${tone(c.status)}`}>{c.status ?? "—"}</span>
            {c.companyStatus === "SUSPENDED" && (
              <span
                className="badge amber ml-1"
                title={c.suspendReason ?? undefined}
              >
                Suspended
              </span>
            )}
          </div>,
          when(c.storedStatus === "TRIAL" ? c.trialEndsAt : c.currentPeriodEnd),
          `${c.employees} / ${c.effectiveEmployeeLimit ?? "Plan has no cap"}`,
          ...(subscriptions
            ? (() => {
                const p = plans.data?.find((p) => p.code === c.planCode);
                const money = (n: number) =>
                  new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: p?.currency ?? "INR",
                  }).format(n);
                return [
                  p?.pricePerEmployeeAnnual != null
                    ? money(p.pricePerEmployeeAnnual)
                    : "Custom quote",
                  p?.priceAnnual != null ? money(p.priceAnnual) : "—",
                  p &&
                  (p.priceAnnual !== null || p.pricePerEmployeeAnnual !== null)
                    ? money(
                        Math.max(
                          Number(p.minimumMonthly ?? 0) * 12,
                          Number(p.priceAnnual ?? 0) +
                            Number(p.pricePerEmployeeAnnual ?? 0) *
                              Math.max(1, c.employees),
                        ),
                      )
                    : "Custom quote",
                ];
              })()
            : [c.users, when(c.lastLoginAt)]),
          <div key="a" className="flex gap-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setEdit(c)}>
              Subscription
            </Button>
            {me.platformRole === "super" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRights(c)}
                >
                  Client access
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const enabling = c.companyStatus === "SUSPENDED";
                    const reason = enabling
                      ? ""
                      : window.prompt("Reason for suspension (optional)");
                    if (reason === null) return;
                    void act(c, "status", {
                      status: enabling ? "ACTIVE" : "SUSPENDED",
                      ...(reason ? { reason } : {}),
                    });
                  }}
                >
                  {c.companyStatus === "SUSPENDED"
                    ? "Enable client"
                    : "Suspend client"}
                </Button>
                {c.storedStatus === "TRIAL" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const days = Number(
                        window.prompt(
                          "Extend the trial by how many days?",
                          "7",
                        ),
                      );
                      if (days > 0) act(c, "extend-trial", { days });
                    }}
                  >
                    Extend trial
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(c, "reset-access", {})}
                >
                  Reset login
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setDeleting(c);
                    setDeleteCode("");
                    setDeleteError("");
                  }}
                >
                  Delete company
                </Button>
              </>
            )}
          </div>,
        ])}
      />
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "company"}?`}
        description="Permanently removes this company and its users, employee records, attendance, payroll, documents, subscriptions and other company data. This cannot be undone."
      >
        {deleting && (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                deleteBusy ||
                deleting.deletionBlockedReason ||
                deleteCode !== deleting.code
              )
                return;
              setDeleteBusy(true);
              setDeleteError("");
              try {
                const result = await api<{ pendingFiles: number }>(
                  `platform/companies/${deleting.id}`,
                  {
                    method: "DELETE",
                    body: JSON.stringify({ companyCode: deleteCode }),
                  },
                );
                setDeleting(null);
                notify(
                  result.pendingFiles
                    ? "Company deleted. Some uploaded files are awaiting cleanup."
                    : "Company and its data deleted.",
                );
                await client.invalidateQueries({ queryKey: ["platform"] });
                await client.invalidateQueries({ queryKey: ["companies"] });
              } catch (error) {
                setDeleteError(
                  error instanceof Error
                    ? error.message
                    : "Could not delete company.",
                );
              } finally {
                setDeleteBusy(false);
              }
            }}
          >
            <p className="text-sm">
              Company code: <strong>{deleting.code}</strong> · {deleting.users}{" "}
              user accounts
            </p>
            {deleting.deletionBlockedReason ? (
              <p className="error" role="alert">
                {deleting.deletionBlockedReason}
              </p>
            ) : (
              <label className="block">
                Type <strong>{deleting.code}</strong> to confirm
                <input
                  autoComplete="off"
                  value={deleteCode}
                  disabled={deleteBusy}
                  onChange={(event) => setDeleteCode(event.target.value)}
                />
              </label>
            )}
            {deleteError && (
              <p className="error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteBusy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  deleteBusy ||
                  !!deleting.deletionBlockedReason ||
                  deleteCode !== deleting.code
                }
              >
                {deleteBusy ? "Deleting…" : "Permanently delete company"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!rights}
        onOpenChange={(v) => !v && setRights(null)}
        title={`Access rights · ${rights?.name ?? ""}`}
        description="Use the plan and add-ons by default, allow an extra module, or block it for this client. Subscription expiry still applies. Employee roles remain managed within the client’s workspace."
      >
        {rights && (
          <RecordForm
            initial={Object.fromEntries(
              Object.keys(featureLabels).map((key) => [
                key,
                rights.disabledFeatures.includes(key)
                  ? "block"
                  : rights.enabledFeatures.includes(key)
                    ? "allow"
                    : "plan",
              ]),
            )}
            fields={Object.entries(featureLabels).map(([key, label]) => ({
              key,
              label,
              type: "select" as const,
              options: [
                { value: "plan", label: "Follow plan and add-ons" },
                { value: "allow", label: "Allow" },
                { value: "block", label: "Block" },
              ],
            }))}
            onCancel={() => setRights(null)}
            onSave={async (v) => {
              await api(`platform/companies/${rights.id}/rights`, {
                method: "PUT",
                body: JSON.stringify({
                  enabledFeatures: Object.keys(featureLabels).filter(
                    (key) => v[key] === "allow",
                  ),
                  disabledFeatures: Object.keys(featureLabels).filter(
                    (key) => v[key] === "block",
                  ),
                }),
              });
              setRights(null);
              notify("Client access rights updated.");
              await client.invalidateQueries({ queryKey: ["platform"] });
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!reset}
        onOpenChange={(v) => !v && setReset(null)}
        title="Access reset"
        description="Share this one-time link with the account owner through a verified channel. It expires in 24 hours."
      >
        {reset && (
          <div className="space-y-3 text-sm">
            <p>
              {reset.user.name} · {reset.user.email} · {reset.user.role}
            </p>
            <code className="block break-all p-3 rounded bg-[var(--muted)]">
              {reset.resetUrl}
            </code>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={`Subscription · ${edit?.name ?? ""}`}
        description="Changes apply immediately. Expired companies keep their data; paid modules are paused."
      >
        {edit && (
          <RecordForm
            initial={{
              planCode: edit.planCode,
              employeeLimit: edit.employeeLimit,
              status: edit.storedStatus,
              trialEndsAt: edit.trialEndsAt?.slice(0, 10),
              currentPeriodEnd: edit.currentPeriodEnd?.slice(0, 10),
              graceDays: edit.graceDays ?? 7,
              notes: edit.notes,
            }}
            fields={[
              {
                key: "planCode",
                label: "Plan",
                type: "select",
                required: true,
                options: (plans.data ?? [])
                  .filter((p) => ["BASIC", "PROFESSIONAL"].includes(p.code))
                  .map((p) => ({
                    value: p.code,
                    label: p.name,
                  })),
              },
              {
                key: "status",
                label: "Status",
                type: "select",
                required: true,
                options: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"].map(
                  (s) => ({ value: s, label: label(s) }),
                ),
              },
              { key: "trialEndsAt", label: "Trial ends", type: "date" },
              {
                key: "employeeLimit",
                label: "Employee licence limit (e.g. 50; blank = plan limit)",
                type: "number",
              },
              {
                key: "currentPeriodEnd",
                label: "Current period ends (blank = no end)",
                type: "date",
              },
              {
                key: "graceDays",
                label: "Grace days",
                type: "number",
                required: true,
              },
              {
                key: "notes",
                label: "Notes (e.g. payment reference)",
                type: "textarea",
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(`platform/subscriptions/${edit.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  planCode: v.planCode,
                  employeeLimit: num(v.employeeLimit),
                  status: v.status,
                  trialEndsAt: isoOrNull(v.trialEndsAt),
                  currentPeriodEnd: isoOrNull(v.currentPeriodEnd),
                  graceDays: Number(v.graceDays),
                  notes: v.notes || null,
                }),
              });
              setEdit(null);
              notify("Subscription updated.");
              await client.invalidateQueries({ queryKey: ["platform"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Plans({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => api<Plan[]>("platform/plans"),
  });
  const [edit, setEdit] = useState<Plan | null>(null),
    [features, setFeatures] = useState<string[]>([]);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Website pricing & plans</h2>
      </div>
      <p className="muted text-xs px-6 pt-4">
        Employee capacity is separate from billing. Price = base fee +
        per-employee price × active employees, never below the minimum monthly
        charge (× 12 for annual), plus add-ons, less coupons, plus GST.
      </p>
      <Table
        headers={[
          "Plan",
          "Employee price & base fee",
          "Employee capacity",
          "Admins",
          "Storage MB",
          "API / AI per month",
          "Modules",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No plans."
        rows={(list.data ?? [])
          .filter((p) => ["BASIC", "PROFESSIONAL"].includes(p.code))
          .map((p) => [
            <div key="n">
              <div className="font-semibold">{p.name}</div>
            </div>,
            <div key="price" className="text-sm">
              {p.pricePerEmployeeAnnual !== null || p.priceAnnual !== null ? (
                <>
                  <div>
                    {p.currency} {p.pricePerEmployeeAnnual ?? 0} / employee /
                    year
                  </div>
                  <div className="muted">
                    + {p.currency} {p.priceAnnual ?? 0} annual base fee
                  </div>
                </>
              ) : null}
              {p.pricePerEmployeeMonthly !== null || p.priceMonthly !== null ? (
                <>
                  <div>
                    {p.currency} {p.pricePerEmployeeMonthly ?? 0} / employee /
                    month
                  </div>
                  <div className="muted">
                    + {p.currency} {p.priceMonthly ?? 0} monthly base fee
                  </div>
                </>
              ) : (
                <div className="muted">
                  {p.priceAnnual !== null || p.pricePerEmployeeAnnual !== null
                    ? "Annual billing only"
                    : "Custom quote"}
                </div>
              )}
            </div>,
            p.employeeLimit ?? "Scales with your team",
            p.adminLimit ?? "∞",
            p.storageLimitMb ?? "∞",
            `${p.apiCallLimitMonthly ?? "∞"} / ${p.aiRequestLimitMonthly ?? "∞"}`,
            <span key="f" className="text-xs">
              {p.features.map((f) => featureLabels[f] ?? f).join(", ")}
            </span>,
            p.active ? "Offered" : "Hidden",
            <Button
              key="e"
              size="sm"
              variant="outline"
              onClick={() => {
                setFeatures(p.features);
                setEdit(p);
              }}
            >
              Edit
            </Button>,
          ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit ? `Edit ${edit.name}` : "Edit plan"}
      >
        {edit && (
          <RecordForm
            initial={{
              ...edit,
              active: String(edit.active),
              public: String(edit.public),
            }}
            fields={[
              {
                key: "priceMonthly",
                label: "Monthly price (flat)",
                type: "number",
              },
              {
                key: "priceAnnual",
                label: "Annual price (flat)",
                type: "number",
              },
              {
                key: "pricePerEmployeeMonthly",
                label: "Per employee / month",
                type: "number",
              },
              {
                key: "pricePerEmployeeAnnual",
                label: "Per employee / year",
                type: "number",
              },
              {
                key: "minimumMonthly",
                label: "Minimum monthly charge",
                type: "number",
              },
              { key: "taxRate", label: "GST rate %", type: "number" },
              { key: "locationLimit", label: "Location limit", type: "number" },
              { key: "currency", label: "Currency", required: true },
              { key: "employeeLimit", label: "Employee limit", type: "number" },
              {
                key: "deviceLimit",
                label: "Biometric device limit",
                type: "number",
              },
              { key: "adminLimit", label: "Admin limit", type: "number" },
              {
                key: "storageLimitMb",
                label: "Storage limit (MB)",
                type: "number",
              },
              {
                key: "apiCallLimitMonthly",
                label: "API calls per month",
                type: "number",
              },
              {
                key: "aiRequestLimitMonthly",
                label: "AI requests per month",
                type: "number",
              },
              {
                key: "sortOrder",
                label: "Sort order",
                type: "number",
                required: true,
              },
              {
                key: "active",
                label: "Offered to customers",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
              },
              {
                key: "public",
                label: "Show on website pricing page",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No — private client plan" },
                ],
              },
              { key: "description", label: "Description", type: "textarea" },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(`platform/plans/${edit.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  code: edit.code,
                  name: edit.code === "BASIC" ? "Basic" : "Advanced",
                  description: v.description || null,
                  priceMonthly: num(v.priceMonthly),
                  priceAnnual: num(v.priceAnnual),
                  pricePerEmployeeMonthly: num(v.pricePerEmployeeMonthly),
                  pricePerEmployeeAnnual: num(v.pricePerEmployeeAnnual),
                  minimumMonthly: num(v.minimumMonthly),
                  taxRate: num(v.taxRate) ?? 18,
                  locationLimit: num(v.locationLimit),
                  currency: v.currency.toUpperCase(),
                  employeeLimit: num(v.employeeLimit),
                  deviceLimit: num(v.deviceLimit),
                  adminLimit: num(v.adminLimit),
                  storageLimitMb: num(v.storageLimitMb),
                  apiCallLimitMonthly: num(v.apiCallLimitMonthly),
                  aiRequestLimitMonthly: num(v.aiRequestLimitMonthly),
                  trialDays: edit.trialDays,
                  sortOrder: Number(v.sortOrder),
                  active: v.active === "true",
                  public: v.public === "true",
                  features,
                }),
              });
              setEdit(null);
              notify("Plan saved.");
              await client.invalidateQueries({ queryKey: ["platform"] });
            }}
          >
            <fieldset className="grid sm:grid-cols-2 gap-2 mt-5">
              {Object.entries(featureLabels).map(([key, text]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={features.includes(key)}
                    onChange={(e) =>
                      setFeatures(
                        e.target.checked
                          ? [...features, key]
                          : features.filter((f) => f !== key),
                      )
                    }
                  />
                  {text}
                </label>
              ))}
            </fieldset>
          </RecordForm>
        )}
      </Dialog>
    </section>
  );
}

function Desk({ notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const [status, setStatus] = useState(""),
    [open, setOpen] = useState<string | null>(null);
  const tickets = useQuery({
    queryKey: ["platform", "tickets", status],
    queryFn: () =>
      api<Ticket[]>(`platform/tickets${status ? `?status=${status}` : ""}`),
  });
  const thread = useQuery({
    queryKey: ["platform", "ticket", open],
    queryFn: () => api<Thread>(`platform/tickets/${open}`),
    enabled: !!open,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["platform"] });
  const t = thread.data;
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {[
              "OPEN",
              "IN_PROGRESS",
              "WAITING_ON_CUSTOMER",
              "RESOLVED",
              "CLOSED",
            ].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Table
        headers={[
          "#",
          "Company",
          "Subject",
          "Category",
          "Priority",
          "Status",
          "Assigned",
          "Updated",
        ]}
        loading={tickets.isLoading}
        error={tickets.error}
        empty="No tickets."
        rows={(tickets.data ?? []).map((x) => [
          x.number,
          x.company?.name ?? "—",
          <button
            key="s"
            className="text-blue-700 underline text-left"
            onClick={() => setOpen(x.id)}
          >
            {x.subject}
          </button>,
          label(x.category),
          label(x.priority),
          statusBadge(x.status),
          x.assignedTo ?? "—",
          when(x.lastMessageAt),
        ])}
      />
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={t ? `#${t.number} · ${t.subject}` : "Ticket"}
        description={
          t ? `${t.company?.name} · opened by ${t.createdByName}` : undefined
        }
      >
        {t && (
          <>
            <div className="form-grid mb-4">
              <label>
                Status
                <select
                  value={t.status}
                  onChange={async (e) => {
                    await api(`platform/tickets/${t.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        status: e.target.value,
                        priority: t.priority,
                        assignedTo: t.assignedTo,
                      }),
                    });
                    await refresh();
                  }}
                >
                  {[
                    "OPEN",
                    "IN_PROGRESS",
                    "WAITING_ON_CUSTOMER",
                    "RESOLVED",
                    "CLOSED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={t.priority}
                  onChange={async (e) => {
                    await api(`platform/tickets/${t.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        status: t.status,
                        priority: e.target.value,
                        assignedTo: t.assignedTo,
                      }),
                    });
                    await refresh();
                  }}
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {label(p)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Conversation thread={t} support />
            <Reply
              internalOption
              onSend={async (body, file, internal) => {
                await api(`platform/tickets/${t.id}/messages`, {
                  method: "POST",
                  body: JSON.stringify({
                    body,
                    internal,
                    attachment: await readAttachment(file),
                  }),
                });
                notify(internal ? "Internal note added." : "Reply sent.");
                await refresh();
              }}
            />
          </>
        )}
      </Dialog>
    </section>
  );
}

function Health() {
  const data = useQuery({
    queryKey: ["platform", "health"],
    queryFn: () => api<{ checks: Check[] }>("platform/health"),
    refetchInterval: 60000,
  });
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>System health</h2>
        <Button size="sm" variant="outline" onClick={() => data.refetch()}>
          Run checks
        </Button>
      </div>
      <Table
        headers={["Component", "Status", "Latency", "Details"]}
        loading={data.isFetching && !data.data}
        error={data.error}
        empty="No results."
        rows={(data.data?.checks ?? []).map((c) => [
          label(c.component),
          <span key="s" className={`badge ${tone(c.status)}`}>
            {label(c.status)}
          </span>,
          c.latencyMs === undefined ? "—" : `${c.latencyMs} ms`,
          <code key="d" className="text-xs break-all">
            {c.details ? JSON.stringify(c.details) : "—"}
          </code>,
        ])}
      />
    </section>
  );
}

function Backups() {
  const data = useQuery({
    queryKey: ["platform", "backups"],
    queryFn: () =>
      api<{
        latest: Backup | null;
        lastSuccess: Backup | null;
        next: { daily: string; weekly: string };
        location: string;
        encryptionConfigured: boolean;
        retention: { dailyDays: number; weeklyDays: number };
        items: Backup[];
      }>("platform/backups"),
  });
  const d = data.data;
  if (!d)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const stats: [string, string][] = [
    [
      "Last backup",
      d.latest
        ? `${when(d.latest.startedAt)} · ${label(d.latest.status)}`
        : "None yet",
    ],
    [
      "Last successful",
      d.lastSuccess ? when(d.lastSuccess.startedAt) : "None yet",
    ],
    ["Size", size(d.lastSuccess?.sizeBytes ?? null)],
    ["Location", d.location],
    ["Next daily", when(d.next.daily)],
    ["Next weekly", when(d.next.weekly)],
  ];
  return (
    <>
      {!d.encryptionConfigured && (
        <div className="error mb-6">
          BACKUP_ENCRYPTION_KEY is not set, so backups cannot run.
        </div>
      )}
      <div className="stat-grid mb-6">
        {stats.map(([k, v]) => (
          <div className="card stat" key={k}>
            <div className="stat-label">{k}</div>
            <div className="text-sm font-semibold break-all mt-2">{v}</div>
          </div>
        ))}
      </div>
      <p className="muted text-xs mb-4">
        Run <code>npm run backup -- daily</code> from a scheduler; see
        docs/backup-recovery.md. Retention: daily {d.retention.dailyDays} days,
        weekly {d.retention.weeklyDays} days.
      </p>
      <section className="card">
        <Table
          headers={[
            "Started",
            "Kind",
            "Status",
            "Size",
            "Verified",
            "Restore test",
            "File",
          ]}
          empty="No backups recorded."
          rows={d.items.map((b) => [
            when(b.startedAt),
            label(b.kind),
            <span
              key="s"
              className={`badge ${tone(b.status)}`}
              title={b.error ?? undefined}
            >
              {label(b.status)}
            </span>,
            size(b.sizeBytes),
            b.verificationStatus ? label(b.verificationStatus) : "—",
            when(b.restoreTestedAt),
            <span key="f" className="text-xs break-all">
              {b.deletedAt
                ? "Removed by retention"
                : (b.location ?? b.error ?? "—")}
            </span>,
          ])}
        />
      </section>
    </>
  );
}

function Audit() {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const data = useQuery({
    queryKey: ["platform", "audit", page, search],
    queryFn: () =>
      api<{
        items: {
          id: string;
          action: string;
          module: string;
          actorName: string;
          createdAt: string;
          ip: string | null;
          company: { name: string; code: string };
        }[];
        total: number;
        pageSize: number;
      }>(`platform/audit?page=${page}&search=${encodeURIComponent(search)}`),
  });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Search
          <input
            value={search}
            placeholder="Action, module or actor"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <Table
        headers={["Time", "Company", "Actor", "Action", "Module", "IP"]}
        loading={data.isLoading}
        error={data.error}
        empty="No audit entries."
        rows={(data.data?.items ?? []).map((a) => [
          when(a.createdAt),
          a.company.name,
          a.actorName,
          a.action,
          a.module,
          a.ip ?? "—",
        ])}
      />
      <Pages data={data.data} page={page} setPage={setPage} />
    </section>
  );
}
