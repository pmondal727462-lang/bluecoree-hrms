"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock3,
  Calculator,
  FileText,
  Users,
} from "lucide-react";
const solutions = [
  {
    icon: Clock3,
    title: "Time & attendance",
    heading: "A clearer picture of every working day.",
    text: "Bring daily attendance, shifts and leave into one view. Let HR set policies that reflect how your team actually works.",
    points: [
      "Face, GPS and biometric check-in options",
      "Working-hour and half-day thresholds",
      "Configurable single-punch treatment",
      "Attendance reports and correction approvals",
    ],
    href: "attendance",
    visual: [
      "09:00 · Check-in recorded",
      "18:00 · Check-out recorded",
      "8 hours · After scheduled break",
    ],
    label: "A WORKDAY, CONNECTED",
  },
  {
    icon: Calculator,
    title: "Payroll & payslips",
    heading: "Turn attendance into a payroll you can review.",
    text: "Keep salary structures, attendance inputs and approvals connected, with a clear review step before payroll is processed.",
    points: [
      "Salary components and loss-of-pay calculations",
      "Configured PF, ESI, PT and TDS rules",
      "Draft, review and approval workflow",
      "Employee payslips and payroll exports",
    ],
    href: "payroll",
    visual: [
      "Prepare · Attendance & salary inputs",
      "Review · Earnings & deductions",
      "Approve · Process & share payslips",
    ],
    label: "A CLEAR PAYROLL WORKFLOW",
  },
  {
    icon: FileText,
    title: "Employee self-service",
    heading: "Everyday answers, in your employee’s hands.",
    text: "Give people secure access to their records and documents, with fewer messages back and forth to HR.",
    points: [
      "Private employment-letter downloads",
      "Leave requests and payslip access",
      "Birthday and work-anniversary wishes",
      "HR requests with progress tracking",
    ],
    href: "hr",
    visual: [
      "My documents · Letters in one place",
      "My requests · Progress at a glance",
      "My team · Moments worth celebrating",
    ],
    label: "A PLACE FOR EVERY EMPLOYEE",
  },
  {
    icon: Users,
    title: "People & growth",
    heading: "Support people from joining to growing.",
    text: "Connect recruitment, onboarding, performance and learning to the employee record as your organisation grows.",
    points: [
      "Recruitment pipelines and onboarding tasks",
      "Department and location organisation",
      "Goals, reviews and development",
      "Training and certification records",
    ],
    href: "performance",
    visual: [
      "Welcome · An organised start",
      "Develop · Goals & conversations",
      "Grow · Learning & skills",
    ],
    label: "THE EMPLOYEE JOURNEY",
  },
];
export function SolutionExplorer() {
  const [active, setActive] = useState(0);
  const selected = solutions[active];
  return (
    <div className="marketing-explorer">
      <div
        className="marketing-solution-tabs"
        role="tablist"
        aria-label="Explore solutions"
      >
        {solutions.map((s, i) => (
          <button
            key={s.href}
            id={`solution-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls="solution-panel"
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (i + 1) % solutions.length
                  : e.key === "ArrowLeft"
                    ? (i + solutions.length - 1) % solutions.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? solutions.length - 1
                        : null;
              if (next !== null) {
                e.preventDefault();
                setActive(next);
                document.getElementById(`solution-tab-${next}`)?.focus();
              }
            }}
          >
            <s.icon size={21} />
            {s.title}
          </button>
        ))}
      </div>
      <div
        id="solution-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`solution-tab-${active}`}
        className="marketing-solution-panel"
      >
        <div>
          <h3>{selected.heading}</h3>
          <p>{selected.text}</p>
          <ul className="marketing-check-list">
            {selected.points.map((p) => (
              <li key={p}>
                <Check size={17} />
                {p}
              </li>
            ))}
          </ul>
          <Link
            href={`/features#${selected.href}`}
            className="marketing-text-link"
          >
            Explore {selected.title.toLowerCase()} <ArrowRight size={17} />
          </Link>
        </div>
        <div className="marketing-flow-visual">
          <p>{selected.label}</p>
          {selected.visual.map((v, i) => (
            <div key={v}>
              <span>{i + 1}</span>
              <strong>{v}</strong>
              <Check size={17} />
            </div>
          ))}
          <small>Illustrative workflow · features depend on your plan</small>
        </div>
      </div>
    </div>
  );
}
