import Link from "next/link";
import type { ReactNode } from "react";
import { product } from "@/config/product";
import { CompanyLogo } from "./company-logo";
import { ArrowUpRight } from "lucide-react";
import "./marketing.css";

const nav = [
  ["/features", "Features"],
  ["/pricing", "Pricing"],
  ["/resources", "Resources"],
  ["/contact", "Contact"],
] as const;

// Layout for the public marketing pages (spec §75).
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site min-h-screen flex flex-col">
      <a className="marketing-skip" href="#public-content">
        Skip to content
      </a>
      <div className="marketing-announcement">
        One connected workspace for your people.{" "}
        <Link href="/features">
          Explore BlueCoreeHR <ArrowUpRight size={13} />
        </Link>
      </div>
      <header className="marketing-header">
        <div className="marketing-nav">
          <Link
            href="/"
            className="marketing-brand"
            aria-label="BlueCoreeHR home"
          >
            <CompanyLogo width={110} />
            <span>
              BlueCoree<span>HR</span>
            </span>
          </Link>
          <nav aria-label="Main navigation" className="marketing-links">
            {nav.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="marketing-actions">
            <Link href="/login">Log in</Link>
            <Link href="/contact" className="marketing-button">
              Request a demo <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
      </header>
      <main id="public-content" className="flex-1">
        {children}
      </main>
      <footer className="marketing-footer">
        <div className="marketing-container marketing-footer-grid">
          <div>
            <h3>{product.name}</h3>
            <p>
              People, time and payroll.
              <br />
              Better together.
            </p>
          </div>
          <div>
            <h4>Explore</h4>
            <Link href="/features">Our features</Link>
            <Link href="/pricing">Plans & pricing</Link>
            <Link href="/resources">Resources</Link>
          </div>
          <div>
            <h4>Get started</h4>
            <Link href="/start-trial">Start free trial</Link>
            <Link href="/contact">Request a demo</Link>
            <Link href="/api-docs">API documentation</Link>
          </div>
          <div>
            <h4>Your workspace</h4>
            <Link href="/login">Employee & company login</Link>
            <Link href="/owner/login">Management Login</Link>
            <Link href="/forgot-password">Reset password</Link>
          </div>
        </div>
        <div className="marketing-container marketing-copyright">
          © {new Date().getFullYear()} {product.name}
          <span>Built for the way your people work.</span>
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
    title: "Ask Me assistant",
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
