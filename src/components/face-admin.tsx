"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Pages, Table, when } from "./platform";

type Profile = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  faceRequired: boolean;
  faceProfile: { enrolledAt: string; active: boolean } | null;
  failedLast24h: number;
};
type Log = {
  id: string;
  status: string;
  confidence: number | null;
  livenessPassed: boolean;
  reason: string | null;
  deviceId: string | null;
  ip: string | null;
  createdAt: string;
  employee: { employeeCode: string; firstName: string; lastName: string };
};
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
const reasonText: Record<string, string> = {
  FACE_VERIFICATION_FAILED: "Face did not match",
  FACE_PROVIDER_UNAVAILABLE: "Provider unavailable",
  REPLAYED_SAMPLE: "Reused image (possible spoof)",
};

// HR view of face enrolment and verification attempts.
export function FaceAdmin({ notify }: { notify: (message: string) => void }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [logPage, setLogPage] = useState(1),
    [status, setStatus] = useState("");
  const profiles = useQuery({
    queryKey: ["face", "profiles", page, search],
    queryFn: () =>
      api<Paged<Profile>>(
        `face/profiles?${new URLSearchParams({ page: String(page), search })}`,
      ),
  });
  const logs = useQuery({
    queryKey: ["face", "logs", logPage, status],
    queryFn: () =>
      api<Paged<Log>>(
        `face/logs?${new URLSearchParams({ page: String(logPage), ...(status ? { status } : {}) })}`,
      ),
  });
  return (
    <div className="grid gap-6">
      <section className="card">
        <div className="card-title">
          <h2>Face enrolment</h2>
        </div>
        <p className="muted text-sm px-6">
          Resetting deletes the stored template so the employee registers again
          at their next sign-in. Photos are never stored.
        </p>
        <div className="toolbar">
          <label>
            Search
            <input
              value={search}
              maxLength={100}
              placeholder="Name or employee ID"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <Table
          headers={[
            "Employee",
            "Face required",
            "Enrolled",
            "Failed (24 h)",
            "",
          ]}
          loading={profiles.isLoading}
          error={profiles.error}
          empty="No employees."
          rows={(profiles.data?.items ?? []).map((p) => [
            `${p.employeeCode} · ${p.firstName} ${p.lastName}`,
            p.faceRequired ? "Yes" : "Company policy",
            p.faceProfile ? when(p.faceProfile.enrolledAt) : "Not enrolled",
            <span key="f" className={p.failedLast24h ? "badge amber" : ""}>
              {p.failedLast24h}
            </span>,
            p.faceProfile ? (
              <Button
                key="r"
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Reset the face registration of ${p.firstName} ${p.lastName}?`,
                    )
                  )
                    return;
                  try {
                    await api(`face/profiles/${p.id}`, { method: "DELETE" });
                    notify("Face registration reset.");
                    await client.invalidateQueries({ queryKey: ["face"] });
                  } catch (e) {
                    notify(e instanceof Error ? e.message : "Could not reset.");
                  }
                }}
              >
                Reset
              </Button>
            ) : (
              ""
            ),
          ])}
        />
        <Pages data={profiles.data} page={page} setPage={setPage} />
      </section>
      <section className="card">
        <div className="card-title">
          <h2>Verification log</h2>
        </div>
        <div className="toolbar">
          <label>
            Result
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setLogPage(1);
              }}
            >
              <option value="">All</option>
              <option value="SUCCESS">Matched</option>
              <option value="FAILED">Failed</option>
              <option value="REVIEW_REQUIRED">Provider unavailable</option>
            </select>
          </label>
        </div>
        <Table
          headers={[
            "When",
            "Employee",
            "Result",
            "Confidence",
            "Liveness",
            "Device / IP",
          ]}
          loading={logs.isLoading}
          error={logs.error}
          empty="No face scans yet."
          rows={(logs.data?.items ?? []).map((l) => [
            when(l.createdAt),
            `${l.employee.employeeCode} · ${l.employee.firstName} ${l.employee.lastName}`,
            <div key="s">
              <span
                className={`badge ${l.status === "SUCCESS" ? "positive" : "amber"}`}
              >
                {l.status === "SUCCESS"
                  ? "Matched"
                  : l.status === "FAILED"
                    ? "Failed"
                    : "Review"}
              </span>
              {l.reason && (
                <p className="muted text-xs mt-1">
                  {reasonText[l.reason] ?? l.reason}
                </p>
              )}
            </div>,
            l.confidence === null ? "—" : l.confidence.toFixed(2),
            l.status === "SUCCESS" ? (l.livenessPassed ? "Passed" : "—") : "—",
            [l.deviceId, l.ip].filter(Boolean).join(" · ") || "—",
          ])}
        />
        <Pages data={logs.data} page={logPage} setPage={setLogPage} />
      </section>
    </div>
  );
}
