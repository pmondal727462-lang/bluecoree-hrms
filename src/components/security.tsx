"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { AccountSecurity } from "./account-security";
import { Confirm, Heading, Pages, Table, when, type Notify } from "./platform";
import { RetentionSettings } from "./retention";

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type Login = {
  id: string;
  channel: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: { name: string; email: string } | null;
};
type Event = {
  id: string;
  type: string;
  severity: string;
  userId: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
};
type Policy = {
  requireForAdmins: boolean;
  requireForManagers: boolean;
  requireForEmployees: boolean;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  passwordExpiryDays: number | null;
  sessionIdleMinutes: number | null;
};
const reason = (l: Login) =>
  l.success
    ? "Signed in"
    : (l.reason ?? "Failed").replaceAll("_", " ").toLowerCase();

// Recovery codes, sign-out-everywhere and personal sign-in history.
export function AccountExtras({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const codes = useQuery({
    queryKey: ["recovery-codes"],
    queryFn: () =>
      api<{ enabled: boolean; remaining: number }>("auth/recovery-codes"),
  });
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ["login-history", page],
    queryFn: () =>
      api<Paged<Login>>(`auth/login-history?page=${page}&pageSize=10`),
  });
  const [generating, setGenerating] = useState(false),
    [shown, setShown] = useState<string[]>([]),
    [signOut, setSignOut] = useState(false);
  return (
    <>
      <section className="card mt-6">
        <div className="card-title">
          <h2>Recovery codes & devices</h2>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex justify-between gap-4 items-center">
            <div>
              <h3 className="text-sm font-semibold">Recovery codes</h3>
              <p className="muted text-xs mt-2">
                {codes.data?.enabled
                  ? `${codes.data.remaining} unused codes. Each works once if you lose your authenticator.`
                  : "Available after you enable two-factor authentication."}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!codes.data?.enabled}
              onClick={() => setGenerating(true)}
            >
              Generate new codes
            </Button>
          </div>
          <div className="flex justify-between gap-4 items-center">
            <div>
              <h3 className="text-sm font-semibold">Sign out other devices</h3>
              <p className="muted text-xs mt-2">
                Ends every session except this one, including mobile apps.
              </p>
            </div>
            <Button variant="outline" onClick={() => setSignOut(true)}>
              Sign out everywhere else
            </Button>
          </div>
        </div>
      </section>
      <section className="card mt-6">
        <div className="card-title">
          <h2>Sign-in history</h2>
        </div>
        <Table
          headers={["Time", "Result", "Channel", "IP", "Device"]}
          loading={history.isLoading}
          error={history.error}
          empty="No sign-ins recorded yet."
          rows={(history.data?.items ?? []).map((l) => [
            when(l.createdAt),
            <span key="r" className={`badge ${l.success ? "positive" : ""}`}>
              {reason(l)}
            </span>,
            l.channel,
            l.ip ?? "—",
            <span key="d" className="text-xs break-all">
              {l.userAgent ?? "—"}
            </span>,
          ])}
        />
        <Pages data={history.data} page={page} setPage={setPage} />
      </section>
      <Dialog
        open={generating}
        onOpenChange={setGenerating}
        title="Generate recovery codes"
        description="New codes replace any existing ones."
      >
        {generating && (
          <RecordForm
            fields={[
              {
                key: "password",
                label: "Current password",
                type: "password",
                required: true,
              },
            ]}
            submitLabel="Generate"
            onCancel={() => setGenerating(false)}
            onSave={async (v) => {
              const r = await api<{ codes: string[] }>("auth/recovery-codes", {
                method: "POST",
                body: JSON.stringify(v),
              });
              setGenerating(false);
              setShown(r.codes);
              await client.invalidateQueries({ queryKey: ["recovery-codes"] });
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!shown.length}
        onOpenChange={(v) => !v && setShown([])}
        title="Save your recovery codes"
        description="Store them somewhere safe. They will not be shown again."
      >
        <div className="grid grid-cols-2 gap-2 font-mono text-sm p-4 rounded-lg bg-[var(--muted)]">
          {shown.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="outline"
            onClick={() => navigator.clipboard?.writeText(shown.join("\n"))}
          >
            Copy
          </Button>
          <Button onClick={() => setShown([])}>I saved them</Button>
        </div>
      </Dialog>
      <Confirm
        open={signOut}
        title="Sign out other devices"
        text="All other browser and mobile sessions will end immediately."
        label="Sign out"
        onClose={() => setSignOut(false)}
        onConfirm={async () => {
          const r = await api<{ revoked: number }>("auth/sessions/revoke-all", {
            method: "POST",
            body: JSON.stringify({}),
          });
          notify(`Signed out ${r.revoked} other session(s).`);
          await client.invalidateQueries({ queryKey: ["login-history"] });
        }}
      />
    </>
  );
}

// Shown instead of the workspace until a required security step is done.
export function SecuritySetupRequired({ me }: { me: Me }) {
  return (
    <>
      <div className="card p-6 flex gap-4 items-start">
        <ShieldAlert className="text-amber-600 shrink-0" />
        <div>
          <h1 className="text-lg font-bold">
            {me.temporaryPassword
              ? "Activate your account"
              : "Security step required"}
          </h1>
          <p className="muted mt-2">
            {me.passwordChangeRequired
              ? me.temporaryPassword
                ? "Your temporary password worked. Choose a new password to unlock your dashboard and management tools, then sign in again."
                : "Your password has expired. Change it below, then sign in again."
              : "Your company requires two-factor authentication for your role. Set up an authenticator app below, then refresh the page."}
          </p>
        </div>
      </div>
      <AccountSecurity changePasswordOnOpen={!!me.passwordChangeRequired} />
    </>
  );
}

export function SecurityPage({ me, notify }: { me: Me; notify: Notify }) {
  const canManage = me.permissions.includes("security.manage");
  const [tab, setTab] = useState(canManage ? "policy" : "logins");
  return (
    <>
      <Heading
        eyebrow="Enterprise security"
        title="Security"
        text="Sign-in policy, account lockouts, sign-in history and security events."
      />
      <div className="section-tabs">
        {[
          ...(canManage
            ? [
                ["policy", "Policy"],
                ["locked", "Locked accounts"],
                ["retention", "Data retention"],
              ]
            : []),
          ["logins", "Sign-in history"],
          ["events", "Security events"],
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
      {tab === "policy" ? (
        <PolicyForm notify={notify} />
      ) : tab === "locked" ? (
        <LockedUsers notify={notify} />
      ) : tab === "retention" ? (
        <RetentionSettings notify={notify} />
      ) : tab === "logins" ? (
        <CompanyLogins />
      ) : (
        <Events />
      )}
    </>
  );
}
function PolicyForm({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const policy = useQuery({
    queryKey: ["security", "policy"],
    queryFn: () => api<Policy>("security/settings"),
  });
  if (!policy.data)
    return <div className="empty">{policy.error?.message ?? "Loading…"}</div>;
  const yesNo = [
    { value: "true", label: "Required" },
    { value: "false", label: "Optional" },
  ];
  return (
    <section className="card p-6">
      <RecordForm
        initial={Object.fromEntries(
          Object.entries(policy.data).map(([k, v]) => [
            k,
            v === null ? "" : String(v),
          ]),
        )}
        fields={[
          {
            key: "requireForAdmins",
            label: "MFA for administrators",
            type: "select",
            required: true,
            options: yesNo,
            section: "Two-factor authentication",
          },
          {
            key: "requireForManagers",
            label: "MFA for managers and HR reviewers",
            type: "select",
            required: true,
            options: yesNo,
            section: "Two-factor authentication",
          },
          {
            key: "requireForEmployees",
            label: "MFA for employees",
            type: "select",
            required: true,
            options: yesNo,
            section: "Two-factor authentication",
          },
          {
            key: "maxFailedAttempts",
            label: "Failed attempts before lockout (3–20)",
            type: "number",
            required: true,
            section: "Lockout and sessions",
          },
          {
            key: "lockoutMinutes",
            label: "Lockout duration (minutes)",
            type: "number",
            required: true,
            section: "Lockout and sessions",
          },
          {
            key: "passwordExpiryDays",
            label: "Password expiry (days, blank = never)",
            type: "number",
            section: "Lockout and sessions",
          },
          {
            key: "sessionIdleMinutes",
            label: "Idle session timeout (minutes, blank = off)",
            type: "number",
            section: "Lockout and sessions",
          },
        ]}
        onSave={async (v) => {
          await api("security/settings", {
            method: "PUT",
            body: JSON.stringify({
              requireForAdmins: v.requireForAdmins === "true",
              requireForManagers: v.requireForManagers === "true",
              requireForEmployees: v.requireForEmployees === "true",
              maxFailedAttempts: Number(v.maxFailedAttempts),
              lockoutMinutes: Number(v.lockoutMinutes),
              passwordExpiryDays: v.passwordExpiryDays
                ? Number(v.passwordExpiryDays)
                : null,
              sessionIdleMinutes: v.sessionIdleMinutes
                ? Number(v.sessionIdleMinutes)
                : null,
            }),
          });
          notify("Security policy saved.");
          await client.invalidateQueries({ queryKey: ["security"] });
        }}
      >
        <p className="muted text-xs mt-5">
          Required MFA applies at the next request: users without an
          authenticator are asked to set one up before continuing. Tiers are
          based on role permissions (user, role or company administration =
          administrator; leave or attendance review = manager).
        </p>
      </RecordForm>
    </section>
  );
}
function LockedUsers({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["security", "locked"],
    queryFn: () =>
      api<{ id: string; name: string; email: string; lockedUntil: string }[]>(
        "security/locked-users",
      ),
  });
  return (
    <section className="card">
      <Table
        headers={["User", "Locked until", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No accounts are locked."
        rows={(list.data ?? []).map((u) => [
          <div key="u">
            <div className="font-semibold">{u.name}</div>
            <span className="muted text-xs">{u.email}</span>
          </div>,
          when(u.lockedUntil),
          <Button
            key="a"
            size="sm"
            variant="outline"
            onClick={async () => {
              await api(`security/users/${u.id}/unlock`, { method: "POST" });
              notify("Account unlocked.");
              await client.invalidateQueries({ queryKey: ["security"] });
            }}
          >
            Unlock
          </Button>,
        ])}
      />
    </section>
  );
}
function CompanyLogins() {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["security", "logins", page],
    queryFn: () => api<Paged<Login>>(`security/login-history?page=${page}`),
  });
  return (
    <section className="card">
      <Table
        headers={["Time", "User", "Result", "Channel", "IP"]}
        loading={list.isLoading}
        error={list.error}
        empty="No sign-ins recorded yet."
        rows={(list.data?.items ?? []).map((l) => [
          when(l.createdAt),
          l.user ? `${l.user.name} · ${l.user.email}` : "Unknown account",
          <span key="r" className={`badge ${l.success ? "positive" : ""}`}>
            {reason(l)}
          </span>,
          l.channel,
          l.ip ?? "—",
        ])}
      />
      <Pages data={list.data} page={page} setPage={setPage} />
    </section>
  );
}
function Events() {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["security", "events", page],
    queryFn: () => api<Paged<Event>>(`security/events?page=${page}`),
  });
  return (
    <section className="card">
      <Table
        headers={["Time", "Event", "Severity", "Details", "IP"]}
        loading={list.isLoading}
        error={list.error}
        empty="No security events yet."
        rows={(list.data?.items ?? []).map((e) => [
          when(e.createdAt),
          e.type.replaceAll("_", " ").toLowerCase(),
          <span
            key="s"
            className={`badge ${e.severity === "INFO" ? "" : "amber"}`}
          >
            {e.severity}
          </span>,
          <code key="d" className="text-xs break-all">
            {e.details ? JSON.stringify(e.details) : "—"}
          </code>,
          e.ip ?? "—",
        ])}
      />
      <Pages data={list.data} page={page} setPage={setPage} />
    </section>
  );
}
