"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Table, when, type Notify } from "./platform";
import { CareersSettings, OfferPanel } from "./recruitment-extras";
import { readAttachment } from "./support";

type Job = {
  id: string;
  title: string;
  location: string | null;
  employmentType: string;
  openings: number;
  description: string;
  status: string;
  closesOn: string | null;
  candidateCount?: number;
};
type Candidate = {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string | null;
  source: string | null;
  currentCompany: string | null;
  experienceYears: number | null;
  expectedSalary: number | null;
  stage: string;
  rating: number | null;
  notes: string | null;
  resumeName: string | null;
  job: { title: string };
};
type Interview = {
  id: string;
  interviewerName: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: string;
  status: string;
  rating: number | null;
  recommendation: string | null;
  feedback: string | null;
  candidate?: { id: string; name: string; job: { title: string } };
};
type Detail = Candidate & {
  events: {
    id: string;
    fromStage: string | null;
    toStage: string;
    note: string | null;
    actorName: string;
    createdAt: string;
  }[];
  interviews: Interview[];
};
const stages = [
  "APPLIED",
  "SCREENING",
  "SHORTLISTED",
  "INTERVIEW",
  "SELECTED",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
];
const label = (s: string) =>
  s === "HIRED" ? "joined" : s.replaceAll("_", " ").toLowerCase();

export function RecruitmentPage({ me, notify }: { me: Me; notify: Notify }) {
  const manage = me.permissions.includes("recruitment.manage");
  const [tab, setTab] = useState(manage ? "pipeline" : "interviews");
  return (
    <>
      <Heading
        eyebrow="Recruitment"
        title="Hiring"
        text="Job openings, candidates, interviews and hiring. Hiring decisions are always made by people; AI only drafts job descriptions and questions."
      />
      <div className="section-tabs">
        {[
          ...(manage
            ? [
                ["pipeline", "Pipeline"],
                ["jobs", "Job openings"],
                ["careers", "Careers page"],
              ]
            : []),
          ["interviews", "My interviews"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "jobs" ? (
        <Jobs notify={notify} />
      ) : tab === "pipeline" ? (
        <Pipeline notify={notify} />
      ) : tab === "careers" ? (
        <CareersSettings notify={notify} />
      ) : (
        <MyInterviews notify={notify} />
      )}
    </>
  );
}

function Jobs({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const jobs = useQuery({
    queryKey: ["recruitment", "jobs"],
    queryFn: () => api<Job[]>("recruitment/jobs"),
  });
  const aiDocs = useQuery({
    queryKey: ["recruitment", "ai-docs"],
    queryFn: () =>
      api<{ id: string; title: string; kind: string; status: string }[]>(
        "ai/documents",
      ).catch(() => []),
  });
  const [edit, setEdit] = useState<Job | "new" | null>(null);
  const approvedJds = (aiDocs.data ?? []).filter(
    (d) =>
      d.kind === "job_description" &&
      ["Approved", "Published"].includes(d.status),
  );
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Job openings</h2>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          New opening
        </Button>
      </div>
      <Table
        headers={[
          "Title",
          "Location",
          "Type",
          "Openings",
          "Candidates",
          "Status",
          "Closes",
          "",
        ]}
        loading={jobs.isLoading}
        error={jobs.error}
        empty="No job openings yet."
        rows={(jobs.data ?? []).map((j) => [
          j.title,
          j.location ?? "—",
          j.employmentType,
          j.openings,
          j.candidateCount ?? 0,
          <span
            key="s"
            className={`badge ${j.status === "OPEN" ? "positive" : ""}`}
          >
            {label(j.status)}
          </span>,
          j.closesOn?.slice(0, 10) ?? "—",
          <Button
            key="e"
            size="sm"
            variant="outline"
            onClick={() => setEdit(j)}
          >
            Edit
          </Button>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "New job opening" : "Edit job opening"}
        description="Write a description or copy an approved AI job description."
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { employmentType: "Full time", openings: 1, status: "DRAFT" }
                : { ...edit, closesOn: edit.closesOn?.slice(0, 10) }
            }
            fields={[
              { key: "title", label: "Job title", required: true },
              { key: "location", label: "Location" },
              {
                key: "employmentType",
                label: "Employment type",
                type: "select",
                required: true,
                options: ["Full time", "Part time", "Contract", "Intern"].map(
                  (v) => ({ value: v, label: v }),
                ),
              },
              {
                key: "openings",
                label: "Openings",
                type: "number",
                required: true,
              },
              {
                key: "status",
                label: "Status",
                type: "select",
                required: true,
                options: ["DRAFT", "OPEN", "ON_HOLD", "CLOSED"].map((v) => ({
                  value: v,
                  label: label(v),
                })),
              },
              { key: "closesOn", label: "Closes on", type: "date" },
              {
                key: "aiDocumentId",
                label: "Use approved AI job description",
                type: "select",
                options: approvedJds.map((d) => ({
                  value: d.id,
                  label: d.title,
                })),
              },
              {
                key: "description",
                label: "Description",
                type: "textarea",
                maxLength: 20000,
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(
                `recruitment/jobs${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    title: v.title,
                    location: v.location || null,
                    employmentType: v.employmentType,
                    openings: Number(v.openings),
                    status: v.status,
                    closesOn: v.closesOn || null,
                    description: v.description ?? "",
                    ...(v.aiDocumentId ? { aiDocumentId: v.aiDocumentId } : {}),
                  }),
                },
              );
              setEdit(null);
              notify("Job opening saved.");
              await client.invalidateQueries({ queryKey: ["recruitment"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Pipeline({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState(""),
    [adding, setAdding] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ["recruitment", "jobs"],
    queryFn: () => api<Job[]>("recruitment/jobs"),
  });
  const candidates = useQuery({
    queryKey: ["recruitment", "candidates", jobId],
    queryFn: () =>
      api<Candidate[]>(
        `recruitment/candidates${jobId ? `?jobId=${jobId}` : ""}`,
      ),
  });
  return (
    <>
      <div className="toolbar card mb-4">
        <label>
          Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">All jobs</option>
            {(jobs.data ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={!jobs.data?.some((j) => j.status !== "CLOSED")}
          onClick={() => setAdding(true)}
        >
          <Plus />
          Add candidate
        </Button>
      </div>
      {candidates.error && (
        <div className="error">{candidates.error.message}</div>
      )}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
      >
        {stages.map((s) => {
          const list = (candidates.data ?? []).filter((c) => c.stage === s);
          return (
            <div key={s} className="card p-3">
              <p className="eyebrow mb-3">
                {label(s)} · {list.length}
              </p>
              <div className="space-y-2">
                {list.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left rounded-lg border border-[var(--border)] p-2 text-sm hover:bg-[var(--muted)]"
                    onClick={() => setOpen(c.id)}
                  >
                    <div className="font-semibold">{c.name}</div>
                    <div className="muted text-xs">{c.job.title}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add candidate"
        description="Attach the resume as a PDF up to 2 MB."
      >
        {adding && (
          <AddCandidate
            jobs={(jobs.data ?? []).filter((j) => j.status !== "CLOSED")}
            onDone={async () => {
              setAdding(false);
              notify("Candidate added.");
              await client.invalidateQueries({ queryKey: ["recruitment"] });
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Candidate"
      >
        {open && <CandidateDetail id={open} notify={notify} />}
      </Dialog>
    </>
  );
}
function AddCandidate({
  jobs,
  onDone,
}: {
  jobs: Job[];
  onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <RecordForm
      fields={[
        {
          key: "jobId",
          label: "Job",
          type: "select",
          required: true,
          options: jobs.map((j) => ({ value: j.id, label: j.title })),
        },
        { key: "name", label: "Full name", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "phone", label: "Phone" },
        { key: "source", label: "Source (e.g. referral, job board)" },
        { key: "currentCompany", label: "Current company" },
        { key: "experienceYears", label: "Experience (years)", type: "number" },
        {
          key: "expectedSalary",
          label: "Expected salary (annual)",
          type: "number",
        },
        { key: "notes", label: "Notes", type: "textarea", maxLength: 2000 },
      ]}
      submitLabel="Add candidate"
      onSave={async (v) => {
        const opt = (k: string) => (v[k] ? { [k]: v[k] } : {});
        const num = (k: string) => (v[k] ? { [k]: Number(v[k]) } : {});
        await api("recruitment/candidates", {
          method: "POST",
          body: JSON.stringify({
            jobId: v.jobId,
            name: v.name,
            email: v.email,
            ...opt("phone"),
            ...opt("source"),
            ...opt("currentCompany"),
            ...opt("notes"),
            ...num("experienceYears"),
            ...num("expectedSalary"),
            resume: await readAttachment(file),
          }),
        });
        await onDone();
      }}
    >
      <label className="block mt-5">
        Resume (PDF)
        <input
          type="file"
          accept=".pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </RecordForm>
  );
}
function CandidateDetail({ id, notify }: { id: string; notify: Notify }) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["recruitment", "candidate", id],
    queryFn: () => api<Detail>(`recruitment/candidates/${id}`),
  });
  const interviewers = useQuery({
    queryKey: ["recruitment", "interviewers"],
    queryFn: () =>
      api<{ id: string; name: string }[]>("recruitment/interviewers"),
  });
  const [mode, setMode] = useState<"stage" | "interview" | "hire" | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["recruitment"] });
  const c = detail.data;
  if (!c)
    return <div className="empty">{detail.error?.message ?? "Loading…"}</div>;
  const active = !["HIRED", "REJECTED", "WITHDRAWN"].includes(c.stage);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">{c.name}</h3>
        <p className="muted text-sm">
          {c.job.title} · {label(c.stage)} · {c.email}
          {c.phone ? ` · ${c.phone}` : ""}
        </p>
        <p className="text-sm mt-2">
          {c.currentCompany && `${c.currentCompany} · `}
          {c.experienceYears !== null && `${c.experienceYears} years · `}
          {c.source && `Source: ${c.source}`}
        </p>
        {c.resumeName && (
          <a
            className="text-blue-700 underline text-sm"
            href={`/api/recruitment/candidates/${c.id}/resume`}
          >
            Download resume
          </a>
        )}
        {c.notes && (
          <p className="text-sm mt-2 whitespace-pre-wrap">{c.notes}</p>
        )}
      </div>
      {active && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setMode("stage")}>
            Move stage
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("interview")}
          >
            Schedule interview
          </Button>
          {c.stage === "OFFER" && (
            <a
              className="inline-flex items-center h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold"
              href="/onboarding"
            >
              Start onboarding
            </a>
          )}
          {c.stage === "OFFER" && (
            <Button size="sm" onClick={() => setMode("hire")}>
              Hire
            </Button>
          )}
        </div>
      )}
      {mode === "stage" && (
        <RecordForm
          fields={[
            {
              key: "stage",
              label: "New stage",
              type: "select",
              required: true,
              options: stages
                .filter((s) => s !== "HIRED" && s !== c.stage)
                .map((s) => ({ value: s, label: label(s) })),
            },
            { key: "note", label: "Note", type: "textarea" },
          ]}
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`recruitment/candidates/${id}/stage`, {
              method: "POST",
              body: JSON.stringify({
                stage: v.stage,
                ...(v.note ? { note: v.note } : {}),
              }),
            });
            setMode(null);
            await refresh();
          }}
        />
      )}
      {mode === "interview" && (
        <RecordForm
          fields={[
            {
              key: "interviewerUserId",
              label: "Interviewer",
              type: "select",
              required: true,
              options: (interviewers.data ?? []).map((u) => ({
                value: u.id,
                label: u.name,
              })),
            },
            {
              key: "scheduledAt",
              label: "Date and time",
              type: "text",
              required: true,
            },
            {
              key: "durationMinutes",
              label: "Duration (minutes)",
              type: "number",
              required: true,
            },
            {
              key: "mode",
              label: "Mode",
              type: "select",
              required: true,
              options: ["VIDEO", "IN_PERSON", "PHONE"].map((m) => ({
                value: m,
                label: label(m),
              })),
            },
            { key: "location", label: "Location or meeting link" },
          ]}
          initial={{
            durationMinutes: 60,
            mode: "VIDEO",
            scheduledAt: new Date(Date.now() + 86400000)
              .toISOString()
              .slice(0, 16),
          }}
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`recruitment/candidates/${id}/interviews`, {
              method: "POST",
              body: JSON.stringify({
                interviewerUserId: v.interviewerUserId,
                scheduledAt: new Date(v.scheduledAt).toISOString(),
                durationMinutes: Number(v.durationMinutes),
                mode: v.mode,
                ...(v.location ? { location: v.location } : {}),
              }),
            });
            setMode(null);
            notify("Interview scheduled.");
            await refresh();
          }}
        />
      )}
      {mode === "hire" && (
        <RecordForm
          initial={{ joinedAt: new Date().toISOString().slice(0, 10) }}
          fields={[
            { key: "employeeCode", label: "Employee code", required: true },
            {
              key: "officialEmail",
              label: "Official email (defaults to candidate email)",
              type: "email",
            },
            {
              key: "joinedAt",
              label: "Joining date",
              type: "date",
              required: true,
            },
            { key: "note", label: "Decision note", type: "textarea" },
          ]}
          submitLabel="Confirm hire"
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`recruitment/candidates/${id}/hire`, {
              method: "POST",
              body: JSON.stringify({
                employeeCode: v.employeeCode,
                joinedAt: v.joinedAt,
                ...(v.officialEmail ? { officialEmail: v.officialEmail } : {}),
                ...(v.note ? { note: v.note } : {}),
              }),
            });
            setMode(null);
            notify(
              "Candidate hired. An employee record was created on probation.",
            );
            await refresh();
          }}
        />
      )}
      <OfferPanel candidateId={c.id} active={active} notify={notify} />
      <div>
        <p className="subheading mb-2">Interviews</p>
        <Table
          headers={[
            "When",
            "Interviewer",
            "Mode",
            "Status",
            "Rating",
            "Recommendation",
            "Feedback",
          ]}
          empty="No interviews yet."
          rows={c.interviews.map((i) => [
            when(i.scheduledAt),
            i.interviewerName,
            label(i.mode),
            label(i.status),
            i.rating ?? "—",
            i.recommendation ? label(i.recommendation) : "—",
            <span key="f" className="text-xs">
              {i.feedback ?? "—"}
            </span>,
          ])}
        />
      </div>
      <div>
        <p className="subheading mb-2">History</p>
        <ul className="text-sm space-y-1">
          {c.events.map((e) => (
            <li key={e.id}>
              {when(e.createdAt)} · {e.actorName}:{" "}
              {e.fromStage ? `${label(e.fromStage)} → ` : ""}
              {label(e.toStage)}
              {e.note ? ` — ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MyInterviews({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["recruitment", "interviews"],
    queryFn: () => api<Interview[]>("recruitment/interviews?mine=1"),
  });
  const [open, setOpen] = useState<Interview | null>(null);
  return (
    <section className="card">
      <Table
        headers={["When", "Candidate", "Job", "Mode", "Status", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No interviews assigned to you."
        rows={(list.data ?? []).map((i) => [
          when(i.scheduledAt),
          i.candidate?.name ?? "—",
          i.candidate?.job.title ?? "—",
          label(i.mode),
          label(i.status),
          i.status === "SCHEDULED" ? (
            <Button
              key="f"
              size="sm"
              variant="outline"
              onClick={() => setOpen(i)}
            >
              Submit feedback
            </Button>
          ) : null,
        ])}
      />
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Interview feedback"
        description="Your structured assessment. The hiring decision is made separately by an authorised person."
      >
        {open && (
          <RecordForm
            fields={[
              {
                key: "rating",
                label: "Rating (1–5)",
                type: "select",
                required: true,
                options: [1, 2, 3, 4, 5].map((n) => ({
                  value: String(n),
                  label: String(n),
                })),
              },
              {
                key: "recommendation",
                label: "Recommendation",
                type: "select",
                required: true,
                options: ["STRONG_YES", "YES", "NO", "STRONG_NO"].map((r) => ({
                  value: r,
                  label: label(r),
                })),
              },
              {
                key: "feedback",
                label: "Questions asked, answers and comments",
                type: "textarea",
                required: true,
                maxLength: 5000,
              },
            ]}
            onCancel={() => setOpen(null)}
            onSave={async (v) => {
              await api(`recruitment/interviews/${open.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  status: "COMPLETED",
                  rating: Number(v.rating),
                  recommendation: v.recommendation,
                  feedback: v.feedback,
                }),
              });
              setOpen(null);
              notify("Feedback submitted.");
              await client.invalidateQueries({ queryKey: ["recruitment"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
