"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Pages, Table, when, type Notify } from "./platform";
import { isEmploymentLetter } from "@/modules/documents/categories";

type Doc = {
  id: string;
  title: string;
  category: string;
  visibility: string;
  status: string;
  expiresOn: string | null;
  currentVersion: number;
  requiresAcknowledgement: boolean;
  acknowledgedByMe: boolean;
  acknowledgements: number;
  reviewNote: string | null;
  updatedAt: string;
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
  } | null;
  versions: {
    version: number;
    fileName: string;
    size: number;
    createdAt: string;
  }[];
};
export const documentCategories = [
  "CONTRACT",
  "OFFER_LETTER",
  "APPOINTMENT_LETTER",
  "INCREMENT_LETTER",
  "PROMOTION_LETTER",
  "POLICY",
  "ID_PROOF",
  "ADDRESS_PROOF",
  "PAN",
  "BANK",
  "PHOTO",
  "EDUCATION",
  "EXPERIENCE",
  "SALARY",
  "COMPLIANCE",
  "OTHER",
];
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const tone = (s: string) =>
  s === "APPROVED" ? "positive" : s === "PENDING_APPROVAL" ? "amber" : "";
async function open(doc: Doc, version?: number, inline = false) {
  const r = await api<{ url: string }>(
    `documents/${doc.id}/download?${new URLSearchParams({ ...(version ? { version: String(version) } : {}), ...(inline ? { inline: "1" } : {}) })}`,
  );
  window.open(r.url, "_blank", "noopener");
}

export function DocumentsPage({ me, notify }: { me: Me; notify: Notify }) {
  const manage = me.permissions.includes("documents.manage");
  const tabs = [
    ["own", "My documents"],
    ["letters", "My employment letters"],
    ["policies", "Company policies"],
    ...(manage
      ? [
          ["company", "All documents"],
          ["hr-letters", "Employee letters (HR)"],
          ["review", "Awaiting review"],
          ["expiring", "Expiring in 30 days"],
        ]
      : []),
  ];
  const [tab, setTab] = useState("own");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const query =
    tab === "letters"
      ? "scope=own&letters=1"
      : tab === "hr-letters"
        ? "scope=company&letters=1"
        : tab === "review"
          ? "scope=company&status=PENDING_APPROVAL"
          : tab === "expiring"
            ? "scope=company&expiringDays=30"
            : `scope=${tab}`;
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["documents", query, search, page],
    queryFn: () =>
      api<{ items: Doc[]; total: number; pageSize: number }>(
        `documents?${query}&${new URLSearchParams({ page: String(page), pageSize: "20", search })}`,
      ),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["documents"] });
  const [detail, setDetail] = useState<Doc | null>(null);
  return (
    <>
      <Heading
        eyebrow="Core HR"
        title="Documents"
        text="Contracts, letters, identity and compliance documents, and company policies. Files are stored privately and downloaded through short-lived links."
        action={
          <Button onClick={() => setUploading(true)}>
            <Plus />
            Upload
          </Button>
        }
      />
      <div className="section-tabs">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <section className="card">
        <div className="toolbar">
          <label>
            Search
            <input
              value={search}
              maxLength={150}
              placeholder="Title, employee name or code"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <Table
          headers={[
            "Document",
            "Employee",
            "Category",
            "Status",
            "Expires",
            "Version",
            "",
          ]}
          loading={list.isLoading}
          error={list.error}
          empty="No documents."
          rows={(list.data?.items ?? []).map((d) => [
            <button
              key="t"
              className="text-left text-blue-700 underline"
              onClick={() => setDetail(d)}
            >
              {d.title}
            </button>,
            d.employee
              ? `${d.employee.employeeCode} · ${d.employee.firstName} ${d.employee.lastName}`
              : label(d.visibility),
            label(d.category),
            <div key="s">
              <span className={`badge ${tone(d.status)}`}>
                {label(d.status)}
              </span>
              {d.reviewNote && (
                <p className="muted text-xs mt-1">{d.reviewNote}</p>
              )}
            </div>,
            d.expiresOn?.slice(0, 10) ?? "—",
            `v${d.currentVersion}`,
            <div key="a" className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  open(d, undefined, true).catch((e) => notify(e.message))
                }
              >
                Preview
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => open(d).catch((e) => notify(e.message))}
              >
                Download
              </Button>
              {d.requiresAcknowledgement && !d.acknowledgedByMe && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api(`documents/${d.id}/acknowledge`, {
                      method: "POST",
                    });
                    notify("Acknowledged.");
                    await refresh();
                  }}
                >
                  Acknowledge
                </Button>
              )}
              {manage && d.status === "PENDING_APPROVAL" && (
                <>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api(`documents/${d.id}/review`, {
                        method: "POST",
                        body: JSON.stringify({ action: "approve" }),
                      });
                      await refresh();
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const note = window.prompt("Reason for rejecting");
                      if (!note) return;
                      await api(`documents/${d.id}/review`, {
                        method: "POST",
                        body: JSON.stringify({ action: "reject", note }),
                      });
                      await refresh();
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
            </div>,
          ])}
        />
        <Pages data={list.data} page={page} setPage={setPage} />
      </section>
      <Dialog
        open={uploading}
        onOpenChange={setUploading}
        title="Upload document"
        description="PDF, image, Word, Excel or text up to 5 MB. Your uploads are reviewed by HR."
      >
        {uploading && (
          <Upload
            manage={manage}
            onDone={async () => {
              setUploading(false);
              notify("Document uploaded.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        title={detail?.title ?? ""}
        description={
          detail
            ? `${label(detail.category)} · ${detail.requiresAcknowledgement ? `${detail.acknowledgements} acknowledgement(s)` : "no acknowledgement required"}`
            : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <Table
              headers={["Version", "File", "Size", "Uploaded", ""]}
              empty=""
              rows={detail.versions.map((v) => [
                `v${v.version}`,
                v.fileName,
                `${Math.ceil(v.size / 1024)} KB`,
                when(v.createdAt),
                <Button
                  key="d"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    open(detail, v.version).catch((e) => notify(e.message))
                  }
                >
                  Download
                </Button>,
              ])}
            />
            {(manage || !isEmploymentLetter(detail.category)) && (
              <NewVersion
                id={detail.id}
                onDone={async () => {
                  setDetail(null);
                  notify("New version uploaded.");
                  await refresh();
                }}
              />
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
function NewVersion({
  id,
  onDone,
}: {
  id: string;
  onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState("");
  return (
    <div className="flex gap-3 items-center flex-wrap">
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="max-w-xs"
      />
      <Button
        size="sm"
        disabled={!file}
        onClick={async () => {
          try {
            await api(`documents/${id}/versions`, {
              method: "POST",
              body: JSON.stringify({ file: await readAttachment5(file) }),
            });
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Upload new version
      </Button>
      {error && <div className="error w-full">{error}</div>}
    </div>
  );
}
// Documents allow up to 5 MB, more than general attachments.
async function readAttachment5(file: File | null) {
  if (!file) return undefined;
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Documents must be 5 MB or smaller.");
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
function Upload({
  manage,
  onDone,
}: {
  manage: boolean;
  onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <RecordForm
      initial={{
        category: "OTHER",
        visibility: manage ? "ALL_EMPLOYEES" : "EMPLOYEE",
        requiresAcknowledgement: "false",
      }}
      fields={[
        { key: "title", label: "Title", required: true },
        {
          key: "category",
          label: "Category",
          type: "select",
          required: true,
          options: documentCategories
            .filter((c) => manage || !isEmploymentLetter(c))
            .map((c) => ({
              value: c,
              label: label(c),
            })),
        },
        ...(manage
          ? [
              {
                key: "employeeId",
                label: "Employee (required for employment letters)",
                reference: "employees" as const,
              },
              {
                key: "visibility",
                label: "Visible to",
                type: "select" as const,
                required: true,
                options: [
                  { value: "EMPLOYEE", label: "The employee" },
                  { value: "ALL_EMPLOYEES", label: "All employees" },
                  { value: "HR_ONLY", label: "HR only" },
                ],
              },
              {
                key: "requiresAcknowledgement",
                label: "Employees must acknowledge",
                type: "select" as const,
                required: true,
                options: [
                  { value: "false", label: "No" },
                  { value: "true", label: "Yes" },
                ],
              },
            ]
          : []),
        { key: "expiresOn", label: "Expires on (optional)", type: "date" },
      ]}
      submitLabel="Upload"
      onSave={async (v) => {
        if (!file) throw new Error("Choose a file.");
        if (isEmploymentLetter(v.category) && !v.employeeId)
          throw new Error("Select the employee who will receive this letter.");
        await api("documents", {
          method: "POST",
          body: JSON.stringify({
            title: v.title,
            category: v.category,
            visibility: isEmploymentLetter(v.category)
              ? "EMPLOYEE"
              : v.visibility || "EMPLOYEE",
            employeeId: v.employeeId || null,
            expiresOn: v.expiresOn || null,
            requiresAcknowledgement: v.requiresAcknowledgement === "true",
            file: await readAttachment5(file),
          }),
        });
        await onDone();
      }}
    >
      {manage && (
        <p className="muted text-sm mt-4">
          Appointment, increment and promotion letters are always private to
          the selected employee and HR.
        </p>
      )}
      <label className="block mt-5">
        File *
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </RecordForm>
  );
}
