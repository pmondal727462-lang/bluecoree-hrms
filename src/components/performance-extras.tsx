"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Table, type Notify } from "./platform";

type Scale = { ratingScale: number; ratingLabels: unknown };
export const ratingOptions = (c?: Partial<Scale>) => {
  const n = c?.ratingScale ?? 5;
  const labels = Array.isArray(c?.ratingLabels)
    ? (c.ratingLabels as string[])
    : [];
  const fallback =
    n === 5
      ? [
          "Needs improvement",
          "Below expectations",
          "Meets expectations",
          "Exceeds expectations",
          "Outstanding",
        ]
      : [];
  return Array.from({ length: n }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}${(labels[i] ?? fallback[i]) ? ` — ${labels[i] ?? fallback[i]}` : ""}`,
  }));
};
type Peer = {
  id: string;
  status: string;
  rating: number | null;
  comments: string | null;
  reviewer?: { firstName: string; lastName: string };
};
type Detail = {
  id: string;
  status: string;
  selfRating: number | null;
  selfComments: string | null;
  managerRating: number | null;
  managerComments: string | null;
  strengths: string | null;
  improvements: string | null;
  developmentPlan: string | null;
  finalRating: number | null;
  calibrationNote: string | null;
  cycle: Scale & { status: string; peerReview: boolean };
  peers: {
    requested: number;
    submitted: number;
    averageRating: number | null;
    items?: Peer[];
    comments?: string[];
  } | null;
};

// Review detail with peer input, and HR calibration of the final rating.
export function ReviewDetail({
  id,
  canRequestPeers,
  canCalibrate,
  notify,
}: {
  id: string;
  canRequestPeers: boolean;
  canCalibrate: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["performance", "review", id],
    queryFn: () => api<Detail>(`performance/reviews/${id}`),
  });
  const people = useQuery({
    queryKey: ["performance", "directory"],
    queryFn: () =>
      api<
        {
          id: string;
          employeeCode: string;
          firstName: string;
          lastName: string;
        }[]
      >("performance/people"),
    enabled: canRequestPeers,
  });
  const [mode, setMode] = useState<"peers" | "calibrate" | null>(null),
    [picked, setPicked] = useState<string[]>([]);
  const r = detail.data;
  if (!r)
    return <div className="empty">{detail.error?.message ?? "Loading…"}</div>;
  const refresh = () => client.invalidateQueries({ queryKey: ["performance"] });
  const open =
    r.cycle.status === "ACTIVE" &&
    !["COMPLETED", "ACKNOWLEDGED"].includes(r.status);
  return (
    <div className="space-y-3 text-sm">
      {[
        ["Self rating", r.selfRating],
        ["Self assessment", r.selfComments],
        ["Manager rating", r.managerRating],
        ["Manager comments", r.managerComments],
        ["Strengths", r.strengths],
        ["Areas to improve", r.improvements],
        ["Development plan", r.developmentPlan],
        ["Final rating", r.finalRating],
        ["Calibration note", r.calibrationNote],
      ]
        .filter(([k, v]) => k !== "Calibration note" || v)
        .map(([k, v]) => (
          <div key={String(k)}>
            <p className="muted text-xs">{k}</p>
            <p className="whitespace-pre-wrap">{v ?? "—"}</p>
          </div>
        ))}
      {r.peers && (
        <div>
          <p className="muted text-xs">Peer reviews</p>
          <p>
            {r.peers.submitted} of {r.peers.requested} submitted
            {r.peers.averageRating !== null &&
              ` · average ${r.peers.averageRating}`}
          </p>
          {r.peers.items?.map((p) => (
            <p key={p.id} className="text-xs mt-1">
              {p.reviewer?.firstName} {p.reviewer?.lastName} ·{" "}
              {p.status.toLowerCase()}
              {p.rating ? ` · ${p.rating}` : ""}
              {p.comments ? ` — ${p.comments}` : ""}
            </p>
          ))}
          {r.peers.comments?.map((c, i) => (
            <p key={i} className="text-xs mt-1">
              “{c}”
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {canRequestPeers && r.cycle.peerReview && open && (
          <Button size="sm" variant="outline" onClick={() => setMode("peers")}>
            Request peer reviews
          </Button>
        )}
        {canCalibrate &&
          r.cycle.status === "ACTIVE" &&
          ["COMPLETED", "ACKNOWLEDGED"].includes(r.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode("calibrate")}
            >
              Calibrate rating
            </Button>
          )}
      </div>
      {mode === "peers" && (
        <div className="space-y-2">
          <select
            multiple
            className="w-full h-40"
            value={picked}
            onChange={(e) =>
              setPicked([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.employeeCode} · {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!picked.length}
            onClick={async () => {
              try {
                await api(`performance/reviews/${id}/peers`, {
                  method: "POST",
                  body: JSON.stringify({ employeeIds: picked }),
                });
                notify("Peer reviews requested.");
                setMode(null);
                setPicked([]);
                await refresh();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Send requests
          </Button>
        </div>
      )}
      {mode === "calibrate" && (
        <RecordForm
          initial={{ finalRating: r.finalRating ?? r.managerRating }}
          fields={[
            {
              key: "finalRating",
              label: "Final rating",
              type: "select",
              required: true,
              options: ratingOptions(r.cycle),
            },
            {
              key: "note",
              label: "Reason",
              type: "textarea",
              required: true,
            },
          ]}
          onCancel={() => setMode(null)}
          onSave={async (v) => {
            await api(`performance/reviews/${id}/calibrate`, {
              method: "POST",
              body: JSON.stringify({
                finalRating: Number(v.finalRating),
                note: v.note,
              }),
            });
            setMode(null);
            notify("Final rating saved.");
            await refresh();
          }}
        />
      )}
    </div>
  );
}

type Request = {
  id: string;
  status: string;
  rating: number | null;
  review: {
    employee: { firstName: string; lastName: string; employeeCode: string };
    cycle: Scale & { name: string; status: string };
  };
};
// Peer reviews the signed-in employee has been asked to give.
export function PeerRequests({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["performance", "peer-reviews"],
    queryFn: () => api<Request[]>("performance/peer-reviews"),
  });
  const [open, setOpen] = useState<Request | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["performance"] });
  return (
    <section className="card">
      <Table
        headers={["Colleague", "Cycle", "Status", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No peer reviews have been requested from you."
        rows={(list.data ?? []).map((p) => [
          `${p.review.employee.employeeCode} · ${p.review.employee.firstName} ${p.review.employee.lastName}`,
          p.review.cycle.name,
          p.status.toLowerCase(),
          p.status === "REQUESTED" && p.review.cycle.status === "ACTIVE" ? (
            <div key="a" className="flex gap-2">
              <Button size="sm" onClick={() => setOpen(p)}>
                Respond
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api(`performance/peer-reviews/${p.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ decline: true }),
                  });
                  await refresh();
                }}
              >
                Decline
              </Button>
            </div>
          ) : null,
        ])}
      />
      {open && (
        <div className="p-4 border-t border-[var(--border)]">
          <RecordForm
            fields={[
              {
                key: "rating",
                label: "Rating",
                type: "select",
                required: true,
                options: ratingOptions(open.review.cycle),
              },
              {
                key: "comments",
                label: "Comments (the employee sees them without your name)",
                type: "textarea",
                required: true,
              },
            ]}
            onCancel={() => setOpen(null)}
            onSave={async (v) => {
              await api(`performance/peer-reviews/${open.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  rating: Number(v.rating),
                  comments: v.comments,
                }),
              });
              setOpen(null);
              notify("Peer review submitted.");
              await refresh();
            }}
          />
        </div>
      )}
    </section>
  );
}

type History = {
  cycle: { id: string; name: string; periodStart: string; periodEnd: string };
  status: string;
  selfRating: number | null;
  managerRating: number | null;
  finalRating: number | null;
  calibrated: boolean;
  peerAverage: number | null;
  goals: { total: number; completed: number };
};
// Ratings and goals across review cycles.
export function PerformanceHistory({ employeeId }: { employeeId?: string }) {
  const list = useQuery({
    queryKey: ["performance", "history", employeeId ?? "me"],
    queryFn: () =>
      api<History[]>(
        `performance/history${employeeId ? `?employeeId=${employeeId}` : ""}`,
      ),
  });
  return (
    <section className="card">
      <Table
        headers={[
          "Cycle",
          "Period",
          "Status",
          "Self",
          "Manager",
          "Peers",
          "Final",
          "Goals done",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No review history yet."
        rows={(list.data ?? []).map((h) => [
          h.cycle.name,
          `${h.cycle.periodStart.slice(0, 10)} → ${h.cycle.periodEnd.slice(0, 10)}`,
          h.status.replaceAll("_", " ").toLowerCase(),
          h.selfRating ?? "—",
          h.managerRating ?? "—",
          h.peerAverage ?? "—",
          h.finalRating
            ? `${h.finalRating}${h.calibrated ? " (calibrated)" : ""}`
            : "—",
          `${h.goals.completed}/${h.goals.total}`,
        ])}
      />
    </section>
  );
}
