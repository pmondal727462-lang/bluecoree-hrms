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
import {
  PeerRequests,
  PerformanceHistory,
  ReviewDetail,
  ratingOptions,
} from "./performance-extras";

type Person = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
};
type Cycle = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  selfReview: boolean;
  peerReview: boolean;
  ratingScale: number;
  ratingLabels: string[];
  _count?: { reviews: number };
};
type Goal = {
  id: string;
  employeeId: string;
  type: string;
  title: string;
  description: string | null;
  metric: string | null;
  target: string | null;
  unit: string | null;
  weight: number;
  progress: number;
  actual: string | null;
  dueDate: string | null;
  status: string;
  source: string;
  cycleId: string | null;
  parentId: string | null;
  employee: Person;
  cycle: { name: string } | null;
};
type Review = {
  id: string;
  employeeId: string;
  status: string;
  selfRating: number | null;
  selfComments: string | null;
  managerRating: number | null;
  managerComments: string | null;
  strengths: string | null;
  improvements: string | null;
  developmentPlan: string | null;
  finalRating: number | null;
  employee: Person;
  cycle: {
    name: string;
    status: string;
    peerReview: boolean;
    ratingScale: number;
    ratingLabels: string[];
  };
};
type Feedback = {
  id: string;
  kind: string;
  text: string;
  authorName: string;
  visibleToEmployee: boolean;
  createdAt: string;
  employee: Person;
};
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const who = (p: Person) => `${p.employeeCode} · ${p.firstName} ${p.lastName}`;

export function PerformancePage({ me, notify }: { me: Me; notify: Notify }) {
  const has = (p: string) => me.permissions.includes(p);
  const scopes = [
    ...(has("performance.self") ? [["own", "Mine"]] : []),
    ...(has("performance.team") || has("performance.manage")
      ? [["team", "My team"]]
      : []),
    ...(has("performance.manage") ? [["company", "Company"]] : []),
  ];
  const [tab, setTab] = useState("goals"),
    [scope, setScope] = useState(scopes[0]?.[0] ?? "own");
  return (
    <>
      <Heading
        eyebrow="Performance"
        title="Goals & reviews"
        text="KPIs and OKRs, review cycles, manager reviews and feedback. AI suggestions arrive as drafts that a manager edits and approves."
      />
      <div className="section-tabs">
        {[
          ["goals", "Goals"],
          ["reviews", "Reviews"],
          ["feedback", "Feedback"],
          ...(has("performance.self") ? [["peers", "Peer reviews"]] : []),
          ["history", "History"],
          ...(has("performance.manage") ? [["cycles", "Review cycles"]] : []),
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
      {!["cycles", "peers", "history"].includes(tab) && scopes.length > 1 && (
        <div className="toolbar card mb-4">
          <label>
            Show
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {tab === "goals" ? (
        <Goals scope={scope} me={me} notify={notify} />
      ) : tab === "reviews" ? (
        <Reviews scope={scope} me={me} notify={notify} />
      ) : tab === "feedback" ? (
        <FeedbackTab scope={scope} notify={notify} />
      ) : tab === "peers" ? (
        <PeerRequests notify={notify} />
      ) : tab === "history" ? (
        <PerformanceHistory />
      ) : (
        <Cycles notify={notify} />
      )}
    </>
  );
}

function Goals({ scope, notify }: { scope: string; me: Me; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["performance", "goals", scope],
    queryFn: () => api<Goal[]>(`performance/goals?scope=${scope}`),
  });
  const cycles = useQuery({
    queryKey: ["performance", "cycles"],
    queryFn: () => api<Cycle[]>("performance/cycles"),
  });
  const team = useQuery({
    queryKey: ["performance", "team"],
    queryFn: () => api<Review[]>(`performance/reviews?scope=${scope}`),
    enabled: scope !== "own",
  });
  const [edit, setEdit] = useState<Goal | "new" | null>(null),
    [progress, setProgress] = useState<Goal | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["performance"] });
  const act = async (g: Goal, status: string) => {
    try {
      await api(`performance/goals/${g.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      notify(`Goal ${label(status)}.`);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const people = new Map(
    (team.data ?? []).map((r) => [r.employee.id, r.employee]),
  );
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Goals</h2>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          Add goal
        </Button>
      </div>
      <Table
        headers={[
          "Employee",
          "Goal",
          "Target",
          "Weight",
          "Progress",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No goals yet."
        rows={(list.data ?? []).map((g) => {
          const mine = scope === "own";
          return [
            who(g.employee),
            <div key="g">
              <div className="font-semibold">
                {g.title}{" "}
                {g.source === "AI" && (
                  <span className="badge amber">AI suggestion</span>
                )}
              </div>
              <span className="muted text-xs">
                {label(g.type)}
                {g.metric ? ` · ${g.metric}` : ""}
                {g.cycle ? ` · ${g.cycle.name}` : ""}
              </span>
            </div>,
            g.target ? `${g.target} ${g.unit ?? ""}` : "—",
            `${g.weight}%`,
            `${g.progress}%${g.actual ? ` (${g.actual})` : ""}`,
            label(g.status),
            <div key="a" className="flex gap-2 flex-wrap">
              {["DRAFT", "PENDING_APPROVAL"].includes(g.status) && (
                <Button size="sm" variant="outline" onClick={() => setEdit(g)}>
                  Edit
                </Button>
              )}
              {mine && g.status === "DRAFT" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(g, "PENDING_APPROVAL")}
                >
                  Submit
                </Button>
              )}
              {!mine && ["DRAFT", "PENDING_APPROVAL"].includes(g.status) && (
                <Button size="sm" onClick={() => act(g, "APPROVED")}>
                  Approve
                </Button>
              )}
              {g.status === "APPROVED" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProgress(g)}
                >
                  Update progress
                </Button>
              )}
              {!mine && g.status === "APPROVED" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(g, "COMPLETED")}
                >
                  Complete
                </Button>
              )}
            </div>,
          ];
        })}
      />
      <p className="muted text-xs p-4">
        Paste suggestions from HR Copilot's performance assistant as new goals
        with source "AI suggestion". Managers review, edit and approve them;
        nothing is approved automatically.
      </p>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add goal" : "Edit goal"}
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { type: "KPI", weight: 0, source: "MANUAL" }
                : { ...edit, dueDate: edit.dueDate?.slice(0, 10) }
            }
            fields={[
              ...(edit === "new" && scope !== "own"
                ? [
                    {
                      key: "employeeId",
                      label: "Employee (blank = myself)",
                      type: "select" as const,
                      options: [...people.values()].map((p) => ({
                        value: p.id,
                        label: who(p),
                      })),
                    },
                  ]
                : []),
              {
                key: "type",
                label: "Type",
                type: "select",
                required: true,
                options: [
                  "KPI",
                  "OKR",
                  "KEY_RESULT",
                  "GOAL",
                  "DEVELOPMENT",
                ].map((t) => ({
                  value: t,
                  label: t === "KEY_RESULT" ? "Key result (of an OKR)" : t,
                })),
              },
              {
                key: "parentId",
                label: "Objective (for key results)",
                type: "select",
                options: (list.data ?? [])
                  .filter(
                    (g) =>
                      g.type === "OKR" &&
                      (edit === "new" || g.employeeId === edit.employeeId),
                  )
                  .map((g) => ({
                    value: g.id,
                    label: `${g.title} · ${g.employee.firstName}`,
                  })),
              },
              { key: "title", label: "Title", required: true },
              {
                key: "metric",
                label: "Measurement (e.g. monthly achieved revenue)",
              },
              { key: "target", label: "Target (e.g. 1000000)" },
              { key: "unit", label: "Unit (e.g. INR)" },
              {
                key: "weight",
                label: "Weight %",
                type: "number",
                required: true,
              },
              { key: "dueDate", label: "Due date", type: "date" },
              {
                key: "cycleId",
                label: "Review cycle",
                type: "select",
                options: (cycles.data ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              },
              ...(edit === "new"
                ? [
                    {
                      key: "source",
                      label: "Source",
                      type: "select" as const,
                      required: true,
                      options: [
                        { value: "MANUAL", label: "Written by a person" },
                        { value: "AI", label: "AI suggestion" },
                      ],
                    },
                  ]
                : []),
              {
                key: "description",
                label: "Description",
                type: "textarea",
                maxLength: 2000,
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              const n = (k: string) => (v[k] ? v[k] : null);
              await api(
                `performance/goals${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    ...(edit === "new" && v.employeeId
                      ? { employeeId: v.employeeId }
                      : {}),
                    ...(edit === "new" ? { source: v.source } : {}),
                    type: v.type,
                    title: v.title,
                    description: n("description"),
                    metric: n("metric"),
                    target: n("target"),
                    unit: n("unit"),
                    weight: Number(v.weight || 0),
                    dueDate: n("dueDate"),
                    cycleId: n("cycleId"),
                    parentId: v.type === "KEY_RESULT" ? n("parentId") : null,
                  }),
                },
              );
              setEdit(null);
              notify("Goal saved as a draft.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!progress}
        onOpenChange={(v) => !v && setProgress(null)}
        title="Update progress"
      >
        {progress && (
          <RecordForm
            initial={{ progress: progress.progress, actual: progress.actual }}
            fields={[
              {
                key: "progress",
                label: "Progress %",
                type: "number",
                required: true,
              },
              { key: "actual", label: "Actual achieved" },
            ]}
            onCancel={() => setProgress(null)}
            onSave={async (v) => {
              await api(`performance/goals/${progress.id}/progress`, {
                method: "PUT",
                body: JSON.stringify({
                  progress: Number(v.progress),
                  actual: v.actual || null,
                }),
              });
              setProgress(null);
              await refresh();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Reviews({
  scope,
  me,
  notify,
}: {
  scope: string;
  me: Me;
  notify: Notify;
}) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["performance", "reviews", scope],
    queryFn: () => api<Review[]>(`performance/reviews?scope=${scope}`),
  });
  const [open, setOpen] = useState<{
    review: Review;
    mode: "self" | "manager" | "view";
  } | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["performance"] });
  return (
    <section className="card">
      <Table
        headers={["Employee", "Cycle", "Status", "Self", "Final", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No reviews. HR launches review cycles."
        rows={(list.data ?? []).map((r) => [
          who(r.employee),
          r.cycle.name,
          label(r.status),
          r.selfRating ?? "—",
          r.finalRating ?? r.managerRating ?? "—",
          <div key="a" className="flex gap-2">
            {scope === "own" &&
              r.status === "PENDING_SELF" &&
              r.cycle.status === "ACTIVE" && (
                <Button
                  size="sm"
                  onClick={() => setOpen({ review: r, mode: "self" })}
                >
                  Self review
                </Button>
              )}
            {scope !== "own" &&
              r.status === "PENDING_MANAGER" &&
              r.cycle.status === "ACTIVE" && (
                <Button
                  size="sm"
                  onClick={() => setOpen({ review: r, mode: "manager" })}
                >
                  Write review
                </Button>
              )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen({ review: r, mode: "view" })}
            >
              View
            </Button>
            {scope === "own" && r.status === "COMPLETED" && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api(`performance/reviews/${r.id}/acknowledge`, {
                    method: "POST",
                  });
                  notify("Review acknowledged.");
                  await refresh();
                }}
              >
                Acknowledge
              </Button>
            )}
          </div>,
        ])}
      />
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={
          open
            ? `${open.review.cycle.name} · ${open.review.employee.firstName} ${open.review.employee.lastName}`
            : ""
        }
      >
        {open?.mode === "view" && (
          <ReviewDetail
            id={open.review.id}
            canRequestPeers={scope !== "own"}
            canCalibrate={me.permissions.includes("performance.manage")}
            notify={notify}
          />
        )}
        {open?.mode === "self" && (
          <RecordForm
            fields={[
              {
                key: "selfRating",
                label: "Your rating",
                type: "select",
                required: true,
                options: ratingOptions(open.review.cycle),
              },
              {
                key: "selfComments",
                label: "Achievements and reflections",
                type: "textarea",
                maxLength: 3000,
                required: true,
              },
            ]}
            submitLabel="Submit self review"
            onCancel={() => setOpen(null)}
            onSave={async (v) => {
              await api(`performance/reviews/${open.review.id}/self`, {
                method: "PUT",
                body: JSON.stringify({
                  selfRating: Number(v.selfRating),
                  selfComments: v.selfComments,
                }),
              });
              setOpen(null);
              await refresh();
            }}
          />
        )}
        {open?.mode === "manager" && (
          <RecordForm
            fields={[
              {
                key: "managerRating",
                label: "Rating",
                type: "select",
                required: true,
                options: ratingOptions(open.review.cycle),
              },
              {
                key: "managerComments",
                label: "Overall comments",
                type: "textarea",
                maxLength: 3000,
                required: true,
              },
              {
                key: "strengths",
                label: "Strengths",
                type: "textarea",
                maxLength: 3000,
              },
              {
                key: "improvements",
                label: "Areas to improve",
                type: "textarea",
                maxLength: 3000,
              },
              {
                key: "developmentPlan",
                label: "Development plan",
                type: "textarea",
                maxLength: 3000,
              },
            ]}
            submitLabel="Complete review"
            onCancel={() => setOpen(null)}
            onSave={async (v) => {
              await api(`performance/reviews/${open.review.id}/manager`, {
                method: "PUT",
                body: JSON.stringify({
                  managerRating: Number(v.managerRating),
                  managerComments: v.managerComments,
                  strengths: v.strengths || null,
                  improvements: v.improvements || null,
                  developmentPlan: v.developmentPlan || null,
                }),
              });
              setOpen(null);
              notify(`Review completed by ${me.name}.`);
              await refresh();
            }}
          >
            {open.review.selfComments && (
              <p className="text-sm mt-4 whitespace-pre-wrap">
                Self assessment: {open.review.selfComments}
              </p>
            )}
          </RecordForm>
        )}
      </Dialog>
    </section>
  );
}

function FeedbackTab({ scope, notify }: { scope: string; notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["performance", "feedback", scope],
    queryFn: () => api<Feedback[]>(`performance/feedback?scope=${scope}`),
  });
  const people = useQuery({
    queryKey: ["performance", "directory"],
    queryFn: () =>
      api<Person[]>("performance/people").then((items) => ({ items })),
  });
  const [giving, setGiving] = useState(false);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Feedback</h2>
        <Button size="sm" onClick={() => setGiving(true)}>
          <Plus />
          Give feedback
        </Button>
      </div>
      <Table
        headers={[
          "For",
          "From",
          "Type",
          "Feedback",
          "Visible to employee",
          "When",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No feedback yet."
        rows={(list.data ?? []).map((f) => [
          who(f.employee),
          f.authorName,
          label(f.kind),
          <span key="t" className="text-sm whitespace-pre-wrap">
            {f.text}
          </span>,
          f.visibleToEmployee ? "Yes" : "No",
          when(f.createdAt),
        ])}
      />
      <Dialog
        open={giving}
        onOpenChange={setGiving}
        title="Give feedback"
        description="Colleagues can give visible praise or suggestions. Private notes are for the employee's manager and HR."
      >
        {giving && (
          <RecordForm
            initial={{ kind: "PRAISE", visibleToEmployee: "true" }}
            fields={[
              {
                key: "employeeId",
                label: "Employee",
                type: "select",
                required: true,
                options: (people.data?.items ?? []).map((p) => ({
                  value: p.id,
                  label: who(p),
                })),
              },
              {
                key: "kind",
                label: "Type",
                type: "select",
                required: true,
                options: ["PRAISE", "SUGGESTION", "NOTE"].map((k) => ({
                  value: k,
                  label: label(k),
                })),
              },
              {
                key: "visibleToEmployee",
                label: "Visible to the employee",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No (manager/HR note)" },
                ],
              },
              {
                key: "text",
                label: "Feedback",
                type: "textarea",
                maxLength: 3000,
                required: true,
              },
            ]}
            onCancel={() => setGiving(false)}
            onSave={async (v) => {
              await api("performance/feedback", {
                method: "POST",
                body: JSON.stringify({
                  employeeId: v.employeeId,
                  kind: v.kind,
                  text: v.text,
                  visibleToEmployee: v.visibleToEmployee === "true",
                }),
              });
              setGiving(false);
              notify("Feedback recorded.");
              await client.invalidateQueries({ queryKey: ["performance"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Cycles({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["performance", "cycles"],
    queryFn: () => api<Cycle[]>("performance/cycles"),
  });
  const [creating, setCreating] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["performance"] });
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Review cycles</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New cycle
        </Button>
      </div>
      <Table
        headers={[
          "Name",
          "Period",
          "Self review",
          "Peers",
          "Scale",
          "Reviews",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No review cycles yet."
        rows={(list.data ?? []).map((c) => [
          c.name,
          `${c.periodStart.slice(0, 10)} → ${c.periodEnd.slice(0, 10)}`,
          c.selfReview ? "Yes" : "No",
          c.peerReview ? "Yes" : "No",
          `1–${c.ratingScale}`,
          c._count?.reviews ?? 0,
          label(c.status),
          c.status !== "CLOSED" ? (
            <Button
              key="a"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api(
                    `performance/cycles/${c.id}/${c.status === "DRAFT" ? "launch" : "close"}`,
                    { method: "POST" },
                  );
                  notify(
                    c.status === "DRAFT"
                      ? "Cycle launched; reviews created for active employees."
                      : "Cycle closed.",
                  );
                  await refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              {c.status === "DRAFT" ? "Launch" : "Close"}
            </Button>
          ) : null,
        ])}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New review cycle"
      >
        {creating && (
          <RecordForm
            initial={{
              selfReview: "true",
              peerReview: "false",
              ratingScale: 5,
            }}
            fields={[
              { key: "name", label: "Name", required: true },
              {
                key: "periodStart",
                label: "Period start",
                type: "date",
                required: true,
              },
              {
                key: "periodEnd",
                label: "Period end",
                type: "date",
                required: true,
              },
              {
                key: "selfReview",
                label: "Include self review",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
              },
              {
                key: "peerReview",
                label: "Include peer reviews",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
              },
              {
                key: "ratingScale",
                label: "Rating scale (3 to 10 points)",
                type: "number",
                required: true,
              },
              {
                key: "ratingLabels",
                label:
                  "Rating labels, lowest first, separated by commas (optional)",
              },
            ]}
            onCancel={() => setCreating(false)}
            onSave={async (v) => {
              await api("performance/cycles", {
                method: "POST",
                body: JSON.stringify({
                  name: v.name,
                  periodStart: v.periodStart,
                  periodEnd: v.periodEnd,
                  selfReview: v.selfReview === "true",
                  peerReview: v.peerReview === "true",
                  ratingScale: Number(v.ratingScale),
                  ratingLabels: v.ratingLabels
                    ? v.ratingLabels
                        .split(",")
                        .map((l) => l.trim())
                        .filter(Boolean)
                    : [],
                }),
              });
              setCreating(false);
              await refresh();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
