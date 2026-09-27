"use client";
import { useQuery } from "@tanstack/react-query";
import { product } from "@/config/product";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Users,
  UserCheck,
  UserPlus,
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  BriefcaseBusiness,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import type { Me } from "@/types/ui";
type DashboardData = {
  total: number;
  active: number;
  newHires: number;
  onNotice: number;
  departments: { name: string; count: number }[];
  headcount: { month: string; count: number }[];
  recent: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    status: string;
    joinedAt: string;
    department: { name: string } | null;
    designation: { name: string } | null;
  }[];
  activity: {
    id: string;
    actorName: string;
    action: string;
    module: string;
    createdAt: string;
  }[];
};
export function Dashboard({ me }: { me: Me }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("dashboard"),
  });
  if (error) return <div className="error">{error.message}</div>;
  if (isLoading || !data)
    return <div className="empty">Loading your workspace…</div>;
  const stats = [
    {
      label: "Total employees",
      value: data.total,
      note: "Across your organization",
      icon: Users,
      color: "#1d4ed8",
    },
    {
      label: "Active employees",
      value: data.active,
      note: "Active & probation",
      icon: UserCheck,
      color: "#5677b6",
    },
    {
      label: "New joiners",
      value: data.newHires,
      note: "Joined this month",
      icon: UserPlus,
      color: "#ac8552",
    },
    {
      label: "On notice",
      value: data.onNotice,
      note: "Current notice periods",
      icon: BriefcaseBusiness,
      color: "#9b729e",
    },
  ];
  const colors = ["#2563eb", "#7da2df", "#adc5d3", "#e3ba84", "#b4a6ca"];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Your organization at a glance</div>
          <h1>
            Hello, {me.name.split(" ")[0]} <span className="text-xl">☀</span>
          </h1>
          <p>Here’s what’s happening with your people today.</p>
        </div>
        {me.permissions.includes("employees.write") && (
          <Button asChild>
            <Link href="/employees?new=1">
              <UserPlus />
              Add employee
            </Link>
          </Button>
        )}
      </div>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="card stat" key={s.label}>
            <div className="stat-label">
              {s.label}
              <s.icon size={19} color={s.color} />
            </div>
            <div className="stat-value">{s.value.toLocaleString()}</div>
            <p className="text-[11px] muted flex gap-2 items-center">
              <span className="size-1.5 rounded-full bg-blue-600" />
              {s.note}
            </p>
          </div>
        ))}
      </div>
      <div className="chart-grid">
        <section className="card">
          <div className="card-title">
            <div>
              <h2>People growth</h2>
              <p className="text-xs muted mt-1">
                Cumulative recorded joiners · Last 6 months
              </p>
            </div>
            <span className="badge">6 months</span>
          </div>
          <div className="p-5 h-[265px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.headcount}
                margin={{ top: 12, right: 12, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--border)"
                  vertical={false}
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--secondary)" }}
                  dy={12}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--secondary)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Recorded joiners"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#growth)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <div className="card-title">
            <div>
              <h2>By department</h2>
              <p className="text-xs muted mt-1">
                Employees excluding inactive records
              </p>
            </div>
            <Users size={18} className="muted" />
          </div>
          <div className="p-6 space-y-5">
            {data.departments.length ? (
              data.departments.map((d, i) => (
                <div key={d.name}>
                  <div className="flex justify-between text-xs mb-2">
                    <span>{d.name}</span>
                    <span className="font-semibold">
                      {d.count}{" "}
                      <span className="muted font-normal">people</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--muted)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(d.count / Math.max(1, data.total)) * 100}%`,
                        background: colors[i % colors.length],
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Add departments to organize your team.</p>
            )}
          </div>
        </section>
      </div>
      <div className="chart-grid">
        <section className="card">
          <div className="card-title">
            <h2>Recently added people</h2>
            {me.permissions.includes("employees.read") && (
              <Link
                href="/employees"
                className="flex gap-2 items-center text-xs text-blue-700 font-semibold"
              >
                View directory <ArrowRight size={14} />
              </Link>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="avatar">
                          {e.firstName[0]}
                          {e.lastName[0]}
                        </span>
                        <div className="font-semibold">
                          {e.firstName} {e.lastName}
                          <p className="muted text-[11px] font-normal mt-1">
                            {e.designation?.name || e.employeeCode}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="muted">
                      {e.department?.name || "Unassigned"}
                    </td>
                    <td>
                      <span
                        className={`badge ${e.status === "Active" ? "positive" : "amber"}`}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recent.length && (
              <div className="empty">
                Your directory starts here. Add your first employee.
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-title">
            <h2>Workspace activity</h2>
            <Sparkles size={17} className="muted" />
          </div>
          <div className="p-6 space-y-5">
            {data.activity.map((a) => (
              <div className="flex gap-3" key={a.id}>
                <div className="size-8 shrink-0 rounded-full bg-[var(--muted)] grid place-items-center">
                  <ArrowUpRight size={14} />
                </div>
                <div>
                  <p className="text-xs font-semibold">{a.actorName}</p>
                  <p className="muted text-xs mt-1">
                    {a.action.toLowerCase().replaceAll("_", " ")} · {a.module}
                  </p>
                  <p className="muted text-[10px] mt-1">
                    {new Date(a.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {!data.activity.length && (
              <p className="text-sm muted leading-6">
                {me.permissions.includes("audit.read")
                  ? "New activity will appear as your workspace grows."
                  : "Your workspace is ready. Open My profile to review your personal details."}
              </p>
            )}
          </div>
        </section>
      </div>
      <p className="text-[10px] muted text-center mt-8">
        {product.name} · A LITTLE MORE CONNECTED, EVERY DAY
      </p>
    </>
  );
}
