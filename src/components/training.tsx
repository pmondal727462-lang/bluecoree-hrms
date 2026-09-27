"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Table, when, type Notify } from "./platform";

type Course = {
  id: string;
  code: string;
  title: string;
  category: string | null;
  description: string | null;
  mode: string;
  durationHours: number;
  provider: string | null;
  certificationValidMonths: number | null;
  passScore: number | null;
  skills: string[];
  skillLevel: number;
  mandatory: boolean;
  active: boolean;
  _count?: { sessions: number };
};
type Trainer = {
  id: string;
  name: string;
  email: string | null;
  organization: string | null;
  expertise: string | null;
  active: boolean;
};
type Session = {
  id: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  capacity: number;
  openEnrollment: boolean;
  status: string;
  course: { id: string; code: string; title: string };
  trainer: { name: string } | null;
  _count: { enrollments: number };
  enrollments?: { id: string; status: string }[];
};
type Enrollment = {
  id: string;
  status: string;
  score: number | null;
  certificateNo: string | null;
  expiresOn: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
};
type Mine = {
  upcoming: {
    id: string;
    session: {
      startsAt: string;
      location: string | null;
      course: { title: string };
    };
  }[];
  completed: number;
  certifications: {
    id: string;
    course: string;
    certificateNo: string;
    certifiedOn: string;
    expiresOn: string | null;
    state: string;
  }[];
  skills: { skill: string; level: number; source: string }[];
} | null;
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const bool = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const person = (e: Enrollment["employee"]) =>
  `${e.employeeCode} · ${e.firstName} ${e.lastName}`;

export function TrainingPage({ me, notify }: { me: Me; notify: Notify }) {
  const manage = me.permissions.includes("training.manage");
  const [tab, setTab] = useState(manage ? "sessions" : "mine");
  const tabs = [
    ...(me.permissions.includes("training.self")
      ? [["mine", "My training"]]
      : []),
    ...(manage
      ? [
          ["sessions", "Sessions"],
          ["courses", "Courses"],
          ["trainers", "Trainers"],
          ["certifications", "Certifications"],
          ["skills", "Skills"],
          ["compliance", "Mandatory training"],
        ]
      : [["open", "Open sessions"]]),
  ];
  return (
    <>
      <Heading
        eyebrow="Learning"
        title="Training"
        text="Courses, trainers, sessions, attendance, certificates with expiry, and the skills they build."
      />
      <div className="section-tabs">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "mine" ? (
        <MyTraining />
      ) : tab === "open" ? (
        <OpenSessions notify={notify} />
      ) : tab === "sessions" ? (
        <Sessions notify={notify} />
      ) : tab === "courses" ? (
        <Courses notify={notify} />
      ) : tab === "trainers" ? (
        <Trainers notify={notify} />
      ) : tab === "certifications" ? (
        <Certifications />
      ) : tab === "skills" ? (
        <Skills notify={notify} />
      ) : (
        <Compliance />
      )}
    </>
  );
}

export function MyTraining() {
  const data = useQuery({
    queryKey: ["training", "mine"],
    queryFn: () => api<Mine>("training/mine"),
  });
  const d = data.data;
  if (data.isLoading) return <div className="empty">Loading…</div>;
  if (!d)
    return (
      <div className="empty">
        {data.error?.message ?? "Your account is not linked to an employee."}
      </div>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <div className="card-title">
          <h2>Upcoming sessions</h2>
        </div>
        <Table
          headers={["Course", "When", "Where"]}
          empty="No upcoming sessions."
          rows={d.upcoming.map((u) => [
            u.session.course.title,
            when(u.session.startsAt),
            u.session.location ?? "—",
          ])}
        />
      </section>
      <section className="card">
        <div className="card-title">
          <h2>Certificates ({d.completed} courses completed)</h2>
        </div>
        <Table
          headers={["Course", "Number", "Valid until", ""]}
          empty="No certificates yet."
          rows={d.certifications.map((c) => [
            c.course,
            c.certificateNo,
            <span
              key="v"
              className={`badge ${c.state === "VALID" ? "positive" : "amber"}`}
            >
              {c.expiresOn ? c.expiresOn.slice(0, 10) : "No expiry"}
              {c.state !== "VALID" ? ` · ${label(c.state)}` : ""}
            </span>,
            <a
              key="d"
              className="inline-flex items-center gap-1 text-xs font-semibold"
              href={`/api/training/enrollments/${c.id}/certificate`}
            >
              <Download size={14} /> PDF
            </a>,
          ])}
        />
      </section>
      <section className="card lg:col-span-2">
        <div className="card-title">
          <h2>My skills</h2>
        </div>
        <Table
          headers={["Skill", "Level (1–5)", "Source"]}
          empty="No skills recorded yet."
          rows={d.skills.map((s) => [s.skill, s.level, label(s.source)])}
        />
      </section>
    </div>
  );
}

function OpenSessions({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["training", "open"],
    queryFn: () => api<Session[]>("training/sessions"),
  });
  const act = async (id: string, action: "join" | "leave") => {
    try {
      await api(`training/sessions/${id}/${action}`, { method: "POST" });
      notify(action === "join" ? "You are enrolled." : "Enrollment cancelled.");
      await client.invalidateQueries({ queryKey: ["training"] });
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <section className="card">
      <Table
        headers={["Course", "When", "Trainer", "Places", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No sessions are open for enrollment."
        rows={(list.data ?? []).map((s) => {
          const mine = s.enrollments?.find((e) => e.status !== "CANCELLED");
          return [
            s.course.title,
            when(s.startsAt),
            s.trainer?.name ?? "—",
            `${s._count.enrollments}/${s.capacity}`,
            mine ? (
              <Button
                key="l"
                size="sm"
                variant="outline"
                onClick={() => act(s.id, "leave")}
              >
                Cancel
              </Button>
            ) : s.openEnrollment ? (
              <Button key="j" size="sm" onClick={() => act(s.id, "join")}>
                Join
              </Button>
            ) : null,
          ];
        })}
      />
    </section>
  );
}

function Sessions({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["training", "sessions"],
    queryFn: () => api<Session[]>("training/sessions"),
  });
  const courses = useQuery({
    queryKey: ["training", "courses"],
    queryFn: () => api<Course[]>("training/courses"),
  });
  const trainers = useQuery({
    queryKey: ["training", "trainers"],
    queryFn: () => api<Trainer[]>("training/trainers"),
  });
  const [creating, setCreating] = useState(false),
    [open, setOpen] = useState<Session | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["training"] });
  const soon = new Date(Date.now() + 7 * 86400000);
  soon.setUTCHours(4, 0, 0, 0);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Sessions</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await api<{
                sessionReminders: number;
                expiryNotices: number;
              }>("training/reminders", { method: "POST" });
              notify(
                `${r.sessionReminders} session reminders and ${r.expiryNotices} expiry notices sent.`,
              );
            }}
          >
            Send reminders
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            Schedule session
          </Button>
        </div>
      </div>
      <Table
        headers={["Course", "Starts", "Trainer", "Enrolled", "Status", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No sessions yet. Add a course, then schedule a session."
        rows={(list.data ?? []).map((s) => [
          `${s.course.code} · ${s.course.title}`,
          when(s.startsAt),
          s.trainer?.name ?? "—",
          `${s._count.enrollments}/${s.capacity}${s.openEnrollment ? " · open" : ""}`,
          label(s.status),
          <Button
            key="o"
            size="sm"
            variant="outline"
            onClick={() => setOpen(s)}
          >
            Manage
          </Button>,
        ])}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Schedule a session"
      >
        {creating && (
          <RecordForm
            initial={{
              startsAt: soon.toISOString().slice(0, 16),
              endsAt: new Date(soon.getTime() + 3 * 3600000)
                .toISOString()
                .slice(0, 16),
              capacity: 30,
              openEnrollment: "false",
            }}
            fields={[
              {
                key: "courseId",
                label: "Course",
                type: "select",
                required: true,
                options: (courses.data ?? [])
                  .filter((c) => c.active)
                  .map((c) => ({
                    value: c.id,
                    label: `${c.code} · ${c.title}`,
                  })),
              },
              {
                key: "trainerId",
                label: "Trainer",
                type: "select",
                options: (trainers.data ?? [])
                  .filter((t) => t.active)
                  .map((t) => ({ value: t.id, label: t.name })),
              },
              {
                key: "startsAt",
                label: "Starts (YYYY-MM-DDTHH:MM, UTC)",
                required: true,
              },
              { key: "endsAt", label: "Ends (UTC)", required: true },
              { key: "location", label: "Room or meeting link" },
              {
                key: "capacity",
                label: "Capacity",
                type: "number",
                required: true,
              },
              {
                key: "openEnrollment",
                label: "Employees may join themselves",
                type: "select",
                required: true,
                options: bool,
              },
            ]}
            onCancel={() => setCreating(false)}
            onSave={async (v) => {
              await api("training/sessions", {
                method: "POST",
                body: JSON.stringify({
                  courseId: v.courseId,
                  trainerId: v.trainerId || null,
                  startsAt: new Date(`${v.startsAt}Z`).toISOString(),
                  endsAt: new Date(`${v.endsAt}Z`).toISOString(),
                  location: v.location || null,
                  capacity: Number(v.capacity),
                  openEnrollment: v.openEnrollment === "true",
                }),
              });
              setCreating(false);
              notify("Session scheduled.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open ? `${open.course.title} · ${when(open.startsAt)}` : ""}
      >
        {open && (
          <SessionDetail session={open} notify={notify} onChanged={refresh} />
        )}
      </Dialog>
    </section>
  );
}

function SessionDetail({
  session,
  notify,
  onChanged,
}: {
  session: Session;
  notify: Notify;
  onChanged: () => Promise<void>;
}) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["training", "enrollments", session.id],
    queryFn: () =>
      api<Enrollment[]>(`training/sessions/${session.id}/enrollments`),
  });
  const [adding, setAdding] = useState(false),
    [result, setResult] = useState<Enrollment | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["training"] });
    await onChanged();
  };
  const call = async (path: string, body?: unknown, method = "POST") => {
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const scheduled = session.status === "SCHEDULED";
  return (
    <div className="space-y-4">
      {scheduled && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            Enroll employees
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => call(`training/sessions/${session.id}/complete`)}
          >
            Mark session completed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => call(`training/sessions/${session.id}/cancel`)}
          >
            Cancel session
          </Button>
        </div>
      )}
      {adding && (
        <RecordForm
          fields={[
            {
              key: "employeeId",
              label: "Employee",
              type: "select",
              reference: "employees",
              required: true,
            },
          ]}
          submitLabel="Enroll"
          onCancel={() => setAdding(false)}
          onSave={async (v) => {
            await api(`training/sessions/${session.id}/enrollments`, {
              method: "POST",
              body: JSON.stringify({ employeeIds: [v.employeeId] }),
            });
            notify("Enrolled.");
            await refresh();
          }}
        />
      )}
      <Table
        headers={["Employee", "Status", "Score", "Certificate", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="Nobody is enrolled yet."
        rows={(list.data ?? []).map((e) => [
          person(e.employee),
          label(e.status),
          e.score ?? "—",
          e.certificateNo ?? "—",
          <div key="a" className="flex gap-2 flex-wrap">
            {["ENROLLED", "ABSENT", "ATTENDED"].includes(e.status) &&
              session.status !== "CANCELLED" && (
                <>
                  {e.status !== "ATTENDED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        call(
                          `training/enrollments/${e.id}`,
                          { status: "ATTENDED" },
                          "PUT",
                        )
                      }
                    >
                      Attended
                    </Button>
                  )}
                  {e.status !== "ABSENT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        call(
                          `training/enrollments/${e.id}`,
                          { status: "ABSENT" },
                          "PUT",
                        )
                      }
                    >
                      Absent
                    </Button>
                  )}
                </>
              )}
            {e.status === "ATTENDED" && (
              <Button size="sm" onClick={() => setResult(e)}>
                Record result
              </Button>
            )}
            {e.certificateNo && (
              <a
                className="inline-flex items-center gap-1 text-xs font-semibold"
                href={`/api/training/enrollments/${e.id}/certificate`}
              >
                <Download size={14} /> Certificate
              </a>
            )}
          </div>,
        ])}
      />
      {result && (
        <RecordForm
          initial={{ passed: "true" }}
          fields={[
            { key: "score", label: "Score % (if assessed)", type: "number" },
            {
              key: "passed",
              label: "Passed",
              type: "select",
              required: true,
              options: bool,
            },
          ]}
          onCancel={() => setResult(null)}
          onSave={async (v) => {
            await api(`training/enrollments/${result.id}/result`, {
              method: "POST",
              body: JSON.stringify({
                score: v.score === "" ? null : Number(v.score),
                passed: v.passed === "true",
              }),
            });
            setResult(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Courses({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["training", "courses"],
    queryFn: () => api<Course[]>("training/courses"),
  });
  const [edit, setEdit] = useState<Course | "new" | null>(null);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Courses</h2>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          Add course
        </Button>
      </div>
      <Table
        headers={[
          "Code",
          "Title",
          "Mode",
          "Hours",
          "Certificate valid",
          "Skills",
          "Mandatory",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No courses yet."
        rows={(list.data ?? []).map((c) => [
          c.code,
          `${c.title}${c.active ? "" : " (inactive)"}`,
          label(c.mode),
          c.durationHours,
          c.certificationValidMonths
            ? `${c.certificationValidMonths} months`
            : "—",
          c.skills.join(", ") || "—",
          c.mandatory ? "Yes" : "No",
          <Button
            key="e"
            size="sm"
            variant="outline"
            onClick={() => setEdit(c)}
          >
            Edit
          </Button>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add course" : "Edit course"}
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? {
                    mode: "CLASSROOM",
                    durationHours: 2,
                    skillLevel: 3,
                    mandatory: "false",
                    active: "true",
                  }
                : {
                    ...edit,
                    skills: edit.skills.join(", "),
                    mandatory: String(edit.mandatory),
                    active: String(edit.active),
                  }
            }
            fields={[
              { key: "code", label: "Code", required: true },
              { key: "title", label: "Title", required: true },
              { key: "category", label: "Category" },
              {
                key: "mode",
                label: "Mode",
                type: "select",
                required: true,
                options: ["CLASSROOM", "ONLINE", "ON_THE_JOB", "EXTERNAL"].map(
                  (m) => ({ value: m, label: label(m) }),
                ),
              },
              {
                key: "durationHours",
                label: "Duration (hours)",
                type: "number",
                required: true,
              },
              { key: "provider", label: "Provider" },
              {
                key: "certificationValidMonths",
                label: "Certificate valid for (months; blank = no expiry)",
                type: "number",
              },
              { key: "passScore", label: "Pass score %", type: "number" },
              { key: "skills", label: "Skills built (comma separated)" },
              {
                key: "skillLevel",
                label: "Skill level reached (1–5)",
                type: "number",
                required: true,
              },
              {
                key: "mandatory",
                label: "Mandatory for all employees",
                type: "select",
                required: true,
                options: bool,
              },
              {
                key: "active",
                label: "Active",
                type: "select",
                required: true,
                options: bool,
              },
              { key: "description", label: "Description", type: "textarea" },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              const num = (k: string) => (v[k] === "" ? null : Number(v[k]));
              await api(
                `training/courses${edit === "new" ? "" : `/${edit.id}`}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    code: v.code,
                    title: v.title,
                    category: v.category || null,
                    description: v.description || null,
                    mode: v.mode,
                    durationHours: Number(v.durationHours),
                    provider: v.provider || null,
                    certificationValidMonths: num("certificationValidMonths"),
                    passScore: num("passScore"),
                    skills: v.skills
                      ? v.skills
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : [],
                    skillLevel: Number(v.skillLevel),
                    mandatory: v.mandatory === "true",
                    active: v.active === "true",
                  }),
                },
              );
              setEdit(null);
              notify("Course saved.");
              await client.invalidateQueries({ queryKey: ["training"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Trainers({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["training", "trainers"],
    queryFn: () => api<Trainer[]>("training/trainers"),
  });
  const [edit, setEdit] = useState<Trainer | "new" | null>(null);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Trainers</h2>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          Add trainer
        </Button>
      </div>
      <Table
        headers={["Name", "Organisation", "Expertise", "Active", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No trainers yet."
        rows={(list.data ?? []).map((t) => [
          t.name,
          t.organization ?? "Internal",
          t.expertise ?? "—",
          t.active ? "Yes" : "No",
          <Button
            key="e"
            size="sm"
            variant="outline"
            onClick={() => setEdit(t)}
          >
            Edit
          </Button>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add trainer" : "Edit trainer"}
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { active: "true" }
                : { ...edit, active: String(edit.active) }
            }
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "email", label: "Email", type: "email" },
              {
                key: "employeeId",
                label: "Employee (internal trainer)",
                type: "select",
                reference: "employees",
              },
              { key: "organization", label: "Organisation (external)" },
              { key: "expertise", label: "Expertise", type: "textarea" },
              {
                key: "active",
                label: "Active",
                type: "select",
                required: true,
                options: bool,
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(
                `training/trainers${edit === "new" ? "" : `/${edit.id}`}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    name: v.name,
                    email: v.email || null,
                    employeeId: v.employeeId || null,
                    organization: v.organization || null,
                    expertise: v.expertise || null,
                    active: v.active === "true",
                  }),
                },
              );
              setEdit(null);
              notify("Trainer saved.");
              await client.invalidateQueries({ queryKey: ["training"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function Certifications() {
  const [within, setWithin] = useState("60");
  const list = useQuery({
    queryKey: ["training", "certifications", within],
    queryFn: () =>
      api<
        (Enrollment & {
          certifiedOn: string;
          session: { course: { code: string; title: string } };
        })[]
      >(`training/certifications?expiringWithin=${within}`),
  });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Expiring within
          <select value={within} onChange={(e) => setWithin(e.target.value)}>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="0">Any time</option>
          </select>
        </label>
      </div>
      <Table
        headers={["Employee", "Course", "Certificate", "Expires"]}
        loading={list.isLoading}
        error={list.error}
        empty="No certificates in this window."
        rows={(list.data ?? []).map((c) => [
          person(c.employee),
          c.session.course.title,
          c.certificateNo ?? "—",
          <span
            key="x"
            className={`badge ${c.expiresOn && c.expiresOn < new Date().toISOString() ? "amber" : "positive"}`}
          >
            {c.expiresOn?.slice(0, 10) ?? "—"}
          </span>,
        ])}
      />
    </section>
  );
}

function Skills({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const [skill, setSkill] = useState(""),
    [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ["training", "skills", skill],
    queryFn: () =>
      api<
        {
          id: string;
          skill: string;
          level: number;
          source: string;
          employee: Enrollment["employee"];
        }[]
      >(`training/skills?skill=${encodeURIComponent(skill)}`),
  });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Skill
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="e.g. Excel"
          />
        </label>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus />
          Record skill
        </Button>
      </div>
      {adding && (
        <div className="p-4">
          <RecordForm
            initial={{ level: 3 }}
            fields={[
              {
                key: "employeeId",
                label: "Employee",
                type: "select",
                reference: "employees",
                required: true,
              },
              { key: "skill", label: "Skill", required: true },
              {
                key: "level",
                label: "Level (1–5)",
                type: "number",
                required: true,
              },
            ]}
            onCancel={() => setAdding(false)}
            onSave={async (v) => {
              await api("training/skills", {
                method: "PUT",
                body: JSON.stringify({
                  employeeId: v.employeeId,
                  skill: v.skill,
                  level: Number(v.level),
                }),
              });
              setAdding(false);
              notify("Skill recorded.");
              await client.invalidateQueries({ queryKey: ["training"] });
            }}
          />
        </div>
      )}
      <Table
        headers={["Skill", "Employee", "Level", "Source"]}
        loading={list.isLoading}
        error={list.error}
        empty="No skills recorded."
        rows={(list.data ?? []).map((s) => [
          s.skill,
          person(s.employee),
          s.level,
          label(s.source),
        ])}
      />
    </section>
  );
}

function Compliance() {
  const list = useQuery({
    queryKey: ["training", "compliance"],
    queryFn: () =>
      api<
        {
          course: { code: string; title: string };
          missing: Enrollment["employee"][];
          compliant: number;
          total: number;
        }[]
      >("training/compliance"),
  });
  return (
    <section className="card">
      <Table
        headers={["Course", "Compliant", "Missing or expired"]}
        loading={list.isLoading}
        error={list.error}
        empty="No mandatory courses. Mark a course as mandatory to track it here."
        rows={(list.data ?? []).map((c) => [
          `${c.course.code} · ${c.course.title}`,
          `${c.compliant}/${c.total}`,
          <span key="m" className="text-xs">
            {c.missing.slice(0, 20).map(person).join(", ") || "—"}
            {c.missing.length > 20 ? ` and ${c.missing.length - 20} more` : ""}
          </span>,
        ])}
      />
    </section>
  );
}
