"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Table, type Notify } from "./platform";

type Override = { subject: string; body: string; active: boolean } | null;
type Template = {
  event: string;
  defaults: { subject: string; body: string; email: boolean };
  inApp: Override;
  email: Override;
  sms: Override;
  whatsapp: Override;
};
const channels = [
  ["IN_APP", "inApp", "In-app"],
  ["EMAIL", "email", "Email"],
  ["SMS", "sms", "SMS"],
  ["WHATSAPP", "whatsapp", "WhatsApp"],
] as const;

// Company wording per event and channel. SMS and WhatsApp are sent only for
// events with an active template here, and only when the provider is
// configured for the deployment.
export function NotificationTemplates({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["notification-templates"],
    queryFn: () => api<Template[]>("notifications/templates"),
  });
  const [edit, setEdit] = useState<{
    t: Template;
    channel: (typeof channels)[number];
  } | null>(null);
  return (
    <section className="card max-w-4xl mt-6">
      <div className="card-title">
        <h2>Notification templates</h2>
      </div>
      <Table
        headers={["Event", ...channels.map((c) => c[2])]}
        loading={list.isLoading}
        error={list.error}
        empty="No events."
        rows={(list.data ?? []).map((t) => [
          t.event,
          ...channels.map((c) => {
            const o = t[c[1]];
            return (
              <Button
                key={c[0]}
                size="sm"
                variant="outline"
                onClick={() => setEdit({ t, channel: c })}
              >
                {o
                  ? o.active
                    ? "Custom"
                    : "Off"
                  : c[0] === "IN_APP" || (c[0] === "EMAIL" && t.defaults.email)
                    ? "Default"
                    : "Add"}
              </Button>
            );
          }),
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit ? `${edit.t.event} · ${edit.channel[2]}` : ""}
        description="Placeholders such as {{name}} and {{company}} are filled in when sent."
      >
        {edit && (
          <RecordForm
            initial={{
              subject:
                edit.t[edit.channel[1]]?.subject ?? edit.t.defaults.subject,
              body: edit.t[edit.channel[1]]?.body ?? edit.t.defaults.body,
              active: String(edit.t[edit.channel[1]]?.active ?? true),
            }}
            fields={[
              { key: "subject", label: "Subject or title", required: true },
              {
                key: "body",
                label: "Message",
                type: "textarea",
                required: true,
              },
              {
                key: "active",
                label: "Send on this channel",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api("notifications/templates", {
                method: "PUT",
                body: JSON.stringify({
                  event: edit.t.event,
                  channel: edit.channel[0],
                  subject: v.subject,
                  body: v.body,
                  active: v.active === "true",
                }),
              });
              setEdit(null);
              notify("Template saved.");
              await client.invalidateQueries({
                queryKey: ["notification-templates"],
              });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
