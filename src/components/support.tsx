"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Heading, Table, when, type Notify } from "./platform";

export type Ticket = {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  createdByName: string;
  lastMessageAt: string;
  createdAt: string;
  company?: { name: string; code: string };
};
type Message = {
  id: string;
  authorName: string;
  fromSupport: boolean;
  internal: boolean;
  body: string;
  attachmentName: string | null;
  attachmentSize: number | null;
  createdAt: string;
};
export type Thread = Ticket & { messages: Message[] };
export const categories = [
  "TECHNICAL",
  "BILLING",
  "ACCOUNT",
  "FEATURE_REQUEST",
  "OTHER",
];
export const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const label = (v: string) => v.replaceAll("_", " ").toLowerCase();
export const statusBadge = (s: string) => (
  <span
    className={`badge ${["RESOLVED", "CLOSED"].includes(s) ? "positive" : s === "WAITING_ON_CUSTOMER" ? "amber" : ""}`}
  >
    {label(s)}
  </span>
);
export async function readAttachment(file: File | null | undefined) {
  if (!file) return undefined;
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Attachments must be 2 MB or smaller.");
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
export function Conversation({
  thread,
  support = false,
}: {
  thread: Thread;
  support?: boolean;
}) {
  return (
    <div className="space-y-3 max-h-96 overflow-auto">
      {thread.messages.map((m) => (
        <div
          key={m.id}
          className={`rounded-lg border p-3 ${m.internal ? "border-amber-400" : m.fromSupport ? "bg-[var(--muted)] border-[var(--border)]" : "border-[var(--border)]"}`}
        >
          <p className="text-xs muted">
            {m.authorName} · {when(m.createdAt)}
            {m.internal && " · internal note"}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {m.body}
          </p>
          {m.attachmentName && (
            <a
              className="text-blue-700 underline text-xs mt-2 inline-flex gap-1 items-center"
              href={`/api/support/attachments/${m.id}`}
            >
              <Paperclip size={12} />
              {m.attachmentName} ({Math.ceil((m.attachmentSize ?? 0) / 1024)}{" "}
              KB)
            </a>
          )}
        </div>
      ))}
      {!support && null}
    </div>
  );
}
export function Reply({
  onSend,
  internalOption = false,
}: {
  onSend: (body: string, file: File | null, internal: boolean) => Promise<void>;
  internalOption?: boolean;
}) {
  const [body, setBody] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [internal, setInternal] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="space-y-3 mt-4">
      <textarea
        rows={3}
        maxLength={5000}
        value={body}
        placeholder="Write a reply"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex gap-3 flex-wrap items-center">
        <input
          key={busy ? "busy" : "idle"}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.log"
          className="max-w-xs"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {internalOption && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-auto"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Internal note (not visible to the company)
          </label>
        )}
        <Button
          disabled={busy || !body.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSend(body, file, internal);
              setBody("");
              setFile(null);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function SupportPage({ notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const tickets = useQuery({
    queryKey: ["support"],
    queryFn: () => api<Ticket[]>("support/tickets"),
  });
  const [creating, setCreating] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const thread = useQuery({
    queryKey: ["support", open],
    queryFn: () => api<Thread>(`support/tickets/${open}`),
    enabled: !!open,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["support"] });
  return (
    <>
      <Heading
        eyebrow="Help"
        title="Support"
        text="Contact the service provider about technical issues, billing or plan changes."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New ticket
          </Button>
        }
      />
      <section className="card">
        <Table
          headers={[
            "#",
            "Subject",
            "Category",
            "Priority",
            "Status",
            "Updated",
          ]}
          loading={tickets.isLoading}
          error={tickets.error}
          empty="No support tickets yet."
          rows={(tickets.data ?? []).map((t) => [
            t.number,
            <button
              key="s"
              className="text-blue-700 underline text-left"
              onClick={() => setOpen(t.id)}
            >
              {t.subject}
            </button>,
            label(t.category),
            label(t.priority),
            statusBadge(t.status),
            when(t.lastMessageAt),
          ])}
        />
      </section>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New support ticket"
        description="For plan changes or renewals, choose Billing. Attach a PDF, PNG, JPEG or text file up to 2 MB."
      >
        {creating && (
          <NewTicket
            onCreated={async () => {
              setCreating(false);
              notify("Ticket created.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={
          thread.data
            ? `#${thread.data.number} · ${thread.data.subject}`
            : "Ticket"
        }
        description={
          thread.data
            ? `${label(thread.data.category)} · ${label(thread.data.priority)} · ${label(thread.data.status)}`
            : undefined
        }
      >
        {thread.data && (
          <>
            <Conversation thread={thread.data} />
            {thread.data.status !== "CLOSED" ? (
              <>
                <Reply
                  onSend={async (body, file) => {
                    await api(`support/tickets/${open}/messages`, {
                      method: "POST",
                      body: JSON.stringify({
                        body,
                        attachment: await readAttachment(file),
                      }),
                    });
                    await refresh();
                  }}
                />
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={async () => {
                    await api(`support/tickets/${open}`, {
                      method: "PUT",
                      body: JSON.stringify({ status: "CLOSED" }),
                    });
                    await refresh();
                  }}
                >
                  Close ticket
                </Button>
              </>
            ) : (
              <p className="muted mt-4">This ticket is closed.</p>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
function NewTicket({ onCreated }: { onCreated: () => Promise<void> }) {
  const [subject, setSubject] = useState(""),
    [category, setCategory] = useState("TECHNICAL"),
    [priority, setPriority] = useState("MEDIUM"),
    [body, setBody] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="space-y-4">
      <label>
        Subject *
        <input
          value={subject}
          maxLength={150}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {priorities.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description *
        <textarea
          rows={5}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label>
        Attachment
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.log"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <div className="error">{error}</div>}
      <Button
        disabled={busy || subject.trim().length < 3 || !body.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("support/tickets", {
              method: "POST",
              body: JSON.stringify({
                subject,
                category,
                priority,
                body,
                attachment: await readAttachment(file),
              }),
            });
            await onCreated();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating…" : "Create ticket"}
      </Button>
    </div>
  );
}
