import Link from "next/link";
import type { ReactNode } from "react";
import { product } from "@/config/product";

const nav = [
  ["/features", "Features"],
  ["/pricing", "Pricing"],
  ["/resources", "Resources"],
  ["/contact", "Contact"],
] as const;

// Layout for the public marketing pages (spec §75).
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center gap-4 justify-between">
          <Link href="/" className="font-bold text-lg">
            {product.name}
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {nav.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
            <Link href="/login">Sign in</Link>
            <Link
              href="/start-trial"
              className="px-3 py-1 rounded-lg bg-[var(--primary,#1f4e99)] text-white font-semibold"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[var(--border)] mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm muted flex flex-wrap gap-6 justify-between">
          <span>
            © {new Date().getFullYear()} {product.name}
          </span>
          <span className="flex gap-4">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/api-docs">API</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

export const modules: {
  key: string;
  title: string;
  text: string;
  points: string[];
}[] = [
  {
    key: "hr",
    title: "Core HR",
    text: "One employee record from joining to exit.",
    points: [
      "Profiles, documents and history",
      "Organisation, departments and locations",
      "Self-service portal and HR helpdesk",
      "Onboarding checklists and exit settlement",
    ],
  },
  {
    key: "attendance",
    title: "Attendance & leave",
    text: "Accurate time with the methods your teams already use.",
    points: [
      "Web, mobile, GPS and geofenced check-in",
      "AI face attendance with liveness and replay checks",
      "Biometric devices (ZKTeco/eSSL, Hikvision, Suprema)",
      "Shifts, rosters, overtime approval, leave accrual and comp-off",
    ],
  },
  {
    key: "payroll",
    title: "Payroll",
    text: "Indian statutory payroll with review and approval.",
    points: [
      "PF, ESI, PT and TDS from effective-dated rules",
      "Pay from attendance, overtime, encashment, loans and bonuses",
      "Draft → review → approval → payslips, with month lock",
      "PF ECR, ESI, PT and TDS files, accounting journal",
    ],
  },
  {
    key: "recruitment",
    title: "Recruitment",
    text: "From careers page to joining day.",
    points: [
      "Public careers page and applications",
      "Pipeline from applied to joined",
      "Interviews, feedback and offer letters",
      "Candidates accept offers online",
    ],
  },
  {
    key: "performance",
    title: "Performance & learning",
    text: "Goals, reviews, skills and certifications.",
    points: [
      "KPIs and OKRs with key results",
      "Self, manager and peer reviews with calibration",
      "Training sessions, certificates and expiry reminders",
      "Skills register and mandatory-training compliance",
    ],
  },
  {
    key: "ai",
    title: "AI HR Copilot",
    text: "Answers and drafts, always within each person's access.",
    points: [
      "Ask about leave, attendance, approvals and reports",
      "Drafts letters, job descriptions and review notes",
      "People approve every draft",
      "No free-form database access",
    ],
  },
  {
    key: "mobile",
    title: "Mobile app",
    text: "For employees on the move.",
    points: [
      "GPS and face attendance",
      "Leave, payslips, expenses and documents",
      "Approvals for managers",
      "Push notifications",
    ],
  },
];
