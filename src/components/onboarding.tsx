"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Table, type Notify } from "./platform";

type Task = {
  id: string;
  title: string;
  category: string;
  assignee: string;
  required: boolean;
  status: string;
  documentId: string | null;
  notes: string | null;
};
type Onboarding = {
  id: string;
  name: string;
  email: string;
  employeeCode: string;
  joiningDate: string;
  status: string;
  employeeId: string | null;
  tasks: Task[];
};
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
async function fileOf(file: File) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Files must be 5 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
}

export function OnboardingPage({ notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api<Onboarding[]>("onboarding"),
  });
  const candidates = useQuery({
    queryKey: ["onboarding", "offers"],
    queryFn: () =>
      api<{ id: string; name: string; job: { title: string } }[]>(
        "recruitment/candidates?stage=OFFER",
      ).catch(() => []),
  });
  const [starting, setStarting] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["onboarding"] });
  return (
    <>
      <Heading
        eyebrow="Onboarding"
        title="New joiners"
        text="Pre-joining checklists. Joiners upload documents and accept policies through a private link; completing onboarding creates the employee record."
        action={
          <Button onClick={() => setStarting(true)}>
            <Plus />
            Start onboarding
          </Button>
        }
      />
      <section className="card">
        <Table
          headers={["Joiner", "Code", "Joining", "Progress", "Status", ""]}
          loading={list.isLoading}
          error={list.error}
          empty="No onboarding in progress."
          rows={(list.data ?? []).map((o) => {
            const req = o.tasks.filter((t) => t.required);
            return [
              `${o.name} · ${o.email}`,
              o.employeeCode,
              o.joiningDate.slice(0, 10),
              `${req.filter((t) => t.status === "DONE").length}/${req.length} required done`,
              label(o.status),
              <Button
                key="o"
                size="sm"
                variant="outline"
                onClick={() => setOpen(o.id)}
              >
                Open
              </Button>,
            ];
          })}
        />
      </section>
      <Dialog
        open={starting}
        onOpenChange={setStarting}
        title="Start onboarding"
        description="Choose a candidate with an offer, or enter the joiner's details."
      >
        {starting && (
          <RecordForm
            fields={[
              {
                key: "candidateId",
                label: "Candidate with offer",
                type: "select",
                options: (candidates.data ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.name} · ${c.job.title}`,
                })),
              },
              { key: "name", label: "Name (if not a candidate)" },
              {
                key: "email",
                label: "Email (if not a candidate)",
                type: "email",
              },
              { key: "phone", label: "Phone" },
              { key: "employeeCode", label: "Employee code", required: true },
              {
                key: "joiningDate",
                label: "Joining date",
                type: "date",
                required: true,
              },
            ]}
            onCancel={() => setStarting(false)}
            onSave={async (v) => {
              const opt = (k: string) => (v[k] ? { [k]: v[k] } : {});
              const o = await api<{ id: string }>("onboarding", {
                method: "POST",
                body: JSON.stringify({
                  ...opt("candidateId"),
                  ...opt("name"),
                  ...opt("email"),
                  ...opt("phone"),
                  employeeCode: v.employeeCode,
                  joiningDate: v.joiningDate,
                }),
              });
              setStarting(false);
              await refresh();
              setOpen(o.id);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Onboarding"
      >
        {open && <Detail id={open} notify={notify} />}
      </Dialog>
    </>
  );
}
function Detail({ id, notify }: { id: string; notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["onboarding", id],
    queryFn: () => api<Onboarding>(`onboarding/${id}`),
  });
  const [link, setLink] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["onboarding"] });
  const o = data.data;
  if (!o)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const active = o.status === "IN_PROGRESS";
  const setTask = async (t: Task, status: string) => {
    try {
      await api(`onboarding/${id}/tasks/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {o.name} · {o.employeeCode} · joining {o.joiningDate.slice(0, 10)} ·{" "}
        {label(o.status)}
      </p>
      {active && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await api<{ link: string; emailed: boolean }>(
                `onboarding/${id}/invite`,
                { method: "POST" },
              );
              setLink(r.link);
              notify(
                r.emailed
                  ? "Invitation emailed."
                  : "Link created. Email is not configured; share the link securely.",
              );
            }}
          >
            Create joiner link
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api(`onboarding/${id}/complete`, { method: "POST" });
                notify("Onboarding complete. The employee record was created.");
                await refresh();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Complete & create employee
          </Button>
        </div>
      )}
      {link && (
        <code className="block break-all p-3 rounded bg-[var(--muted)] text-xs">
          {link}
        </code>
      )}
      <Table
        headers={["Task", "By", "Required", "Status", ""]}
        empty=""
        rows={o.tasks.map((t) => [
          t.title,
          label(t.assignee),
          t.required ? "Yes" : "No",
          <div key="s">
            <span
              className={`badge ${t.status === "DONE" ? "positive" : t.status === "SUBMITTED" ? "amber" : ""}`}
            >
              {label(t.status)}
            </span>
            {t.notes && <p className="muted text-xs mt-1">{t.notes}</p>}
          </div>,
          active ? (
            <div key="a" className="flex gap-2 flex-wrap items-center">
              {t.category === "DOCUMENT" && t.assignee !== "EMPLOYEE" && (
                <input
                  type="file"
                  className="max-w-[180px] text-xs"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await api(`onboarding/${id}/tasks/${t.id}`, {
                        method: "POST",
                        body: JSON.stringify({ file: await fileOf(f) }),
                      });
                      await refresh();
                    } catch (err) {
                      notify((err as Error).message);
                    }
                  }}
                />
              )}
              {t.status !== "DONE" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTask(t, "DONE")}
                >
                  {t.status === "SUBMITTED" ? "Verify" : "Mark done"}
                </Button>
              )}
              {!t.required && t.status === "PENDING" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTask(t, "WAIVED")}
                >
                  Waive
                </Button>
              )}
            </div>
          ) : null,
        ])}
      />
      <p className="muted text-xs">
        Uploaded joiner documents move to the employee's Documents when
        onboarding is completed.
      </p>
    </div>
  );
}

// Public portal for the joiner, opened from the private link.
export function OnboardingPortal({ token }: { token: string }) {
  const data = useQuery({
    queryKey: ["portal", token],
    queryFn: () =>
      api<{
        company: string;
        name: string;
        joiningDate: string;
        tasks: Task[];
      }>(`public/onboarding/${token}`),
    retry: false,
  });
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const d = data.data;
  if (data.error)
    return <div className="card p-6 m-6 error">{data.error.message}</div>;
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <p className="eyebrow">{d.company}</p>
        <h1 className="text-2xl font-bold mt-2">Welcome, {d.name}</h1>
        <p className="muted mt-2">
          Please complete these steps before you join on{" "}
          {d.joiningDate.slice(0, 10)}. Files: PDF, JPEG or PNG up to 5 MB.
        </p>
      </div>
      {message && <div className="card p-3 text-sm">{message}</div>}
      <section className="card divide-y divide-[var(--border)]">
        {d.tasks.map((t) => (
          <div
            key={t.id}
            className="p-4 flex flex-wrap gap-3 items-center justify-between"
          >
            <div>
              <div className="font-semibold">
                {t.title}{" "}
                {!t.required && (
                  <span className="muted text-xs">(optional)</span>
                )}
              </div>
              <span className="muted text-xs">
                {t.status === "DONE"
                  ? "Verified"
                  : t.status === "SUBMITTED"
                    ? "Submitted, awaiting HR"
                    : "To do"}
              </span>
            </div>
            {t.status !== "DONE" &&
              (t.category === "POLICY" ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api(`public/onboarding/${token}/tasks/${t.id}`, {
                      method: "POST",
                      body: JSON.stringify({ accept: true }),
                    });
                    setMessage("Policies accepted.");
                    await client.invalidateQueries({
                      queryKey: ["portal", token],
                    });
                  }}
                >
                  I have read and accept
                </Button>
              ) : (
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="max-w-xs text-sm"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await api(`public/onboarding/${token}/tasks/${t.id}`, {
                        method: "POST",
                        body: JSON.stringify({ file: await fileOf(f) }),
                      });
                      setMessage(`${t.title} uploaded.`);
                      await client.invalidateQueries({
                        queryKey: ["portal", token],
                      });
                    } catch (err) {
                      setMessage((err as Error).message);
                    }
                  }}
                />
              ))}
          </div>
        ))}
      </section>
    </main>
  );
}
