"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Table, type Notify } from "./platform";

type Offer = {
  id: string;
  annualCtc: number;
  joiningDate: string;
  expiresOn: string;
  status: string;
  expired: boolean;
  sentAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
};
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);

// Offers for one candidate: prepare, send, withdraw, download the letter.
export function OfferPanel({
  candidateId,
  active,
  notify,
}: {
  candidateId: string;
  active: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const offers = useQuery({
    queryKey: ["recruitment", "offers", candidateId],
    queryFn: () => api<Offer[]>(`recruitment/candidates/${candidateId}/offers`),
  });
  const [mode, setMode] = useState<"new" | { withdraw: string } | null>(null),
    [link, setLink] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["recruitment"] });
  const current = (offers.data ?? []).find((o) =>
    ["DRAFT", "SENT", "ACCEPTED"].includes(o.status),
  );
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="subheading">Offers</p>
        {active && !current && (
          <Button size="sm" variant="outline" onClick={() => setMode("new")}>
            Make offer
          </Button>
        )}
      </div>
      {link && (
        <div className="card p-3 text-xs mb-2 break-all">
          Private link for the candidate: {link}
        </div>
      )}
      {mode === "new" && (
        <RecordForm
          initial={{ joiningDate: in30, expiresOn: in7 }}
          fields={[
            {
              key: "annualCtc",
              label: "Annual CTC (₹)",
              type: "number",
              required: true,
            },
            {
              key: "joiningDate",
              label: "Joining date",
              type: "date",
              required: true,
            },
            {
              key: "expiresOn",
              label: "Respond by",
              type: "date",
              required: true,
            },
            {
              key: "designationId",
              label: "Designation",
              type: "select",
              reference: "designations",
            },
            {
              key: "departmentId",
              label: "Department",
              type: "select",
              reference: "departments",
            },
            { key: "terms", label: "Terms", type: "textarea" },
          ]}
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`recruitment/candidates/${candidateId}/offers`, {
              method: "POST",
              body: JSON.stringify({
                annualCtc: Number(v.annualCtc),
                joiningDate: v.joiningDate,
                expiresOn: v.expiresOn,
                designationId: v.designationId || null,
                departmentId: v.departmentId || null,
                terms: v.terms || null,
              }),
            });
            setMode(null);
            notify("Offer prepared. Review the letter, then send it.");
            await refresh();
          }}
        />
      )}
      {mode && typeof mode === "object" && (
        <RecordForm
          fields={[
            { key: "note", label: "Reason", type: "textarea", required: true },
          ]}
          submitLabel="Withdraw offer"
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`recruitment/offers/${mode.withdraw}/withdraw`, {
              method: "POST",
              body: JSON.stringify({ note: v.note }),
            });
            setMode(null);
            await refresh();
          }}
        />
      )}
      <Table
        headers={["CTC", "Joining", "Respond by", "Status", ""]}
        loading={offers.isLoading}
        error={offers.error}
        empty="No offers yet."
        rows={(offers.data ?? []).map((o) => [
          inr(o.annualCtc),
          o.joiningDate.slice(0, 10),
          o.expiresOn.slice(0, 10),
          <span
            key="s"
            className={`badge ${o.status === "ACCEPTED" ? "positive" : "amber"}`}
          >
            {o.expired ? "expired" : o.status.toLowerCase()}
            {o.responseNote ? ` — ${o.responseNote}` : ""}
          </span>,
          <div key="a" className="flex gap-2 flex-wrap">
            <a
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold"
              href={`/api/recruitment/offers/${o.id}/letter`}
            >
              <Download size={14} /> Letter
            </a>
            {["DRAFT", "SENT"].includes(o.status) && !o.expired && (
              <Button
                size="sm"
                onClick={async () => {
                  const r = await api<{ link: string; emailed: boolean }>(
                    `recruitment/offers/${o.id}/send`,
                    { method: "POST" },
                  );
                  setLink(r.link);
                  notify(
                    r.emailed
                      ? "Offer emailed to the candidate."
                      : "Email is not configured; share the private link.",
                  );
                  await refresh();
                }}
              >
                {o.status === "SENT" ? "Resend" : "Send"}
              </Button>
            )}
            {["DRAFT", "SENT", "ACCEPTED"].includes(o.status) && active && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode({ withdraw: o.id })}
              >
                Withdraw
              </Button>
            )}
          </div>,
        ])}
      />
    </div>
  );
}

// Company setting for the public careers page.
export function CareersSettings({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["recruitment", "careers"],
    queryFn: () =>
      api<{ enabled: boolean; intro: string | null; url: string }>(
        "recruitment/careers",
      ),
  });
  const d = data.data;
  if (!d)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  return (
    <section className="card p-6 space-y-4">
      <p className="text-sm">
        Open job openings appear on your public careers page. Applicants upload
        a PDF resume and agree to data processing; they land in the pipeline as
        “applied” with source “Careers page”.
      </p>
      {d.enabled && (
        <p className="text-sm">
          Page address:{" "}
          <a className="text-blue-700 underline break-all" href={d.url}>
            {d.url}
          </a>
        </p>
      )}
      <RecordForm
        initial={{ enabled: String(d.enabled), intro: d.intro }}
        fields={[
          {
            key: "enabled",
            label: "Publish the careers page",
            type: "select",
            required: true,
            options: [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ],
          },
          { key: "intro", label: "Introduction", type: "textarea" },
        ]}
        onSave={async (v) => {
          await api("recruitment/careers", {
            method: "PUT",
            body: JSON.stringify({
              enabled: v.enabled === "true",
              intro: v.intro || null,
            }),
          });
          notify("Careers page saved.");
          await client.invalidateQueries({
            queryKey: ["recruitment", "careers"],
          });
        }}
      />
    </section>
  );
}
