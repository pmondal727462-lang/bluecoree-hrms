"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Pages, Table, when, type Notify } from "./platform";
import { readAttachment } from "./support";

type Ticket = {
  id: string;
  number: number;
  category: string;
  subject: string;
  priority: string;
  status: string;
  assigneeName: string | null;
  lastMessageAt: string;
  employee: { employeeCode: string; firstName: string; lastName: string };
};
type Detail = Ticket & {
  messages: {
    id: string;
    authorName: string;
    fromAgent: boolean;
    internal: boolean;
    body: string;
    fileName: string | null;
    createdAt: string;
  }[];
};
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const categories = [
  "ATTENDANCE",
  "PAYROLL",
  "LEAVE",
  "DOCUMENT",
  "HR",
  "IT",
  "OTHER",
];

export function HelpdeskPage({ me, notify }: { me: Me; notify: Notify }) {
  const agent = me.permissions.includes("helpdesk.manage");
  const [scope, setScope] = useState(agent ? "all" : "own"),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["helpdesk", scope, status, search, page],
    queryFn: () =>
      api<{ items: Ticket[]; total: number; pageSize: number }>(
        `helpdesk?${new URLSearchParams({ scope, ...(status ? { status } : {}), search, page: String(page), pageSize: "20" })}`,
      ),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["helpdesk"] });
  return (
    <>
      <Heading
        eyebrow="HR helpdesk"
        title="HR requests"
        text="Raise attendance, payroll, leave, document, HR or IT requests with your company's HR team."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New request
          </Button>
        }
      />
      <section className="card">
        <div className="toolbar">
          {agent && (
            <label>
              Show
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All requests</option>
                <option value="own">My requests</option>
              </select>
            </label>
          )}
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
              {["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"].map(
                (s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Search
            <input
              value={search}
              maxLength={150}
              placeholder="Subject, employee name or code"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <Table
          headers={[
            "#",
            "Subject",
            "Employee",
            "Category",
            "Priority",
            "Status",
            "Assigned",
            "Updated",
          ]}
          loading={list.isLoading}
          error={list.error}
          empty="No requests."
          rows={(list.data?.items ?? []).map((t) => [
            t.number,
            <button
              key="s"
              className="text-left text-blue-700 underline"
              onClick={() => setOpen(t.id)}
            >
              {t.subject}
            </button>,
            `${t.employee.firstName} ${t.employee.lastName}`,
            label(t.category),
            label(t.priority),
            <span
              key="st"
              className={`badge ${["RESOLVED", "CLOSED"].includes(t.status) ? "positive" : "amber"}`}
            >
              {label(t.status)}
            </span>,
            t.assigneeName ?? "—",
            when(t.lastMessageAt),
          ])}
        />
        <Pages data={list.data} page={page} setPage={setPage} />
      </section>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New HR request"
        description="Attach a PDF, image or text file up to 2 MB if it helps."
      >
        {creating && (
          <NewTicket
            onDone={async () => {
              setCreating(false);
              notify("Request submitted.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Request"
      >
        {open && <TicketDetail id={open} agent={agent} notify={notify} />}
      </Dialog>
    </>
  );
}
function NewTicket({ onDone }: { onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <RecordForm
      initial={{ category: "HR", priority: "MEDIUM" }}
      fields={[
        {
          key: "category",
          label: "Category",
          type: "select",
          required: true,
          options: categories.map((c) => ({ value: c, label: label(c) })),
        },
        {
          key: "priority",
          label: "Priority",
          type: "select",
          required: true,
          options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({
            value: p,
            label: label(p),
          })),
        },
        { key: "subject", label: "Subject", required: true },
        {
          key: "body",
          label: "Describe the request",
          type: "textarea",
          required: true,
          maxLength: 5000,
        },
      ]}
      submitLabel="Submit"
      onSave={async (v) => {
        await api("helpdesk", {
          method: "POST",
          body: JSON.stringify({
            ...v,
            attachment: await readAttachment(file),
          }),
        });
        await onDone();
      }}
    >
      <label className="block mt-5">
        Attachment
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </RecordForm>
  );
}
function TicketDetail({
  id,
  agent,
  notify,
}: {
  id: string;
  agent: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const t = useQuery({
    queryKey: ["helpdesk", "ticket", id],
    queryFn: () => api<Detail>(`helpdesk/${id}`),
  });
  const agents = useQuery({
    queryKey: ["helpdesk", "agents"],
    queryFn: () => api<{ id: string; name: string }[]>("helpdesk/agents"),
    enabled: agent,
  });
  const [body, setBody] = useState(""),
    [internal, setInternal] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["helpdesk"] });
  const d = t.data;
  if (!d) return <div className="empty">{t.error?.message ?? "Loading…"}</div>;
  const update = async (patch: Record<string, unknown>) => {
    try {
      await api(`helpdesk/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: d.status, ...patch }),
      });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm">
        #{d.number} · {d.subject} · {label(d.category)} · {label(d.status)}
      </p>
      {agent && (
        <div className="form-grid">
          <label>
            Status
            <select
              value={d.status}
              onChange={(e) => update({ status: e.target.value })}
            >
              {["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"].map(
                (s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Assign to
            <select
              value=""
              onChange={(e) =>
                e.target.value && update({ assigneeUserId: e.target.value })
              }
            >
              <option value="">{d.assigneeName ?? "Unassigned"}</option>
              {(agents.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="space-y-3 max-h-80 overflow-auto">
        {d.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg border p-3 ${m.internal ? "border-amber-400" : m.fromAgent ? "bg-[var(--muted)] border-[var(--border)]" : "border-[var(--border)]"}`}
          >
            <p className="text-xs muted">
              {m.authorName} · {when(m.createdAt)}
              {m.internal && " · internal note"}
            </p>
            <p className="mt-2 text-sm whitespace-pre-wrap">{m.body}</p>
            {m.fileName && (
              <button
                className="text-blue-700 underline text-xs mt-2 inline-flex gap-1 items-center"
                onClick={async () => {
                  const r = await api<{ url: string }>(
                    `helpdesk/${id}/attachments/${m.id}`,
                  );
                  window.open(r.url, "_blank", "noopener");
                }}
              >
                <Paperclip size={12} />
                {m.fileName}
              </button>
            )}
          </div>
        ))}
      </div>
      {d.status !== "CLOSED" && (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply"
          />
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="max-w-xs"
            />
            {agent && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                />
                Internal note
              </label>
            )}
            <Button
              disabled={!body.trim()}
              onClick={async () => {
                try {
                  await api(`helpdesk/${id}/messages`, {
                    method: "POST",
                    body: JSON.stringify({
                      body,
                      internal,
                      attachment: await readAttachment(file),
                    }),
                  });
                  setBody("");
                  setFile(null);
                  await refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Send
            </Button>
            {!agent && d.status !== "CLOSED" && (
              <Button
                variant="outline"
                onClick={() => update({ status: "CLOSED" })}
              >
                Close request
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
