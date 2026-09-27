"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Pencil } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
type Role = {
  id: string;
  name: string;
  system: boolean;
  permissions: { permissionKey: string }[];
  _count: { users: number };
};
export function RoleManager({
  me,
  notify,
}: {
  me: Me;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["roles"],
    queryFn: () =>
      api<{ items: Role[]; permissions: Record<string, string> }>("roles"),
  });
  const [editing, setEditing] = useState<Role | null | undefined>(undefined),
    [name, setName] = useState(""),
    [grants, setGrants] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [formError, setError] = useState("");
  function open(role: Role | null) {
    setEditing(role);
    setName(role?.name || "");
    setGrants(role?.permissions.map((p) => p.permissionKey) || []);
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`roles${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name, permissions: grants }),
      });
      await client.invalidateQueries();
      setEditing(undefined);
      notify(
        "Role permissions saved. Affected users will need to sign in again.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Access control</div>
          <h1>Roles & permissions</h1>
          <p>Give each person the access they need for their work.</p>
        </div>
        {me.permissions.includes("roles.write") && (
          <Button onClick={() => open(null)}>
            <Plus />
            Create role
          </Button>
        )}
      </div>
      {error && <div className="error">{error.message}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {data?.items.map((r) => (
          <div key={r.id} className="card p-6">
            <div className="flex justify-between">
              <div className="rounded-lg p-2 bg-blue-700/10 text-blue-700">
                <ShieldCheck size={20} />
              </div>
              {me.permissions.includes("roles.write") &&
                !["Super Admin", "Company Admin"].includes(r.name) &&
                r.id !== me.roleId &&
                r.permissions.every((p) =>
                  me.permissions.includes(p.permissionKey),
                ) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => open(r)}
                  >
                    <Pencil />
                  </Button>
                )}
            </div>
            <h2 className="font-bold text-base mt-5">{r.name}</h2>
            <p className="text-xs muted mt-2">
              {r._count.users} users · {r.permissions.length} permissions
            </p>
            <div className="flex flex-wrap gap-1.5 mt-5">
              {r.permissions.slice(0, 4).map((p) => (
                <span key={p.permissionKey} className="badge">
                  {p.permissionKey}
                </span>
              ))}
              {r.permissions.length > 4 && (
                <span className="badge">+{r.permissions.length - 4} more</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
        title={editing ? "Edit role" : "Create role"}
        description="Permissions apply only within this company. Administrator roles are protected."
      >
        <form onSubmit={save}>
          <label>
            Role name *
            <input
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            {Object.entries(data?.permissions || {}).map(([key, label]) => (
              <label
                key={key}
                className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3"
              >
                <input
                  className="mt-0! shrink-0"
                  type="checkbox"
                  checked={grants.includes(key)}
                  disabled={!me.permissions.includes(key)}
                  onChange={(e) =>
                    setGrants(
                      e.target.checked
                        ? [...grants, key]
                        : grants.filter((p) => p !== key),
                    )
                  }
                />
                <span>
                  {label}
                  <small className="block font-normal text-[10px] mt-1">
                    {key}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {formError && <div className="error mt-4">{formError}</div>}
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
            <Button disabled={busy}>
              {busy ? "Saving…" : "Save permissions"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
