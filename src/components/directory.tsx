"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Download,
  Pencil,
  Archive,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me, Row, PageData, Field, Named } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { EmployeeImport } from "./employee-import";
import { ReferenceSelect } from "./reference-select";
import { EmployeePhoto } from "./employee-photo";
import { BankAccounts, EmergencyContacts } from "./employee-contacts";
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const nested = (v: unknown, key: string) =>
  v && typeof v === "object" ? str((v as Record<string, unknown>)[key]) : "";
export function Directory({
  module,
  me,
  notify,
}: {
  module: string;
  me: Me;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState("departments"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [department, setDepartment] = useState(""),
    [branch, setBranch] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [viewing, setViewing] = useState<Row | null>(null),
    [confirm, setConfirm] = useState<Row | null>(null),
    [resetUser, setResetUser] = useState<{
      name: string;
      employeeCode: string;
      token: string;
      expiresAt: string;
    } | null>(null),
    [deleting, setDeleting] = useState(false),
    [actionError, setActionError] = useState("");
  const resource = module === "organization" ? tab : module;
  const write = me.permissions.includes(
    module === "organization" ? "organization.write" : `${module}.write`,
  );
  useEffect(() => {
    if (
      module === "organization" &&
      new URLSearchParams(window.location.search).get("tab") === "branches"
    )
      setTab("branches");
  }, [module]);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (
      module === "employees" &&
      new URLSearchParams(window.location.search).get("new") === "1" &&
      write
    ) {
      setEditing(null);
      window.history.replaceState({}, "", "/employees");
    }
  }, [module, write]);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "10",
    search: query,
    ...(department ? { departmentId: department } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(status ? { status } : {}),
  });
  const { data, error, isLoading } = useQuery({
    queryKey: [resource, page, query, department, branch, status],
    queryFn: () => api<PageData | Row[]>(`${resource}?${params}`),
  });
  const { data: roleData } = useQuery({
    queryKey: ["roles"],
    queryFn: () =>
      api<{ items: (Named & { permissions: { permissionKey: string }[] })[] }>(
        "roles",
      ),
    enabled: module === "users" && me.permissions.includes("roles.read"),
  });
  const rawItems = Array.isArray(data) ? data : data?.items || [];
  const items =
    module === "organization"
      ? rawItems.filter((i) =>
          str(i.name).toLowerCase().includes(query.toLowerCase()),
        )
      : rawItems;
  const total = Array.isArray(data) ? items.length : data?.total || 0;
  let fields: Field[] = [];
  if (module === "organization")
    fields = [{ key: "name", label: "Name", required: true }];
  if (module === "organization" && tab === "branches")
    fields = [
      { key: "name", label: "Location name", required: true },
      { key: "address", label: "Address", type: "textarea" },
      {
        key: "geofenceEnabled",
        label: "Attendance area",
        type: "select",
        required: true,
        options: [
          { value: "false", label: "Use company default" },
          { value: "true", label: "Require GPS inside this location" },
        ],
      },
      { key: "latitude", label: "Latitude (-90 to 90)" },
      { key: "longitude", label: "Longitude (-180 to 180)" },
      {
        key: "radiusMeters",
        label: "Attendance radius in meters (50–10,000)",
        type: "number",
        required: true,
      },
    ];
  if (module === "users")
    fields = [
      { key: "name", label: "Full name", required: true },
      { key: "email", label: "Email address", type: "email", required: true },
      { key: "mobile", label: "Mobile number" },
      {
        key: "password",
        label: editing
          ? "New password (optional)"
          : "Password (12+ characters)",
        type: "password",
        required: !editing,
      },
      {
        key: "roleId",
        label: "Role",
        type: "select",
        required: true,
        options: (roleData?.items || [])
          .filter(
            (r) =>
              r.name !== "Super Admin" &&
              r.permissions.every((p) =>
                me.permissions.includes(p.permissionKey),
              ),
          )
          .map((r) => ({ value: r.id, label: r.name })),
      },
      {
        key: "active",
        label: "Account status",
        type: "select",
        required: true,
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Disabled" },
        ],
      },
    ];
  if (module === "employees")
    fields = [
      { key: "employeeCode", label: "Employee ID", required: true },
      { key: "firstName", label: "First name", required: true },
      { key: "middleName", label: "Middle name" },
      { key: "lastName", label: "Last name", required: true },
      {
        key: "officialEmail",
        label: "Official email",
        type: "email",
        required: true,
      },
      { key: "personalEmail", label: "Personal email", type: "email" },
      { key: "mobile", label: "Mobile number" },
      { key: "joinedAt", label: "Joining date", type: "date", required: true },
      {
        key: "departmentId",
        label: "Department",
        type: "select",
        reference: "departments",
      },
      {
        key: "designationId",
        label: "Designation",
        type: "select",
        reference: "designations",
      },
      {
        key: "branchId",
        label: "Work location",
        type: "select",
        reference: "branches",
      },
      {
        key: "status",
        label: "Employment status",
        type: "select",
        required: true,
        options: ["Active", "Probation", "On notice", "Inactive"].map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        key: "attendanceMode",
        label: "Attendance access",
        type: "select",
        required: true,
        options: [
          { value: "DEFAULT", label: "Company / location default" },
          { value: "GEOFENCE", label: "Require assigned location geofence" },
          { value: "GPS", label: "GPS attendance anywhere" },
          { value: "OPEN", label: "Open attendance anywhere (no GPS)" },
        ],
      },
      {
        key: "fieldTrackingAllowed",
        label: "Allow live field GPS tracking",
        type: "select",
        required: true,
        options: [
          { value: "true", label: "Allowed with employee consent" },
          { value: "false", label: "Not allowed" },
        ],
      },
      {
        key: "faceRequired",
        label: "Require face verification for attendance",
        type: "select",
        required: true,
        options: [
          { value: "true", label: "Required" },
          { value: "false", label: "Not required" },
        ],
      },
      {
        key: "employmentType",
        label: "Employment type",
        type: "select",
        required: true,
        options: ["Full time", "Part time", "Contract", "Intern"].map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        key: "managerId",
        label: "Reporting manager",
        type: "select",
        reference: "employees",
        excludeId: editing?.id,
      },
      ...(me.permissions.includes("users.read")
        ? [
            {
              key: "userId",
              label: "Linked login account",
              type: "select" as const,
              reference: "users" as const,
            },
          ]
        : []),
      { key: "dateOfBirth", label: "Date of birth", type: "date" },
      { key: "gender", label: "Gender" },
      { key: "bloodGroup", label: "Blood group" },
      { key: "maritalStatus", label: "Marital status" },
      { key: "confirmationDate", label: "Confirmation date", type: "date" },
      { key: "probationDays", label: "Probation (days)", type: "number" },
      { key: "noticeDays", label: "Notice period (days)", type: "number" },
      ...["current", "permanent", "city", "state", "pin", "country"].map(
        (v) => ({ key: `address_${v}`, label: `Address · ${v}` }),
      ),
      ...["name", "relationship", "phone"].map((v) => ({
        key: `emergencyContact_${v}`,
        label: `Emergency contact · ${v}`,
      })),
      ...(me.permissions.includes("employees.sensitive")
        ? [
            "pan",
            "aadhaarReference",
            "uan",
            "pfNumber",
            "esiNumber",
            "bankAccount",
            "ifsc",
          ].map((v) => ({
            key: `sensitive_${v}`,
            label: `Confidential · ${v}`,
          }))
        : []),
    ];
  function initial() {
    const base: Record<string, unknown> = editing
      ? { ...editing }
      : {
          status: "Active",
          employmentType: "Full time",
          active: "true",
          geofenceEnabled: "false",
          attendanceMode: "DEFAULT",
          fieldTrackingAllowed: "false",
          faceRequired: "false",
          radiusMeters: 200,
          probationDays: 90,
          noticeDays: 30,
          joinedAt: new Date().toISOString().slice(0, 10),
        };
    for (const group of ["address", "emergencyContact", "sensitive"]) {
      const v = editing?.[group];
      if (v && typeof v === "object")
        for (const [key, value] of Object.entries(v))
          base[`${group}_${key}`] = value;
    }
    return base;
  }
  async function save(values: Record<string, string>) {
    const body: Record<string, unknown> = { ...values };
    if (module === "organization" && tab === "branches") {
      body.geofenceEnabled = values.geofenceEnabled === "true";
      for (const key of ["latitude", "longitude"])
        body[key] = values[key]?.trim() ? Number(values[key]) : null;
      body.radiusMeters = Number(values.radiusMeters);
    }
    if (module === "users") {
      body.active = values.active === "true";
      if (!values.password) delete body.password;
      if (!values.mobile) body.mobile = null;
    }
    if (module === "employees") {
      body.fieldTrackingAllowed = values.fieldTrackingAllowed === "true";
      body.faceRequired = values.faceRequired === "true";
      for (const group of ["address", "emergencyContact", "sensitive"]) {
        const entries = Object.entries(values).filter(([key]) =>
          key.startsWith(`${group}_`),
        );
        if (entries.length)
          body[group] = Object.fromEntries(
            entries.map(([key, value]) => [key.slice(group.length + 1), value]),
          );
        entries.forEach(([key]) => delete body[key]);
      }
      for (const key of [
        "departmentId",
        "designationId",
        "branchId",
        "userId",
        "managerId",
        "dateOfBirth",
        "confirmationDate",
      ])
        if (key in body && !body[key]) body[key] = null;
      for (const key of ["probationDays", "noticeDays"])
        body[key] = Number(body[key] || 0);
    }
    await api(`${resource}${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    await client.invalidateQueries();
    setEditing(undefined);
    notify(editing ? "Changes saved." : "Record created.");
  }
  async function remove() {
    if (!confirm) return;
    setDeleting(true);
    setActionError("");
    try {
      await api(`${resource}/${confirm.id}`, { method: "DELETE" });
      await client.invalidateQueries();
      setConfirm(null);
      notify(module === "employees" ? "Employee archived." : "Record deleted.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  function exportCsv() {
    const cols =
      module === "users"
        ? ["name", "email", "active"]
        : module === "audit"
          ? ["actorName", "action", "module", "createdAt"]
          : ["name"];
    const safe = (v: unknown) => {
      let s = str(v);
      if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const text = [
      cols.join(","),
      ...items.map((r) => cols.map((c) => safe(r[c])).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource}-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const title =
    module === "employees"
      ? "Employee directory"
      : module === "users"
        ? "Users & access"
        : module === "audit"
          ? "Audit trail"
          : "Organization";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">People operations</div>
          <h1>{title}</h1>
          <p>
            {module === "employees"
              ? "A shared home for your people and their information."
              : module === "users"
                ? "Manage sign-in accounts and assign the right access."
                : module === "audit"
                  ? "A traceable record of changes in your company."
                  : "Give your company a clear, connected structure."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {module === "employees" && write && (
            <EmployeeImport
              onImported={() => {
                void client.invalidateQueries({ queryKey: ["employees"] });
                void client.invalidateQueries({
                  queryKey: ["employeeOptions"],
                });
                void client.invalidateQueries({ queryKey: ["dashboard"] });
              }}
            />
          )}
          {module === "employees" ? (
            // Full, filtered export generated on the server (all pages).
            (["csv", "xlsx", "pdf"] as const).map((f) => (
              <a
                key={f}
                className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-[var(--border)] text-sm font-semibold"
                href={`/api/employees/export?${new URLSearchParams({
                  format: f,
                  search: query,
                  ...(department ? { departmentId: department } : {}),
                  ...(branch ? { branchId: branch } : {}),
                  ...(status ? { status } : {}),
                })}`}
              >
                <Download size={16} />
                {f === "xlsx" ? "Excel" : f.toUpperCase()}
              </a>
            ))
          ) : (
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={!items.length}
            >
              <Download />
              Export page
            </Button>
          )}
          {write && (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              Add{" "}
              {module === "organization"
                ? tab === "branches"
                  ? "location"
                  : tab.slice(0, -1)
                : module === "users"
                  ? "user"
                  : "employee"}
            </Button>
          )}
        </div>
      </div>
      {module === "organization" && (
        <div className="section-tabs">
          {["departments", "designations", "branches"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setSearch("");
                setPage(1);
              }}
              key={t}
            >
              {t === "branches"
                ? "Locations & attendance areas"
                : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}
      <section className="card">
        <div className="toolbar">
          <div className="relative flex-1 min-w-48 max-w-80">
            <Search size={16} className="absolute left-3 top-3.5 muted" />
            <input
              className="pl-10"
              aria-label="Search records"
              placeholder="Search records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {module === "employees" && (
            <>
              {me.permissions.includes("organization.read") && (
                <>
                  <ReferenceSelect
                    resource="departments"
                    label="Filter department"
                    value={department}
                    onChange={(value) => {
                      setDepartment(value);
                      setPage(1);
                    }}
                  />
                  <ReferenceSelect
                    resource="branches"
                    label="Filter branch"
                    value={branch}
                    onChange={(value) => {
                      setBranch(value);
                      setPage(1);
                    }}
                  />
                </>
              )}
              <select
                aria-label="Filter status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {["Active", "Probation", "On notice", "Inactive"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </>
          )}
          <span className="text-xs muted ml-auto">{total} records</span>
        </div>
        {error && <div className="error m-4">{error.message}</div>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {(module === "employees"
                  ? [
                      "Employee",
                      "Department",
                      "Designation",
                      "Joined",
                      "Status",
                    ]
                  : module === "users"
                    ? ["User", "Role", "Status"]
                    : module === "audit"
                      ? ["User", "Action", "Module", "Timestamp", "Changes"]
                      : ["Name"]
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
                {(write || module === "employees") && (
                  <th className="text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  {module === "employees" ? (
                    <>
                      <td>
                        <div className="flex gap-3 items-center">
                          <span className="avatar">
                            {str(row.firstName)[0]}
                            {str(row.lastName)[0]}
                          </span>
                          <div>
                            <p className="font-semibold">
                              {str(row.firstName)} {str(row.lastName)}
                            </p>
                            <p className="text-[11px] muted mt-1">
                              {str(row.employeeCode)} · {str(row.officialEmail)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>{nested(row.department, "name") || "—"}</td>
                      <td className="muted">
                        {nested(row.designation, "name") || "—"}
                      </td>
                      <td className="muted whitespace-nowrap">
                        {str(row.joinedAt).slice(0, 10)}
                      </td>
                      <td>
                        <span
                          className={`badge ${row.status === "Active" ? "positive" : "amber"}`}
                        >
                          {str(row.status)}
                        </span>
                      </td>
                    </>
                  ) : module === "users" ? (
                    <>
                      <td>
                        <p className="font-semibold">{str(row.name)}</p>
                        <p className="muted text-xs mt-1">{str(row.email)}</p>
                      </td>
                      <td>{nested(row.role, "name")}</td>
                      <td>
                        <span
                          className={`badge ${row.active ? "positive" : ""}`}
                        >
                          {row.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                    </>
                  ) : module === "audit" ? (
                    <>
                      <td>{str(row.actorName)}</td>
                      <td>
                        <span className="badge">{str(row.action)}</span>
                      </td>
                      <td>{str(row.module)}</td>
                      <td className="whitespace-nowrap muted">
                        {new Date(str(row.createdAt)).toLocaleString()}
                      </td>
                      <td>
                        <details>
                          <summary className="text-blue-700 cursor-pointer">
                            View changes
                          </summary>
                          <pre className="text-[10px] max-w-80 overflow-auto mt-2">
                            {JSON.stringify(
                              { old: row.oldValue, new: row.newValue },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </td>
                    </>
                  ) : (
                    <td className="font-semibold">
                      {str(row.name)}
                      {module === "organization" && tab === "branches" && (
                        <div className="text-sm font-normal muted mt-1">
                          <p>{str(row.address) || "No address added"}</p>
                          <p>
                            {row.geofenceEnabled
                              ? `GPS area: ${str(row.latitude)}, ${str(row.longitude)} · ${str(row.radiusMeters)} meters`
                              : "Attendance: company default"}
                          </p>
                        </div>
                      )}
                    </td>
                  )}
                  {(write || module === "employees") && (
                    <td>
                      <div className="flex justify-end gap-1">
                        {module === "employees" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`View ${str(row.firstName)}`}
                            onClick={() => setViewing(row)}
                          >
                            <Eye />
                          </Button>
                        )}
                        {write && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${str(row.name || row.firstName)}`}
                            disabled={
                              module === "users" &&
                              (!!row.isSuperAdmin ||
                                nested(row.role, "name") === "Company Admin" ||
                                row.id === me.userId)
                            }
                            onClick={() => setEditing(row)}
                          >
                            <Pencil />
                          </Button>
                        )}
                        {module === "users" && write && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              !!row.isSuperAdmin ||
                              nested(row.role, "name") === "Company Admin"
                            }
                            onClick={async () => {
                              try {
                                const result = await api<{
                                  token: string;
                                  expiresAt: string;
                                  employee: {
                                    firstName: string;
                                    lastName: string;
                                    employeeCode: string;
                                  };
                                }>(`users/${row.id}/password-reset`, {
                                  method: "POST",
                                });
                                setResetUser({
                                  name: `${result.employee.firstName} ${result.employee.lastName}`,
                                  employeeCode: result.employee.employeeCode,
                                  token: result.token,
                                  expiresAt: result.expiresAt,
                                });
                              } catch (e) {
                                setActionError(
                                  e instanceof Error
                                    ? e.message
                                    : "Password reset failed.",
                                );
                              }
                            }}
                          >
                            Reset login
                          </Button>
                        )}
                        {write && module !== "users" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={
                              module === "employees"
                                ? "Archive employee"
                                : "Delete record"
                            }
                            onClick={() => {
                              setActionError("");
                              setConfirm(row);
                            }}
                          >
                            {module === "employees" ? <Archive /> : <Trash2 />}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="empty">
              {isLoading
                ? "Loading records…"
                : query
                  ? "No records match your search."
                  : "No records yet. Add one to get started."}
            </div>
          )}
        </div>
        <div className="pagination">
          <span>
            {total
              ? `${(page - 1) * 10 + 1}–${Math.min(page * 10, total)} of ${total}`
              : "0 records"}
          </span>
          {
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              Page {page}
              <Button
                size="sm"
                variant="outline"
                disabled={page * 10 >= total}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          }
        </div>
      </section>
      <Dialog
        open={!!viewing}
        onOpenChange={(v) => {
          if (!v) setViewing(null);
        }}
        title={
          viewing
            ? `${str(viewing.firstName)} ${str(viewing.lastName)}`
            : "Employee profile"
        }
        description="Employee information visible to your role."
      >
        {viewing &&
          module === "employees" &&
          typeof viewing.id === "string" && (
            <div className="mb-5">
              <EmployeePhoto
                path={`employees/${viewing.id}/photo`}
                name={`${str(viewing.firstName)} ${str(viewing.lastName)}`}
                canEdit={me.permissions.includes("employees.write")}
                notify={notify}
              />
            </div>
          )}
        <dl className="form-grid">
          {viewing &&
            fields
              .filter((f) => f.type !== "password")
              .map((f) => {
                const separator = f.key.indexOf("_");
                const value =
                  separator > 0
                    ? nested(
                        viewing[f.key.slice(0, separator)],
                        f.key.slice(separator + 1),
                      )
                    : viewing[f.key];
                const label = f.options?.find((o) => o.value === value)?.label;
                return (
                  <div key={f.key}>
                    <dt className="text-xs muted">{f.label}</dt>
                    <dd className="mt-1 break-words">
                      {label ||
                        str(value).slice(
                          0,
                          f.type === "date" ? 10 : undefined,
                        ) ||
                        "Not provided"}
                    </dd>
                  </div>
                );
              })}
        </dl>
        {viewing &&
          module === "employees" &&
          typeof viewing.id === "string" && (
            <div className="mt-6 space-y-6">
              <EmergencyContacts
                base={`employees/${viewing.id}`}
                canEdit={me.permissions.includes("employees.write")}
                notify={notify}
              />
              {me.permissions.includes("employees.sensitive") && (
                <BankAccounts
                  employeeId={viewing.id}
                  canEdit={me.permissions.includes("employees.write")}
                  notify={notify}
                />
              )}
            </div>
          )}
      </Dialog>
      <Dialog
        open={!!resetUser}
        onOpenChange={(open) => {
          if (!open) setResetUser(null);
        }}
        title="Employee first-login code"
        description="Share this one-time code securely with the employee. It expires in 24 hours."
      >
        {resetUser && (
          <div className="space-y-4">
            <p>
              <strong>{resetUser.name}</strong> · {resetUser.employeeCode}
            </p>
            <label>
              Setup code
              <input readOnly value={resetUser.token} />
            </label>
            <p className="muted text-xs">
              Employee setup page: /employee-setup
            </p>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(resetUser.token);
                notify("Setup code copied.");
              }}
            >
              Copy code
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
        title={`${editing ? "Edit" : "Add"} ${module === "organization" ? (tab === "branches" ? "location" : tab.slice(0, -1)) : module === "users" ? "user" : "employee"}`}
      >
        <RecordForm
          key={editing?.id || "new"}
          fields={fields}
          initial={initial()}
          onSave={save}
          onCancel={() => setEditing(undefined)}
        />
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
        title={
          module === "employees" ? "Archive employee?" : "Delete this record?"
        }
        description={
          module === "employees"
            ? "This marks the employee inactive and disables their linked login. The record stays available for reference."
            : "Deletion is allowed only when no employees use this record."
        }
      >
        {actionError && <div className="error mb-4">{actionError}</div>}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={remove}>
            {deleting ? "Working…" : "Confirm"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
