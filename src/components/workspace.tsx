"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Building2,
  UserRound,
  ShieldCheck,
  Network,
  History,
  Monitor,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  ChevronRight,
  Globe,
  Clock3,
  CalendarDays,
  Settings2,
  WalletCards,
  Smartphone,
  Plug,
  Lock,
  CreditCard,
  LifeBuoy,
  Calculator,
  Receipt,
  Briefcase,
  Target,
  GraduationCap,
  Laptop,
  BarChart3,
  GitBranch,
  Home as HomeIcon,
  FileText,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { BrandLogo, CompanyLogo } from "./company-logo";
import { SubscriptionBanner, SubscriptionPage } from "./saas";
import { SupportPage } from "./support";
import { PlatformPage } from "./platform-admin";
import { PayrollPage } from "./payroll-admin";
import { ExpensesPage } from "./expenses";
import { RecruitmentPage } from "./recruitment";
import { TrainingPage } from "./training";
import { AssetsPage } from "./assets";
import { PerformancePage } from "./performance";
import { ReportsPage } from "./reports";
import { LifecyclePage } from "./lifecycle";
import { HomePage, NotificationBell } from "./home";
import { DocumentsPage } from "./documents";
import { HelpdeskPage } from "./helpdesk";
import { OnboardingPage } from "./onboarding";
import { Dashboard } from "./dashboard";
import { Directory } from "./directory";
import { CompanySettings, CompanyList, Profile, SessionList } from "./settings";
import { RoleManager } from "./role-manager";
import { AttendancePage, LeavePage, TimeSettings } from "./time-management";
import { HRCopilot } from "./hr-copilot";
import { Payslips } from "./payslips";
import { FaceRegistration } from "./face-registration";
import { DevicesPage } from "./platform";
import { IntegrationsPage } from "./integrations";
import { SecurityPage, SecuritySetupRequired } from "./security";
const nav = [
  { key: "home", label: "Home", icon: HomeIcon, permission: "" },
  {
    key: "documents",
    label: "Documents",
    icon: FileText,
    permission: "documents.self",
  },
  {
    key: "helpdesk",
    label: "HR requests",
    icon: MessageSquare,
    permission: "helpdesk.self",
  },
  {
    key: "onboarding",
    label: "Onboarding",
    icon: UserPlus,
    permission: "onboarding.manage",
  },
  {
    key: "attendance",
    label: "Attendance",
    icon: Clock3,
    permission: "attendance.self",
  },
  {
    key: "leave",
    label: "Leave & holidays",
    icon: CalendarDays,
    permission: "timeoff.self",
  },
  {
    key: "payslips",
    label: "Payslips",
    icon: WalletCards,
    permission: "payroll.self",
  },
  {
    key: "payroll",
    label: "Payroll",
    icon: Calculator,
    permission: "payroll.read",
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: Receipt,
    permission: "expenses.self",
  },
  {
    key: "recruitment",
    label: "Recruitment",
    icon: Briefcase,
    permission: "recruitment.manage",
  },
  {
    key: "performance",
    label: "Performance",
    icon: Target,
    permission: "performance.self",
  },
  {
    key: "training",
    label: "Training",
    icon: GraduationCap,
    permission: "training.self",
  },
  {
    key: "assets",
    label: "Assets",
    icon: Laptop,
    permission: "assets.self",
  },
  {
    key: "reports",
    label: "Custom reports",
    icon: BarChart3,
    permission: "reports.custom",
  },
  {
    key: "time-settings",
    label: "Time settings",
    icon: Settings2,
    permission: "time.configure",
  },
  {
    key: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    permission: "dashboard.read",
  },
  {
    key: "employees",
    label: "Employees",
    icon: Users,
    permission: "employees.read",
  },
  {
    key: "lifecycle",
    label: "Employee lifecycle",
    icon: GitBranch,
    permission: "employees.write",
  },
  {
    key: "organization",
    label: "Organization",
    icon: Network,
    permission: "organization.read",
  },
  {
    key: "profile",
    label: "My profile",
    icon: UserRound,
    permission: "profile.read",
  },
  { key: "users", label: "Users", icon: Users, permission: "users.read" },
  {
    key: "roles",
    label: "Roles & permissions",
    icon: ShieldCheck,
    permission: "roles.read",
  },
  {
    key: "company",
    label: "Company settings",
    icon: Building2,
    permission: "company.read",
  },
  {
    key: "audit",
    label: "Audit trail",
    icon: History,
    permission: "audit.read",
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    permission: "integrations.manage",
  },
  {
    key: "security",
    label: "Security",
    icon: Lock,
    permission: "audit.read",
  },
  {
    key: "devices",
    label: "Devices",
    icon: Smartphone,
    permission: "devices.manage",
  },
  {
    key: "subscription",
    label: "Subscription",
    icon: CreditCard,
    permission: "company.read",
  },
  {
    key: "support",
    label: "Support",
    icon: LifeBuoy,
    permission: "support.use",
  },
  { key: "sessions", label: "My sessions", icon: Monitor, permission: "" },
];
// Modules hidden when the company's plan does not include them.
const navFeature: Record<string, string> = {
  "hr-copilot": "ai",
  attendance: "attendance",
  leave: "attendance",
  "time-settings": "attendance",
  payslips: "payroll",
  payroll: "payroll",
  expenses: "expenses",
  recruitment: "recruitment",
  performance: "performance",
  training: "training",
  assets: "assets",
  reports: "reports",
  onboarding: "onboarding",
  integrations: "api",
  dashboard: "reports",
};
export function Workspace({ module }: { module: string }) {
  const [askOpen, setAskOpen] = useState(false);
  const [askReport, setAskReport] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("ask")) {
      setAskOpen(true);
      setAskReport(query.has("report"));
    }
  }, []);
  const [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false),
    [toast, setToast] = useState("");
  const { data: me, error } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("auth/me", {}, false);
      } catch {
        const s = await api<{ required: boolean }>("auth/setup");
        if (s.required) {
          window.location.href = "/setup";
          throw new Error("Opening setup…");
        }
        try {
          await api("auth/refresh", { method: "POST" }, false);
          return await api<Me>("auth/me", {}, false);
        } catch {
          window.location.href = ["admin", "platform"].includes(module)
            ? "/owner/login"
            : "/login";
          throw new Error("Opening sign in…");
        }
      }
    },
    retry: false,
  });
  useEffect(() => {
    const value = localStorage.getItem("people-theme") === "dark";
    setDark(value);
    document.documentElement.classList.toggle("dark", value);
  }, []);
  // White-label colours and title from the company's branding.
  useEffect(() => {
    const color = me?.branding?.primaryColor;
    if (color) document.documentElement.style.setProperty("--accent", color);
    if (me?.branding?.portalTitle) document.title = me.branding.portalTitle;
  }, [me]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (
      me &&
      module === "dashboard" &&
      !me.permissions.includes("dashboard.read")
    )
      window.location.replace("/home");
  }, [me, module]);
  if (!me)
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center">
          <div className="brand justify-center">
            <CompanyLogo />
          </div>
          <p className="muted">
            {error ? error.message : "Opening your workspace…"}
          </p>
        </div>
      </div>
    );
  if (me.passwordChangeRequired || me.mfaSetupRequired)
    return (
      <main className="min-h-screen bg-[var(--background)] p-6">
        <div className="max-w-2xl mx-auto py-10">
          <div className="flex items-center justify-between gap-4 mb-8">
            <CompanyLogo />
            <Button
              variant="outline"
              onClick={async () => {
                await api("auth/logout", { method: "POST" });
                window.location.href = me.isSuperAdmin
                  ? "/owner/login"
                  : "/login";
              }}
            >
              Sign out
            </Button>
          </div>
          <p className="muted text-sm mb-4">
            {me.name} · {me.isSuperAdmin ? "Software owner" : me.roleName}
          </p>
          <SecuritySetupRequired me={me} />
        </div>
      </main>
    );
  const inPlan = (key: string) =>
    !navFeature[key] ||
    !me.subscription ||
    me.subscription.plan.features.includes(navFeature[key]);
  const canOpen = (n: (typeof nav)[number]) =>
    inPlan(n.key) &&
    (!n.permission ||
      me.permissions.includes(n.permission) ||
      (n.key === "attendance" && me.permissions.includes("attendance.read")) ||
      (n.key === "leave" && me.permissions.includes("timeoff.manage")) ||
      (n.key === "security" && me.permissions.includes("security.manage")) ||
      (n.key === "documents" && me.permissions.includes("documents.manage")) ||
      (n.key === "helpdesk" && me.permissions.includes("helpdesk.manage")) ||
      (n.key === "expenses" &&
        ["expenses.approve", "expenses.manage"].some((p) =>
          me.permissions.includes(p),
        )) ||
      (n.key === "recruitment" &&
        me.permissions.includes("recruitment.interview")) ||
      (n.key === "training" && me.permissions.includes("training.manage")) ||
      (n.key === "assets" && me.permissions.includes("assets.manage")) ||
      (n.key === "performance" &&
        ["performance.team", "performance.manage"].some((p) =>
          me.permissions.includes(p),
        )));
  const currentNav = nav.find((n) => n.key === module);
  const canAsk = me.permissions.includes("ai.use") && inPlan("hr-copilot") &&
    !(me as Me & { faceEnrollmentRequired?: boolean }).faceEnrollmentRequired;
  const denied =
    (currentNav && !canOpen(currentNav)) ||
    (["companies", "platform", "admin"].includes(module) && !me.platformRole) ||
    (module === "companies" && !me.isSuperAdmin);
  return (
    <>
      {mobile && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 bg-black/40 z-20"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link href="/dashboard" className="brand shrink-0">
          <BrandLogo branding={me.branding} />
        </Link>
        <div className="mx-5 mb-7 p-3 rounded-lg border border-[var(--border)] flex gap-3 items-center">
          <div className="size-8 shrink-0 rounded-lg bg-[var(--muted)] grid place-items-center">
            <Building2 size={17} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{me.company.name}</p>
            <p className="muted text-[10px] mt-1">
              {me.company.code} · Workspace
            </p>
          </div>
        </div>
        <p className="eyebrow px-8 mb-3">Workspace</p>
        <nav className="overflow-y-auto flex-1">
          {nav.filter(canOpen).map((n) => (
            <Link
              onClick={() => setMobile(false)}
              key={n.key}
              href={`/${n.key}`}
              className={`nav-link ${module === n.key ? "active" : ""}`}
            >
              <n.icon size={17} />
              {n.label}
            </Link>
          ))}
          {me.platformRole && (
            <Link
              href="/admin"
              className={`nav-link ${["platform", "admin"].includes(module) ? "active" : ""}`}
            >
              <Globe size={17} />
              {me.isSuperAdmin ? "Management dashboard" : "Platform"}
            </Link>
          )}
        </nav>
        <div className="mx-5 my-5 p-4 rounded-xl bg-[var(--background)]">
          <p className="text-xs font-semibold flex items-center gap-2">
            <ShieldCheck size={15} className="text-blue-600" /> Your secure
            workspace
          </p>
          <p className="muted text-[11px] leading-5 mt-2">
            Company access and permissions protect your team’s information.
          </p>
        </div>
        <button
          className="nav-link mb-6"
          onClick={async () => {
            try {
              await api("auth/logout", { method: "POST" });
              window.location.href = me.isSuperAdmin
                ? "/owner/login"
                : "/login";
            } catch (e) {
              setToast((e as Error).message);
            }
          }}
        >
          <LogOut size={17} />
          Sign out
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              {mobile ? <X /> : <Menu />}
            </Button>
            <span className="text-xs muted">Workspace</span>
            <ChevronRight size={12} className="muted" />
            <span className="text-xs font-semibold">
              {nav.find((n) => n.key === module)?.label || "Companies"}
            </span>
          </div>
          <div className="flex items-center gap-5">
            <span className="desktop-only text-xs muted">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            {canAsk && (
              <Button variant="outline" onClick={() => { setAskReport(false); setAskOpen(true); }} aria-haspopup="dialog">
                <MessageSquare size={16} /> Ask Me
              </Button>
            )}
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => {
                setDark(!dark);
                document.documentElement.classList.toggle("dark", !dark);
                localStorage.setItem("people-theme", !dark ? "dark" : "light");
              }}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <div className="h-8 w-px bg-[var(--border)]" />
            <Link href="/profile" className="flex gap-3 items-center">
              <span className="avatar">
                {me.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div className="desktop-only">
                <p className="text-xs font-semibold">{me.name}</p>
                <p className="text-[10px] muted mt-1">{me.roleName}</p>
              </div>
            </Link>
          </div>
        </header>
        <main className="content">
          <SubscriptionBanner me={me} />
          {me.passwordChangeRequired || me.mfaSetupRequired ? (
            <SecuritySetupRequired me={me} />
          ) : (me as Me & { faceEnrollmentRequired?: boolean })
              .faceEnrollmentRequired ? (
            <FaceRegistration />
          ) : denied ? (
            <div className="card empty">
              You do not have access to this page.
            </div>
          ) : module === "attendance" ? (
            <AttendancePage me={me} notify={setToast} onAskReport={canAsk ? () => { setAskReport(true); setAskOpen(true); } : undefined} />
          ) : module === "leave" ? (
            <LeavePage me={me} notify={setToast} />
          ) : module === "payslips" ? (
            <Payslips me={me} />
          ) : module === "time-settings" ? (
            <TimeSettings me={me} notify={setToast} />
          ) : module === "dashboard" ? (
            <Dashboard me={me} />
          ) : ["employees", "users", "organization", "audit"].includes(
              module,
            ) ? (
            <Directory key={module} module={module} me={me} notify={setToast} />
          ) : module === "roles" ? (
            <RoleManager me={me} notify={setToast} />
          ) : module === "company" ? (
            <CompanySettings me={me} notify={setToast} />
          ) : module === "companies" ? (
            <CompanyList notify={setToast} />
          ) : module === "home" ? (
            <HomePage me={me} notify={setToast} />
          ) : module === "documents" ? (
            <DocumentsPage me={me} notify={setToast} />
          ) : module === "helpdesk" ? (
            <HelpdeskPage me={me} notify={setToast} />
          ) : module === "onboarding" ? (
            <OnboardingPage me={me} notify={setToast} />
          ) : module === "lifecycle" ? (
            <LifecyclePage me={me} notify={setToast} />
          ) : module === "payroll" ? (
            <PayrollPage me={me} notify={setToast} />
          ) : module === "expenses" ? (
            <ExpensesPage me={me} notify={setToast} />
          ) : module === "recruitment" ? (
            <RecruitmentPage me={me} notify={setToast} />
          ) : module === "performance" ? (
            <PerformancePage me={me} notify={setToast} />
          ) : module === "assets" ? (
            <AssetsPage me={me} notify={setToast} />
          ) : module === "training" ? (
            <TrainingPage me={me} notify={setToast} />
          ) : module === "reports" ? (
            <ReportsPage me={me} notify={setToast} />
          ) : module === "support" ? (
            <SupportPage me={me} notify={setToast} />
          ) : module === "platform" || module === "admin" ? (
            <PlatformPage me={me} notify={setToast} />
          ) : module === "subscription" ? (
            <SubscriptionPage me={me} notify={setToast} />
          ) : module === "security" ? (
            <SecurityPage me={me} notify={setToast} />
          ) : module === "integrations" ? (
            <IntegrationsPage me={me} notify={setToast} />
          ) : module === "devices" ? (
            <DevicesPage me={me} notify={setToast} />
          ) : module === "profile" ? (
            <Profile me={me} notify={setToast} />
          ) : (
            <SessionList me={me} notify={setToast} />
          )}
        </main>
      </div>
      {canAsk && (
        <Dialog open={askOpen} onOpenChange={setAskOpen} title="Ask Me" description="Your HR assistant. Ask questions or work on drafts without leaving this page.">
          <HRCopilot me={me} report={askReport} />
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
