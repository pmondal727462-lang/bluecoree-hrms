"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Megaphone, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, when, type Notify } from "./platform";
import { SetupChecklist } from "./setup-checklist";
import { FaceAttendanceCard } from "./time-management";
import { Celebrations } from "./celebrations";

type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  createdByName: string;
  audience: string;
};
type Home = {
  today: string;
  employee: {
    name: string;
    employeeCode: string;
    department: string | null;
    designation: string | null;
    shift: { name: string } | null;
  } | null;
  attendance: {
    checkIn: string;
    checkOut: string | null;
    workedMinutes: number;
  } | null;
  leave:
    | { id: string; name: string; remaining: number; annualDays: number }[]
    | null;
  holidays: { id: string; name: string; date: string }[];
  payslip: { periodEnd: string; netPay: number; currency: string } | null;
  announcements: Announcement[];
  documents: {
    toAcknowledge: number;
    expiringSoon: number;
    rejected: number;
  } | null;
  openTickets: number | null;
  expenses: { status: string; count: number; amount: number }[] | null;
  pendingSelfReviews: number | null;
  activeGoals: number | null;
  training: {
    upcoming: { course: string; startsAt: string }[];
    expiring: number;
    completed: number;
  } | null;
  unreadNotifications: number;
  approvals: Record<string, number>;
};
type Notification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
const money = (v: number, c = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(v);
const approvalLinks: Record<string, [string, string]> = {
  leave: ["Leave requests", "/leave"],
  expenses: ["Expense claims", "/expenses"],
  missedPunches: ["Missed punches", "/attendance"],
  documents: ["Documents to review", "/documents"],
  helpdesk: ["Helpdesk tickets", "/helpdesk"],
  reviews: ["Performance reviews", "/performance"],
};

export function NotificationBell() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const data = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api<{ items: Notification[]; unreadCount: number }>("notifications"),
    refetchInterval: 60000,
  });
  const markAll = async () => {
    await api("notifications/read", { method: "POST" });
    await client.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Notifications, ${data.data?.unreadCount ?? 0} unread`}
        onClick={() => setOpen(!open)}
      >
        <Bell />
        {!!data.data?.unreadCount && (
          <span className="absolute -top-0.5 -right-0.5 rounded-full bg-red-600 text-white text-[10px] min-w-4 h-4 px-1 grid place-items-center">
            {Math.min(99, data.data.unreadCount)}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] card z-30 max-h-[70vh] overflow-auto">
          <div className="flex justify-between items-center p-3 border-b border-[var(--border)]">
            <strong className="text-sm">Notifications</strong>
            <button className="text-xs text-blue-700" onClick={markAll}>
              Mark all read
            </button>
          </div>
          {(data.data?.items ?? []).map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "#"}
              onClick={async () => {
                setOpen(false);
                if (!n.readAt) {
                  await api(`notifications/read/${n.id}`, { method: "POST" });
                  await client.invalidateQueries({
                    queryKey: ["notifications"],
                  });
                }
              }}
              className={`block p-3 border-b border-[var(--border)] text-sm ${n.readAt ? "muted" : ""}`}
            >
              <div className="font-semibold">{n.title}</div>
              <div className="text-xs mt-1 line-clamp-2">{n.body}</div>
              <div className="text-[10px] muted mt-1">{when(n.createdAt)}</div>
            </Link>
          ))}
          {!data.data?.items.length && (
            <p className="p-4 muted text-sm">No notifications yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function HomePage({ me, notify }: { me: Me; notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["home"],
    queryFn: () => api<Home>("home"),
  });
  const [posting, setPosting] = useState(false);
  const h = data.data;
  if (!h)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  const approvals = Object.entries(h.approvals).filter(([, n]) => n > 0);
  const tile = (label: string, value: React.ReactNode, href?: string) => (
    <div className="card stat" key={label}>
      <div className="stat-label">{label}</div>
      <div className="stat-value text-xl">
        {href ? <Link href={href}>{value}</Link> : value}
      </div>
    </div>
  );
  return (
    <>
      <Celebrations />
      {me.permissions.includes("company.write") && (
        <SetupChecklist canDismiss />
      )}
      <Heading
        eyebrow={h.today}
        title={`Hello, ${h.employee?.name.split(" ")[0] ?? me.name}`}
        text={
          h.employee
            ? [
                h.employee.designation,
                h.employee.department,
                h.employee.shift?.name,
              ]
                .filter(Boolean)
                .join(" · ") || h.employee.employeeCode
            : "Your account is not linked to an employee record."
        }
      />
      {h.employee && <FaceAttendanceCard me={me} notify={notify} />}
      <div className="stat-grid mb-6">
        {h.employee &&
          tile(
            "Today",
            h.attendance
              ? h.attendance.checkOut
                ? "Completed"
                : `In since ${new Date(h.attendance.checkIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : "Not checked in",
            "/attendance",
          )}
        {h.payslip &&
          tile(
            "Latest payslip",
            money(h.payslip.netPay, h.payslip.currency),
            "/payslips",
          )}
        {h.openTickets !== null &&
          tile("Open HR requests", h.openTickets, "/helpdesk")}
        {h.documents &&
          tile(
            "Documents to acknowledge",
            h.documents.toAcknowledge,
            "/documents",
          )}
        {h.pendingSelfReviews !== null &&
          tile("Self reviews due", h.pendingSelfReviews, "/performance")}
        {tile("Unread notifications", h.unreadNotifications)}
      </div>
      {!!approvals.length && (
        <section className="card p-5 mb-6">
          <h2 className="font-semibold mb-3">Waiting for you</h2>
          <div className="flex flex-wrap gap-3">
            {approvals.map(([k, n]) => (
              <Link
                key={k}
                href={approvalLinks[k][1]}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                {approvalLinks[k][0]}{" "}
                <span className="badge amber ml-1">{n}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        <section className="card">
          <div className="card-title flex justify-between items-center">
            <h2 className="flex gap-2 items-center">
              <Megaphone size={18} />
              Announcements
            </h2>
            {me.permissions.includes("announcements.manage") && (
              <Button size="sm" onClick={() => setPosting(true)}>
                <Plus />
                Post
              </Button>
            )}
          </div>
          <div className="p-5 space-y-4">
            {h.announcements.map((a) => (
              <article
                key={a.id}
                className="border-b border-[var(--border)] pb-4 last:border-0"
              >
                <h3 className="font-semibold">
                  {a.pinned && <span className="badge amber mr-2">Pinned</span>}
                  {a.title}
                </h3>
                <p className="text-sm mt-2 whitespace-pre-wrap">{a.body}</p>
                <p className="muted text-xs mt-2">
                  {a.createdByName} · {when(a.publishedAt)}
                </p>
              </article>
            ))}
            {!h.announcements.length && (
              <p className="muted text-sm">No announcements.</p>
            )}
          </div>
        </section>
        <div className="space-y-6">
          {h.leave && (
            <section className="card p-5">
              <h2 className="font-semibold mb-3">Leave balance</h2>
              {h.leave.map((l) => (
                <div key={l.id} className="flex justify-between text-sm py-1">
                  <span>{l.name}</span>
                  <strong>
                    {l.remaining} / {l.annualDays}
                  </strong>
                </div>
              ))}
              {!h.leave.length && (
                <p className="muted text-sm">No leave types configured.</p>
              )}
              <Link
                href="/leave"
                className="text-blue-700 text-sm mt-3 inline-block"
              >
                Apply for leave
              </Link>
            </section>
          )}
          <section className="card p-5">
            <h2 className="font-semibold mb-3">Upcoming holidays</h2>
            {h.holidays.map((x) => (
              <div key={x.id} className="flex justify-between text-sm py-1">
                <span>{x.name}</span>
                <span className="muted">{x.date.slice(0, 10)}</span>
              </div>
            ))}
            {!h.holidays.length && (
              <p className="muted text-sm">None scheduled.</p>
            )}
          </section>
          {h.training && (
            <section className="card p-5">
              <h2 className="font-semibold mb-3">Training</h2>
              {h.training.upcoming.map((t) => (
                <div
                  key={t.course + t.startsAt}
                  className="flex justify-between text-sm py-1"
                >
                  <span>{t.course}</span>
                  <span className="muted">{t.startsAt.slice(0, 10)}</span>
                </div>
              ))}
              {!h.training.upcoming.length && (
                <p className="muted text-sm">No upcoming sessions.</p>
              )}
              <p className="text-sm mt-2">
                {h.training.completed} completed
                {h.training.expiring
                  ? ` · ${h.training.expiring} certificate(s) expiring or expired`
                  : ""}
              </p>
              <Link className="text-sm font-semibold" href="/training">
                Open training
              </Link>
            </section>
          )}
          {h.expenses && !!h.expenses.length && (
            <section className="card p-5">
              <h2 className="font-semibold mb-3">Expense claims</h2>
              {h.expenses.map((e) => (
                <div
                  key={e.status}
                  className="flex justify-between text-sm py-1"
                >
                  <span>{e.status.toLowerCase()}</span>
                  <span>
                    {e.count} · {money(e.amount)}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
      <Dialog
        open={posting}
        onOpenChange={setPosting}
        title="Post an announcement"
      >
        {posting && (
          <RecordForm
            initial={{ audience: "ALL", pinned: "false" }}
            fields={[
              { key: "title", label: "Title", required: true },
              {
                key: "audience",
                label: "Audience",
                type: "select",
                required: true,
                options: [{ value: "ALL", label: "Everyone" }],
              },
              {
                key: "pinned",
                label: "Pin to top",
                type: "select",
                required: true,
                options: [
                  { value: "false", label: "No" },
                  { value: "true", label: "Yes" },
                ],
              },
              {
                key: "expiresAt",
                label: "Hide after (optional)",
                type: "date",
              },
              {
                key: "body",
                label: "Message",
                type: "textarea",
                required: true,
                maxLength: 10000,
              },
            ]}
            onCancel={() => setPosting(false)}
            onSave={async (v) => {
              await api("announcements", {
                method: "POST",
                body: JSON.stringify({
                  title: v.title,
                  body: v.body,
                  audience: v.audience,
                  pinned: v.pinned === "true",
                  expiresAt: v.expiresAt
                    ? new Date(`${v.expiresAt}T23:59:59Z`).toISOString()
                    : null,
                }),
              });
              setPosting(false);
              notify("Announcement published.");
              await client.invalidateQueries({ queryKey: ["home"] });
            }}
          />
        )}
      </Dialog>
    </>
  );
}
