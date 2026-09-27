"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Pages, Table, when } from "./platform";
import { ReferenceSelect } from "./reference-select";

type Device = {
  id: string;
  name: string;
  vendor: "ZKTECO" | "ESSL" | "HIKVISION" | "SUPREMA" | "GENERIC";
  model: string | null;
  serialNumber: string;
  mode: "PUSH" | "PULL";
  location: { id: string; name: string } | null;
  timezone: string | null;
  endpoint: string | null;
  username: string | null;
  ipAllowlist: string[];
  autoMapByCode: boolean;
  syncIntervalMinutes: number;
  pendingCommand: string | null;
  active: boolean;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastPunchAt: string | null;
  lastError: string | null;
  status: "ONLINE" | "OFFLINE" | "NEVER_CONNECTED" | "ERROR" | "INACTIVE";
  hasPushToken: boolean;
  waiting?: Record<string, number>;
  pushToken?: string | null;
};
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type SyncLog = {
  id: string;
  trigger: string;
  status: string;
  received: number;
  inserted: number;
  processed: number;
  unmapped: number;
  duplicates: number;
  failed: number;
  error: string | null;
  startedAt: string;
};
type Mapping = {
  id: string;
  deviceUserId: string;
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
  };
};
type Punch = {
  id: string;
  deviceUserId: string;
  punchedAt: string;
  status: string;
  reason: string | null;
  device: { name: string };
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
  } | null;
};
const vendorLabel: Record<Device["vendor"], string> = {
  ZKTECO: "ZKTeco (ADMS push)",
  ESSL: "eSSL (ADMS push)",
  HIKVISION: "Hikvision (ISAPI event push)",
  SUPREMA: "Suprema BioStar 2 (pull)",
  GENERIC: "Other device or local agent (JSON push)",
};
const statusTone = (s: string) =>
  s === "ONLINE" || s === "PROCESSED" || s === "SUCCESS"
    ? "positive"
    : ["OFFLINE", "UNMAPPED", "PARTIAL", "NEVER_CONNECTED"].includes(s)
      ? "amber"
      : "";
const label = (s: string) =>
  s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";

// Device registration, setup, sync, enrolment mapping and punch log.
export function BiometricDevices({
  me,
  notify,
}: {
  me: Me;
  notify: (message: string) => void;
}) {
  const canConfigure = me.permissions.includes("time.configure");
  const client = useQueryClient();
  const devices = useQuery({
    queryKey: ["biometric", "devices"],
    queryFn: () => api<Device[]>("biometric/devices"),
    refetchInterval: 60000,
  });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Device | null>(null);
  const [token, setToken] = useState<{ device: Device; token: string } | null>(
    null,
  );
  const refresh = () => client.invalidateQueries({ queryKey: ["biometric"] });
  return (
    <div className="grid gap-6">
      <section className="card">
        <div className="card-title flex items-center justify-between gap-3">
          <h2>Biometric devices</h2>
          {canConfigure && (
            <Button onClick={() => setAdding(true)}>Register device</Button>
          )}
        </div>
        <Table
          headers={[
            "Device",
            "Vendor",
            "Serial",
            "Location",
            "Status",
            "Last contact",
            "Waiting",
            "",
          ]}
          loading={devices.isLoading}
          error={devices.error}
          empty="No devices registered."
          rows={(devices.data ?? []).map((d) => [
            <strong key="n">{d.name}</strong>,
            vendorLabel[d.vendor],
            d.serialNumber,
            d.location?.name ?? "—",
            <span key="s" className={`badge ${statusTone(d.status)}`}>
              {label(d.status)}
            </span>,
            when(d.mode === "PULL" ? d.lastSyncAt : d.lastSeenAt) || "—",
            Object.entries(d.waiting ?? {})
              .map(([k, v]) => `${v} ${label(k).toLowerCase()}`)
              .join(", ") || "—",
            <Button
              key="o"
              size="sm"
              variant="outline"
              onClick={() => setOpen(d)}
            >
              Open
            </Button>,
          ])}
        />
      </section>
      <Mappings canConfigure={canConfigure} notify={notify} />
      <PunchLog
        devices={devices.data ?? []}
        canConfigure={canConfigure}
        notify={notify}
      />
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Register biometric device"
        description="Use the serial number shown in the device's system information."
      >
        {adding && (
          <DeviceForm
            onSaved={async (d) => {
              setAdding(false);
              await refresh();
              if (d.pushToken) setToken({ device: d, token: d.pushToken });
              else setOpen(d);
              notify("Device registered.");
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!token}
        onOpenChange={(v) => !v && setToken(null)}
        title="Device push token"
        description="Copy it now. It is shown only once; rotate it to get a new one."
      >
        {token && <Setup device={token.device} token={token.token} />}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open?.name ?? "Device"}
        description={open ? vendorLabel[open.vendor] : undefined}
      >
        {open && (
          <DeviceDetail
            device={devices.data?.find((d) => d.id === open.id) ?? open}
            canConfigure={canConfigure}
            notify={notify}
            onToken={(t) => setToken({ device: open, token: t })}
            refresh={refresh}
          />
        )}
      </Dialog>
    </div>
  );
}

function DeviceForm({ onSaved }: { onSaved: (d: Device) => Promise<void> }) {
  const [vendor, setVendor] = useState<Device["vendor"]>("ESSL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locations = useQuery({
    queryKey: ["time", "locations"],
    queryFn: () => api<{ id: string; name: string }[]>("time/locations"),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          const saved = await api<Device>("biometric/devices", {
            method: "POST",
            body: JSON.stringify({
              name: f.get("name"),
              vendor,
              model: f.get("model") || null,
              serialNumber: f.get("serialNumber"),
              locationId: f.get("locationId") || null,
              timezone: f.get("timezone") || null,
              endpoint: vendor === "SUPREMA" ? f.get("endpoint") : null,
              username: vendor === "SUPREMA" ? f.get("username") : null,
              secret: vendor === "SUPREMA" ? f.get("secret") : null,
              ipAllowlist: String(f.get("ipAllowlist") ?? "")
                .split(/[\s,]+/)
                .filter(Boolean),
              autoMapByCode: f.get("autoMapByCode") === "on",
              syncIntervalMinutes: Number(f.get("syncIntervalMinutes") || 15),
            }),
          });
          await onSaved(saved);
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Vendor *
        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value as Device["vendor"])}
        >
          {Object.entries(vendorLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Name *
          <input name="name" required minLength={2} maxLength={100} />
        </label>
        <label>
          Serial number *
          <input name="serialNumber" required minLength={3} maxLength={64} />
        </label>
        <label>
          Model
          <input name="model" maxLength={100} />
        </label>
        <label>
          Location
          <select name="locationId" defaultValue="">
            <option value="">Not set</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Device time zone
          <input
            name="timezone"
            maxLength={60}
            placeholder="Company time zone"
          />
        </label>
        <label>
          Allowed IP addresses
          <input name="ipAllowlist" placeholder="Optional, comma separated" />
        </label>
      </div>
      {vendor === "SUPREMA" && (
        <div className="form-grid">
          <label>
            BioStar 2 server URL *
            <input
              name="endpoint"
              type="url"
              required
              placeholder="https://biostar.example.com"
            />
          </label>
          <label>
            Login *
            <input name="username" required autoComplete="off" />
          </label>
          <label>
            Password *
            <input
              name="secret"
              type="password"
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Sync every (minutes)
            <input
              name="syncIntervalMinutes"
              type="number"
              min={5}
              max={1440}
              defaultValue={15}
            />
          </label>
        </div>
      )}
      <label className="flex items-center gap-2">
        <input name="autoMapByCode" type="checkbox" defaultChecked />
        Match device user IDs to employee IDs automatically
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Registering…" : "Register device"}
      </Button>
    </form>
  );
}

// Vendor-specific connection instructions.
function Setup({ device, token }: { device: Device; token?: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const host = origin.replace(/^https?:\/\//, "");
  const tokenText = token ?? "<rotate the token to see it>";
  return (
    <div className="space-y-2 text-sm">
      {(device.vendor === "ZKTECO" || device.vendor === "ESSL") && (
        <>
          <p>
            On the terminal open <strong>Comm → Cloud Server Setting</strong>{" "}
            (ADMS) and set:
          </p>
          <ul className="list-disc pl-5">
            <li>
              Server address: <code>{host}</code>, HTTPS on, port 443
            </li>
            <li>
              The device posts to <code>{origin}/iclock/cdata</code>
            </li>
          </ul>
          <p className="muted">
            The terminal identifies itself by serial number{" "}
            <code>{device.serialNumber}</code>. Restrict it to the office IP
            address where possible.
          </p>
        </>
      )}
      {device.vendor === "HIKVISION" && (
        <>
          <p>
            In the device web page open{" "}
            <strong>Network → Advanced → HTTP Listening</strong> and set the
            event URL to:
          </p>
          <code className="block break-all">
            {origin}/api/biometric/hikvision/{tokenText}
          </code>
        </>
      )}
      {device.vendor === "GENERIC" && (
        <>
          <p>Send punches with the device token:</p>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {`POST ${origin}/api/biometric/push
Authorization: Bearer ${tokenText}
{"punches":[{"deviceUserId":"1001","punchedAt":"2026-09-14 09:02:10"}]}`}
          </pre>
          <p className="muted">
            Times without an offset use the device time zone.
          </p>
        </>
      )}
      {device.vendor === "SUPREMA" && (
        <p>
          Punches are pulled from BioStar 2 every {device.syncIntervalMinutes}{" "}
          minutes by the scheduled biometric sync job, or when you choose Sync
          now. The BioStar device ID must equal the serial number{" "}
          <code>{device.serialNumber}</code>.
        </p>
      )}
    </div>
  );
}

function DeviceDetail({
  device,
  canConfigure,
  notify,
  onToken,
  refresh,
}: {
  device: Device;
  canConfigure: boolean;
  notify: (message: string) => void;
  onToken: (token: string) => void;
  refresh: () => Promise<void>;
}) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const logs = useQuery({
    queryKey: ["biometric", "logs", device.id, page],
    queryFn: () =>
      api<Paged<SyncLog>>(
        `biometric/devices/${device.id}/logs?page=${page}&pageSize=10`,
      ),
  });
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      await refresh();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <dl className="form-grid text-sm">
        <div>
          <dt className="muted text-xs">Status</dt>
          <dd>
            <span className={`badge ${statusTone(device.status)}`}>
              {label(device.status)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="muted text-xs">Last punch</dt>
          <dd>{when(device.lastPunchAt) || "—"}</dd>
        </div>
        <div>
          <dt className="muted text-xs">Auto-match employee IDs</dt>
          <dd>{device.autoMapByCode ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="muted text-xs">Allowed IPs</dt>
          <dd>{device.ipAllowlist.join(", ") || "Any"}</dd>
        </div>
      </dl>
      {device.lastError && (
        <p role="alert" className="error">
          {device.lastError}
        </p>
      )}
      {device.pendingCommand && (
        <p className="muted text-sm">
          Waiting for the device to collect: resend attendance logs.
        </p>
      )}
      <Setup device={device} />
      {canConfigure && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !device.active}
            onClick={() =>
              run(
                () =>
                  api(`biometric/devices/${device.id}/sync`, {
                    method: "POST",
                  }),
                device.mode === "PULL"
                  ? "Sync finished."
                  : "Waiting punches reprocessed.",
              )
            }
          >
            Sync now
          </Button>
          {(device.vendor === "HIKVISION" || device.vendor === "GENERIC") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "The current token stops working immediately. Continue?",
                  )
                )
                  return;
                try {
                  const r = await api<{ pushToken: string }>(
                    `biometric/devices/${device.id}/token`,
                    { method: "POST" },
                  );
                  onToken(r.pushToken);
                } catch (e) {
                  notify(errorText(e));
                }
              }}
            >
              Rotate token
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api(`biometric/devices/${device.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ active: !device.active }),
                  }),
                device.active ? "Device deactivated." : "Device activated.",
              )
            }
          >
            {device.active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      )}
      <div>
        <h3 className="font-semibold mb-2">Sync log</h3>
        <Table
          headers={[
            "When",
            "Trigger",
            "Status",
            "Received",
            "Applied",
            "Unmapped",
            "Duplicates",
            "Failed",
          ]}
          loading={logs.isLoading}
          error={logs.error}
          empty="No syncs yet."
          rows={(logs.data?.items ?? []).map((l) => [
            when(l.startedAt),
            label(l.trigger),
            <span
              key="s"
              className={`badge ${statusTone(l.status)}`}
              title={l.error ?? ""}
            >
              {label(l.status)}
            </span>,
            l.received,
            l.processed,
            l.unmapped,
            l.duplicates,
            l.failed,
          ])}
        />
        <Pages data={logs.data} page={page} setPage={setPage} />
      </div>
    </div>
  );
}

function Mappings({
  canConfigure,
  notify,
}: {
  canConfigure: boolean;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [deviceUserId, setDeviceUserId] = useState(""),
    [employeeId, setEmployeeId] = useState(""),
    [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["biometric", "mappings", page, search],
    queryFn: () =>
      api<Paged<Mapping>>(
        `biometric/mappings?${new URLSearchParams({ page: String(page), search })}`,
      ),
  });
  const unmapped = useQuery({
    queryKey: ["biometric", "unmapped"],
    queryFn: () =>
      api<{ deviceUserId: string; punches: number; lastPunchAt: string }[]>(
        "biometric/unmapped",
      ),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["biometric"] });
  return (
    <section className="card">
      <div className="card-title">
        <h2>Device user IDs</h2>
      </div>
      <p className="muted text-sm px-6">
        Map each enrolment number (PIN / user ID) on the devices to an employee.
        One mapping applies to all devices. Punches that arrived before a
        mapping are applied as soon as it is saved.
      </p>
      {!!unmapped.data?.length && (
        <div className="px-6 py-3">
          <p className="text-sm font-semibold">Unmapped IDs</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {unmapped.data.map((u) => (
              <button
                key={u.deviceUserId}
                type="button"
                className="badge amber"
                disabled={!canConfigure}
                onClick={() => setDeviceUserId(u.deviceUserId)}
                title={`Last punch ${when(u.lastPunchAt)}`}
              >
                {u.deviceUserId} · {u.punches} punches
              </button>
            ))}
          </div>
        </div>
      )}
      {canConfigure && (
        <form
          className="form-grid px-6 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!employeeId) return notify("Choose an employee.");
            setBusy(true);
            try {
              const r = await api<{ processed: number }>("biometric/mappings", {
                method: "PUT",
                body: JSON.stringify({
                  mappings: [{ deviceUserId, employeeId }],
                }),
              });
              notify(
                `Mapping saved${r.processed ? `; ${r.processed} waiting punches applied` : ""}.`,
              );
              setDeviceUserId("");
              setEmployeeId("");
              await refresh();
            } catch (err) {
              notify(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Device user ID *
            <input
              required
              maxLength={64}
              pattern="[A-Za-z0-9_.\-]+"
              value={deviceUserId}
              onChange={(e) => setDeviceUserId(e.target.value.trim())}
            />
          </label>
          <ReferenceSelect
            resource="employees"
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            required
          />
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              Save mapping
            </Button>
          </div>
        </form>
      )}
      <div className="toolbar">
        <label>
          Search
          <input
            value={search}
            maxLength={100}
            placeholder="Device user ID or employee"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <Table
        headers={["Device user ID", "Employee", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No mappings yet."
        rows={(list.data?.items ?? []).map((m) => [
          m.deviceUserId,
          `${m.employee.employeeCode} · ${m.employee.firstName} ${m.employee.lastName}`,
          canConfigure ? (
            <Button
              key="d"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api(`biometric/mappings/${m.id}`, { method: "DELETE" });
                  notify("Mapping removed.");
                  await refresh();
                } catch (e) {
                  notify(errorText(e));
                }
              }}
            >
              Remove
            </Button>
          ) : (
            ""
          ),
        ])}
      />
      <Pages data={list.data} page={page} setPage={setPage} />
    </section>
  );
}

function PunchLog({
  devices,
  canConfigure,
  notify,
}: {
  devices: Device[];
  canConfigure: boolean;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [deviceId, setDeviceId] = useState(""),
    [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["biometric", "punches", page, status, deviceId],
    queryFn: () =>
      api<Paged<Punch>>(
        `biometric/punches?${new URLSearchParams({
          page: String(page),
          ...(status ? { status } : {}),
          ...(deviceId ? { deviceId } : {}),
        })}`,
      ),
  });
  return (
    <section className="card">
      <div className="card-title flex items-center justify-between gap-3">
        <h2>Device punches</h2>
        {canConfigure && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ processed: number; failed: number }>(
                  "biometric/punches/retry",
                  {
                    method: "POST",
                    body: JSON.stringify(deviceId ? { deviceId } : {}),
                  },
                );
                notify(`${r.processed} punches applied, ${r.failed} failed.`);
                await client.invalidateQueries({ queryKey: ["biometric"] });
              } catch (e) {
                notify(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry failed and unmapped
          </Button>
        )}
      </div>
      <div className="toolbar">
        <label>
          Device
          <select
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {[
              "PROCESSED",
              "UNMAPPED",
              "IGNORED",
              "REJECTED",
              "FAILED",
              "PENDING",
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
          "Punched at",
          "Device",
          "Device user ID",
          "Employee",
          "Status",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No punches."
        rows={(list.data?.items ?? []).map((p) => [
          when(p.punchedAt),
          p.device.name,
          p.deviceUserId,
          p.employee
            ? `${p.employee.employeeCode} · ${p.employee.firstName} ${p.employee.lastName}`
            : "—",
          <div key="s">
            <span className={`badge ${statusTone(p.status)}`}>
              {label(p.status)}
            </span>
            {p.reason && <p className="muted text-xs mt-1">{p.reason}</p>}
          </div>,
        ])}
      />
      <Pages data={list.data} page={page} setPage={setPage} />
    </section>
  );
}
