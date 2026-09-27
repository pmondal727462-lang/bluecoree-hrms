"use client";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";

export type Notify = (message: string) => void;
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export const when = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export function Heading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow mb-3">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Table({
  headers,
  rows,
  empty,
  loading,
  error,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
  loading?: boolean;
  error?: Error | null;
}) {
  return (
    <>
      {error && (
        <div role="alert" className="error m-4">
          {error.message}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty">{loading ? "Loading…" : empty}</div>
      )}
    </>
  );
}
export function Pages({
  data,
  page,
  setPage,
}: {
  data?: { total: number; pageSize: number };
  page: number;
  setPage: (p: number) => void;
}) {
  if (!data || data.total <= data.pageSize) return null;
  return (
    <div className="pagination">
      <span>
        {data.total} records · Page {page} of{" "}
        {Math.ceil(data.total / data.pageSize)}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * data.pageSize >= data.total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function Confirm({
  open,
  title,
  text,
  label,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={title}>
      <p>{text}</p>
      {error && <div className="error mt-4">{error}</div>}
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : label}
        </Button>
      </div>
    </Dialog>
  );
}

type Location = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  address: string | null;
  active: boolean;
  employeeCount: number;
};
const locationTypes = [
  ["HEAD_OFFICE", "Head office"],
  ["BRANCH_OFFICE", "Branch office"],
  ["FACTORY", "Factory"],
  ["WAREHOUSE", "Warehouse"],
  ["CLIENT_SITE", "Client site"],
  ["REMOTE", "Remote work location"],
];
export function AttendanceLocations({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["time", "locations"],
    queryFn: () => api<Location[]>("time/locations"),
  });
  const [edit, setEdit] = useState<Location | "new" | null>(null),
    [assign, setAssign] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["time"] });
  return (
    <section className="card mt-6">
      <div className="card-title flex justify-between items-center gap-3 flex-wrap">
        <h2 className="flex gap-2 items-center">
          <MapPin size={18} />
          Attendance locations
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!list.data?.length}
            onClick={() => setAssign(true)}
          >
            Assign employees
          </Button>
          <Button size="sm" onClick={() => setEdit("new")}>
            <Plus />
            Add location
          </Button>
        </div>
      </div>
      <p className="muted text-xs px-6 pt-4">
        Employees assigned to one or more locations can punch only inside one of
        them, unless their attendance mode is Open or GPS anywhere. Each located
        punch, accepted or rejected, is kept as a geofence event.
      </p>
      <Table
        headers={[
          "Name",
          "Type",
          "Coordinates",
          "Radius",
          "Employees",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No attendance locations yet."
        rows={(list.data ?? []).map((l) => [
          <div key="n">
            <div className="font-semibold">{l.name}</div>
            {l.address && <span className="muted text-xs">{l.address}</span>}
          </div>,
          locationTypes.find(([k]) => k === l.type)?.[1] ?? l.type,
          `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`,
          `${l.radiusMeters} m`,
          l.employeeCount,
          <span key="s" className={`badge ${l.active ? "positive" : ""}`}>
            {l.active ? "Active" : "Inactive"}
          </span>,
          <Button
            key="e"
            size="sm"
            variant="outline"
            onClick={() => setEdit(l)}
          >
            Edit
          </Button>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={
          edit === "new"
            ? "Add attendance location"
            : "Edit attendance location"
        }
        description="Use decimal coordinates from a map. The radius is the accepted distance in meters."
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { type: "HEAD_OFFICE", radiusMeters: 100, active: "true" }
                : { ...edit, active: String(edit.active) }
            }
            fields={[
              { key: "name", label: "Name", required: true },
              {
                key: "type",
                label: "Type",
                type: "select",
                required: true,
                options: locationTypes.map(([value, label]) => ({
                  value,
                  label,
                })),
              },
              { key: "latitude", label: "Latitude", required: true },
              { key: "longitude", label: "Longitude", required: true },
              {
                key: "radiusMeters",
                label: "Radius (meters)",
                type: "number",
                required: true,
              },
              {
                key: "active",
                label: "Status",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Active" },
                  { value: "false", label: "Inactive" },
                ],
              },
              { key: "address", label: "Address", type: "textarea" },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(
                `time/locations${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    name: v.name,
                    type: v.type,
                    latitude: Number(v.latitude),
                    longitude: Number(v.longitude),
                    radiusMeters: Number(v.radiusMeters),
                    active: v.active === "true",
                    ...(v.address ? { address: v.address } : {}),
                  }),
                },
              );
              setEdit(null);
              notify("Attendance location saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={assign}
        onOpenChange={setAssign}
        title="Assign attendance locations"
        description="Select an employee, then tick every location where they may punch. Clearing all ticks removes the restriction."
      >
        {assign && (
          <AssignLocations
            locations={list.data ?? []}
            onDone={async () => {
              setAssign(false);
              notify("Employee locations updated.");
              await refresh();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
function AssignLocations({
  locations,
  onDone,
}: {
  locations: Location[];
  onDone: () => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [employeeId, setEmployeeId] = useState(""),
    [selected, setSelected] = useState<string[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const people = useQuery({
    queryKey: ["time", "employees", search],
    queryFn: () =>
      api<{
        items: {
          id: string;
          employeeCode: string;
          firstName: string;
          lastName: string;
        }[];
      }>(`time/employees?search=${encodeURIComponent(search)}`),
  });
  const current = useQuery({
    queryKey: ["time", "employee-locations", employeeId],
    queryFn: () =>
      api<string[]>(`time/employee-locations?employeeId=${employeeId}`),
    enabled: !!employeeId,
  });
  const chosen = selected ?? current.data ?? [];
  return (
    <div className="space-y-4">
      <label>
        Find employee
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or employee code"
        />
      </label>
      <label>
        Employee *
        <select
          value={employeeId}
          onChange={(e) => {
            setEmployeeId(e.target.value);
            setSelected(null);
          }}
        >
          <option value="">Select employee</option>
          {people.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.employeeCode} · {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </label>
      {employeeId && (
        <fieldset className="space-y-2">
          {locations
            .filter((l) => l.active)
            .map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={chosen.includes(l.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...chosen, l.id]
                        : chosen.filter((id) => id !== l.id),
                    )
                  }
                />
                {l.name} · {l.radiusMeters} m
              </label>
            ))}
        </fieldset>
      )}
      {error && <div className="error">{error}</div>}
      <Button
        disabled={!employeeId || busy || current.isLoading}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("time/employee-locations", {
              method: "PUT",
              body: JSON.stringify({ employeeId, locationIds: chosen }),
            });
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save assignment
      </Button>
    </div>
  );
}

type Device = {
  id: string;
  deviceName: string | null;
  deviceId: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  registeredAt: string;
  active: boolean;
  activeSessions: number;
  user: { name: string; email: string };
};
export function DevicesPage({ notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [pending, setPending] = useState<{ device: Device; action: string } | null>(
      null,
    );
  const list = useQuery({
    queryKey: ["devices", page, search],
    queryFn: () =>
      api<Paged<Device>>(
        `devices?page=${page}&pageSize=25&search=${encodeURIComponent(search)}`,
      ),
  });
  const labels: Record<string, [string, string]> = {
    "force-logout": [
      "Sign out device",
      "Signs the user out of this device. They can sign in again.",
    ],
    deactivate: [
      "Deactivate device",
      "Signs the device out and blocks it from signing in or registering again until reactivated.",
    ],
    activate: ["Reactivate device", "Allows this device to sign in again."],
    remove: [
      "Remove device",
      "Signs the device out and deletes its registration. The user can register it again.",
    ],
  };
  return (
    <>
      <Heading
        eyebrow="Mobile"
        title="Devices"
        text="Mobile devices registered by employees. Sign out, deactivate or remove a device."
      />
      <section className="card">
        <div className="toolbar">
          <label>
            Search
            <input
              value={search}
              placeholder="Device or user"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <Table
          headers={[
            "User",
            "Device",
            "Platform",
            "App",
            "Last seen",
            "Sessions",
            "Status",
            "Actions",
          ]}
          loading={list.isLoading}
          error={list.error}
          empty="No registered devices."
          rows={(list.data?.items ?? []).map((d) => [
            <div key="u">
              <div className="font-semibold">{d.user.name}</div>
              <span className="muted text-xs">{d.user.email}</span>
            </div>,
            <div key="d">
              {d.deviceName || "Unnamed device"}
              <p className="muted text-xs break-all">{d.deviceId}</p>
            </div>,
            `${d.platform} ${d.osVersion ?? ""}`,
            d.appVersion ?? "—",
            when(d.lastSeenAt),
            d.activeSessions,
            <span key="s" className={`badge ${d.active ? "positive" : ""}`}>
              {d.active ? "Active" : "Deactivated"}
            </span>,
            <div key="a" className="flex gap-2 flex-wrap">
              {(d.active
                ? ["force-logout", "deactivate", "remove"]
                : ["activate", "remove"]
              ).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  onClick={() => setPending({ device: d, action })}
                >
                  {labels[action][0]}
                </Button>
              ))}
            </div>,
          ])}
        />
        <Pages data={list.data} page={page} setPage={setPage} />
      </section>
      <Confirm
        open={!!pending}
        title={pending ? labels[pending.action][0] : ""}
        text={
          pending
            ? `${pending.device.user.name} · ${pending.device.deviceName || pending.device.deviceId}. ${labels[pending.action][1]}`
            : ""
        }
        label="Confirm"
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await api(`devices/${pending.device.id}`, {
            method: pending.action === "remove" ? "DELETE" : "PUT",
            ...(pending.action === "remove"
              ? {}
              : { body: JSON.stringify({ action: pending.action }) }),
          });
          notify("Device updated.");
          await client.invalidateQueries({ queryKey: ["devices"] });
        }}
      />
    </>
  );
}
