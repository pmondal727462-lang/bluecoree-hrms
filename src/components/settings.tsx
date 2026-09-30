"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, ShieldCheck, Monitor, UserRound } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me, Row, Field } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { AccountSecurity } from "./account-security";
import { AccountExtras } from "./security";
import { EmployeePhoto } from "./employee-photo";
import { EmergencyContacts } from "./employee-contacts";
import { NotificationTemplates } from "./notification-templates";
const companyFields: Field[] = [
  { key: "name", label: "Company name", required: true },
  { key: "code", label: "Company code", required: true },
  { key: "email", label: "Contact email", type: "email", required: true },
  { key: "phone", label: "Contact phone" },
  { key: "website", label: "Website" },
  { key: "timezone", label: "Time zone", required: true },
  { key: "address", label: "Registered address", type: "textarea" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "tan", label: "TAN" },
  { key: "cin", label: "CIN" },
  { key: "pfRegistration", label: "PF registration number" },
  { key: "esiRegistration", label: "ESI registration number" },
];
export function CompanySettings({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<Row>("company"),
  });
  const [days, setDays] = useState<number[] | null>(null);
  if (error) return <div className="error">{error.message}</div>;
  if (!data) return <div className="empty">Loading company settings…</div>;
  const selected = days || (data.workingDays as number[]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Workspace preferences</div>
          <h1>Company settings</h1>
          <p>Your organization’s identity and everyday defaults.</p>
        </div>
        <span className="badge positive">
          <ShieldCheck size={12} />
          Company isolated
        </span>
      </div>
      <CompanyLogoSettings me={me} notify={notify} />
      <section className="card max-w-4xl mt-6">
        <div className="card-title">
          <h2 className="flex items-center gap-3">
            <Building2 size={18} />
            Company information
          </h2>
        </div>
        <div className="p-6">
          {me.permissions.includes("company.write") ? (
            <RecordForm
              key={String(data.updatedAt)}
              fields={companyFields}
              initial={data}
              onSave={async (values) => {
                await api("company", {
                  method: "PUT",
                  body: JSON.stringify({ ...values, workingDays: selected }),
                });
                await client.invalidateQueries();
                notify("Company settings saved.");
              }}
            >
              <div className="mt-6">
                <label>Working days *</label>
                <div className="flex flex-wrap gap-4 mt-3">
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, i) => (
                    <label className="flex items-center gap-2" key={day}>
                      <input
                        type="checkbox"
                        className="mt-0!"
                        checked={selected.includes(i)}
                        onChange={(e) =>
                          setDays(
                            e.target.checked
                              ? [...selected, i]
                              : selected.filter((d) => d !== i),
                          )
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>
            </RecordForm>
          ) : (
            <dl className="form-grid">
              {companyFields.map((f) => (
                <div key={f.key}>
                  <dt className="muted text-xs">{f.label}</dt>
                  <dd className="mt-2">{String(data[f.key] || "—")}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>
      <CompanyPreferences me={me} notify={notify} />
      {me.permissions.includes("notifications.manage") && (
        <NotificationTemplates notify={notify} />
      )}
    </>
  );
}

type CompanyPrefs = Record<string, string | number | boolean | null> & {
  hasLogo: boolean;
};
function CompanyLogoSettings({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["company", "settings"],
    queryFn: () => api<CompanyPrefs>("company/settings"),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canEdit = me.permissions.includes("company.write");
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["company", "settings"] }),
      client.invalidateQueries({ queryKey: ["me"] }),
    ]);
  }
  return (
    <section className="card max-w-4xl">
      <div className="card-title">
        <h2>Company logo</h2>
      </div>
      <div className="p-6 space-y-4">
        <p className="muted text-sm">
          Upload your company logo to display it in your team's workspace. PNG
          or JPEG, up to 256 KB.
        </p>
        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}
        {!data && !error && <p className="muted">Loading company logo…</p>}
        {data && (
          <div className="flex items-center gap-4 flex-wrap">
            {data.hasLogo ? (
              <img
                src={`/api/company/settings/logo?v=${encodeURIComponent(String(data.updatedAt))}&company=${encodeURIComponent(me.companyId)}`}
                alt={`${me.company.name} logo`}
                className="h-20 max-w-60 object-contain rounded border border-[var(--border)] p-2"
              />
            ) : (
              <span className="muted text-sm">No company logo uploaded.</span>
            )}
            {canEdit && (
              <div className="space-y-3">
                <label className="block" htmlFor="company-logo-upload">
                  {data.hasLogo
                    ? "Replace company logo"
                    : "Upload company logo"}
                </label>
                <input
                  id="company-logo-upload"
                  type="file"
                  accept="image/png,image/jpeg"
                  className="max-w-xs"
                  disabled={busy}
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    setMessage("");
                    setBusy(true);
                    try {
                      if (!["image/png", "image/jpeg"].includes(file.type))
                        throw new Error("Upload a PNG or JPEG image.");
                      if (!file.size || file.size > 256 * 1024)
                        throw new Error("Choose an image up to 256 KB.");
                      const dataUrl = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(String(reader.result));
                          reader.onerror = () =>
                            reject(new Error("Could not read the file."));
                          reader.readAsDataURL(file);
                        },
                      );
                      await api("company/settings/logo", {
                        method: "POST",
                        body: JSON.stringify({ dataUrl }),
                      });
                      await refresh();
                      notify("Company logo updated.");
                    } catch (err) {
                      setMessage((err as Error).message);
                    } finally {
                      input.value = "";
                      setBusy(false);
                    }
                  }}
                />
                {data.hasLogo && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setMessage("");
                      try {
                        await api("company/settings/logo", {
                          method: "DELETE",
                        });
                        await refresh();
                        notify("Company logo removed.");
                      } catch (err) {
                        setMessage((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove logo
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {busy && (
          <p role="status" className="muted text-sm">
            Updating company logo…
          </p>
        )}
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function CompanyPreferences({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["company", "settings"],
    queryFn: () => api<CompanyPrefs>("company/settings"),
  });
  if (error) return <div className="error mt-6">{error.message}</div>;
  if (!data) return null;
  const canEdit = me.permissions.includes("company.write");
  return (
    <section className="card max-w-4xl mt-6">
      <div className="card-title">
        <h2>Registration & preferences</h2>
      </div>
      <div className="p-6 space-y-6">
        <RecordForm
          key={String(data.updatedAt)}
          initial={data}
          submitLabel={canEdit ? "Save preferences" : "Read only"}
          fields={[
            { key: "legalName", label: "Legal name" },
            { key: "city", label: "City" },
            { key: "state", label: "State" },
            { key: "pinCode", label: "PIN code" },
            { key: "country", label: "Country", required: true },
            { key: "currency", label: "Currency (ISO code)", required: true },
            {
              key: "dateFormat",
              label: "Date format",
              type: "select",
              required: true,
              options: [
                "DD/MM/YYYY",
                "MM/DD/YYYY",
                "YYYY-MM-DD",
                "DD-MMM-YYYY",
              ].map((v) => ({ value: v, label: v })),
            },
            {
              key: "financialYearStartMonth",
              label: "Financial year starts",
              type: "select",
              required: true,
              options: months.map((m, i) => ({
                value: String(i + 1),
                label: m,
              })),
            },
          ]}
          onSave={async (v) => {
            if (!canEdit) return;
            const opt = (k: string) => (v[k]?.trim() ? v[k].trim() : null);
            await api("company/settings", {
              method: "PUT",
              body: JSON.stringify({
                legalName: opt("legalName"),
                city: opt("city"),
                state: opt("state"),
                pinCode: opt("pinCode"),
                country: v.country,
                currency: v.currency,
                dateFormat: v.dateFormat,
                financialYearStartMonth: Number(v.financialYearStartMonth),
                payrollCycle: data.payrollCycle,
                payrollCutoffDay: data.payrollCutoffDay ?? null,
              }),
            });
            await client.invalidateQueries({ queryKey: ["company"] });
            notify("Preferences saved.");
          }}
        />
      </div>
    </section>
  );
}
export function CompanyList({
  notify,
  createOnly = false,
}: {
  notify: (s: string) => void;
  createOnly?: boolean;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Row[]>("companies"),
  });
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Super Admin</div>
          <h1>{createOnly ? "Add client" : "Companies"}</h1>
          <p>
            Separate workspaces, independent administrators, isolated records.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus />
          Create company
        </Button>
      </div>
      {error && <div className="error">{error.message}</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        {!createOnly &&
          data?.map((c) => (
            <div className="card p-6" key={c.id}>
              <Building2 className="text-blue-700 mb-5" />
              <h2 className="font-bold">{String(c.name)}</h2>
              <p className="muted text-xs mt-2">
                Company code · {String(c.code)}
              </p>
              <p className="muted text-xs mt-5">
                Sign in with this company’s account to access its records.
              </p>
            </div>
          ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Create a company"
        description="A new company gets its own roles, departments and administrator."
      >
        <RecordForm
          fields={[
            { key: "name", label: "Company name", required: true },
            { key: "code", label: "Company code", required: true },
            {
              key: "email",
              label: "Company email",
              type: "email",
              required: true,
            },
            { key: "adminName", label: "Administrator name", required: true },
            {
              key: "adminEmail",
              label: "Administrator email",
              type: "email",
              required: true,
            },
            {
              key: "adminPassword",
              label: "Administrator password (12+ characters)",
              type: "password",
              required: true,
            },
          ]}
          onCancel={() => setOpen(false)}
          onSave={async (v) => {
            await api("companies", {
              method: "POST",
              body: JSON.stringify({
                company: { name: v.name, code: v.code, email: v.email },
                admin: {
                  name: v.adminName,
                  email: v.adminEmail,
                  password: v.adminPassword,
                },
              }),
            });
            await client.invalidateQueries({ queryKey: ["companies"] });
            await client.invalidateQueries({
              queryKey: ["platform", "companies"],
            });
            setOpen(false);
            notify("Company created. Its administrator can now sign in.");
          }}
        />
      </Dialog>
    </>
  );
}
export function Profile({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Row | null>("profile"),
  });
  const [editing, setEditing] = useState(false);
  if (error) return <div className="error">{error.message}</div>;
  const fields: Field[] = [
    { key: "personalEmail", label: "Personal email", type: "email" },
    { key: "mobile", label: "Mobile number" },
    ...["current", "permanent", "city", "state", "pin", "country"].map(
      (key) => ({ key: `address_${key}`, label: `Address · ${key}` }),
    ),
    ...["name", "relationship", "phone"].map((key) => ({
      key: `emergencyContact_${key}`,
      label: `Emergency contact · ${key}`,
    })),
  ];
  const initial: Record<string, unknown> = { ...data };
  for (const group of ["address", "emergencyContact"])
    if (data?.[group] && typeof data[group] === "object")
      for (const [key, value] of Object.entries(data[group]))
        initial[`${group}_${key}`] = value;
  const name = (value: unknown) =>
    value && typeof value === "object"
      ? String((value as { name: string }).name)
      : "Not assigned";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Employee workspace</div>
          <h1>My profile</h1>
          <p>Your information, connected to your organization.</p>
        </div>
        {data && me.permissions.includes("profile.write") && (
          <Button onClick={() => setEditing(true)}>
            Edit personal details
          </Button>
        )}
      </div>
      <div className="card p-7 flex items-center gap-5 mb-6">
        {data ? (
          <EmployeePhoto
            path="profile/photo"
            name={me.name}
            canEdit={me.permissions.includes("profile.write")}
            notify={notify}
          />
        ) : (
          <span className="avatar size-16 text-xl">
            {me.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
        )}
        <div>
          <h2 className="text-xl font-bold">
            {data ? `${data.firstName} ${data.lastName}` : me.name}
          </h2>
          <p className="muted mt-2">
            {me.company.name} · {me.roleName}
          </p>
          {data && (
            <span className="badge positive mt-3">{String(data.status)}</span>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="empty">Loading profile…</div>
      ) : !data ? (
        <div className="card empty">
          <UserRound className="mx-auto mb-4" />
          <h2 className="font-semibold text-[var(--text)] mb-2">
            Your account is ready
          </h2>
          <p>
            Ask HR to link an employee record to your login to see your personal
            profile.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {[
              ["Employee ID", data.employeeCode],
              ["Department", name(data.department)],
              ["Designation", name(data.designation)],
              ["Joined", String(data.joinedAt).slice(0, 10)],
            ].map(([label, value]) => (
              <div className="card p-5" key={String(label)}>
                <p className="muted text-xs">{String(label)}</p>
                <p className="mt-3 font-semibold">{String(value || "—")}</p>
              </div>
            ))}
          </div>
          <section className="card">
            <div className="card-title">
              <h2>Personal & contact information</h2>
            </div>
            <dl className="form-grid p-6">
              {fields.map((f) => (
                <div key={f.key}>
                  <dt className="muted text-xs">{f.label}</dt>
                  <dd className="mt-2">
                    {String(initial[f.key] || "Not provided")}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card p-6 mt-6">
            <EmergencyContacts
              base="profile"
              canEdit={me.permissions.includes("profile.write")}
              notify={notify}
            />
          </section>
        </>
      )}
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit personal details"
        description="Employment details and identity records are managed by your HR team."
      >
        <RecordForm
          fields={fields}
          initial={initial}
          onCancel={() => setEditing(false)}
          onSave={async (values) => {
            const payload: Record<string, unknown> = {
              personalEmail: values.personalEmail,
              mobile: values.mobile,
            };
            for (const group of ["address", "emergencyContact"])
              payload[group] = Object.fromEntries(
                Object.entries(values)
                  .filter(([k]) => k.startsWith(`${group}_`))
                  .map(([k, v]) => [k.slice(group.length + 1), v]),
              );
            await api("profile", {
              method: "PUT",
              body: JSON.stringify(payload),
            });
            await client.invalidateQueries({ queryKey: ["profile"] });
            setEditing(false);
            notify("Your personal details have been updated.");
          }}
        />
      </Dialog>
    </>
  );
}
export function SessionList({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Row[]>("auth/sessions"),
  });
  const [target, setTarget] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Account security</div>
          <h1>My sessions</h1>
          <p>Review your signed-in devices and revoke access.</p>
        </div>
      </div>
      {error && <div className="error">{error.message}</div>}
      <div className="card divide-y divide-[var(--border)]">
        {data?.map((s) => (
          <div className="p-6 flex items-center gap-4" key={s.id}>
            <Monitor className="shrink-0 text-blue-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {s.id === me.sessionId ? "This session" : "Signed-in session"}
              </p>
              <p className="muted text-xs mt-2 truncate">
                {String(s.userAgent || "Unknown device")}
              </p>
              <p className="muted text-xs mt-1">
                Started {new Date(String(s.createdAt)).toLocaleString()} ·
                Expires {new Date(String(s.expiresAt)).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMessage("");
                setTarget(s);
              }}
            >
              Revoke
            </Button>
          </div>
        ))}
      </div>
      <AccountSecurity />
      <AccountExtras notify={notify} />
      <Dialog
        open={!!target}
        onOpenChange={(v) => {
          if (!v) setTarget(null);
        }}
        title="Revoke this session?"
        description="The device will need to sign in again. Revoking this session signs you out."
      >
        {message && <div className="error mb-4">{message}</div>}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`auth/sessions/${target?.id}`, { method: "DELETE" });
                if (target?.id === me.sessionId) {
                  window.location.href = "/login";
                  return;
                }
                await client.invalidateQueries({ queryKey: ["sessions"] });
                setTarget(null);
                notify("Session revoked.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Revoke session
          </Button>
        </div>
      </Dialog>
    </>
  );
}
