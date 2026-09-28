"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Minus, ArrowUpRight, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";

type Plan = {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number | null;
  priceAnnual: number | null;
  pricePerEmployeeMonthly: number | null;
  pricePerEmployeeAnnual: number | null;
  minimumMonthly: number | null;
  currency: string;
  employeeLimit: number | null;
  features: string[];
  trialDays: number | null;
  taxRate: number;
};
type AddOn = {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceAnnual: number;
  perEmployee: boolean;
};
const labels: Record<string, string> = {
  attendance: "Attendance & leave",
  face: "Face attendance",
  biometric: "Biometric devices",
  payroll: "Payroll",
  recruitment: "Recruitment",
  performance: "Performance",
  training: "Training",
  expenses: "Expenses",
  assets: "Assets",
  onboarding: "Onboarding",
  ai: "Ask Me assistant",
  mobile: "Mobile access",
  reports: "Reports",
  api: "API & integrations",
  whitelabel: "White label",
};
const money = (amount: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
export function Pricing() {
  const [data, setData] = useState<{ plans: Plan[]; addOns: AddOn[] } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [annual, setAnnual] = useState(true);
  const [employees, setEmployees] = useState(50);
  useEffect(() => {
    api<{ plans: Plan[]; addOns: AddOn[] }>("public/plans")
      .then(setData)
      .catch(() =>
        setError(
          "Prices could not be loaded. Please refresh or contact us for a quote.",
        ),
      );
  }, []);
  if (error)
    return (
      <div role="alert" className="card p-6">
        {error}{" "}
        <Link href="/contact" className="marketing-text-link">
          Contact sales
        </Link>
      </div>
    );
  if (!data)
    return (
      <p role="status" className="muted text-center">
        Loading plans…
      </p>
    );
  const plans = data.plans.filter((p) => p.code !== "FREE_TRIAL");
  const trial = data.plans.find((p) => p.code === "FREE_TRIAL");
  const period = annual ? "year" : "month";
  const features = Object.keys(labels).filter((key) =>
    plans.some((p) => p.features.includes(key)),
  );
  return (
    <>
      <div className="marketing-pricing-controls">
        <div
          className="marketing-billing"
          role="group"
          aria-label="Billing period"
        >
          <button
            type="button"
            aria-pressed={!annual}
            onClick={() => setAnnual(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={annual}
            onClick={() => setAnnual(true)}
          >
            Yearly
          </button>
        </div>
        <label>
          Team size{" "}
          <input
            aria-label="Number of employees"
            type="number"
            min={1}
            max={1000000}
            step={1}
            value={employees}
            onChange={(e) =>
              setEmployees(
                Math.min(
                  1000000,
                  Math.max(1, Math.floor(Number(e.target.value) || 1)),
                ),
              )
            }
          />
          <span>employees</span>
        </label>
      </div>
      <div className="marketing-plan-grid">
        {plans.map((p) => {
          const base = annual ? p.priceAnnual : p.priceMonthly,
            per = annual ? p.pricePerEmployeeAnnual : p.pricePerEmployeeMonthly;
          const priced = base !== null || per !== null;
          const total = Math.max(
            (base ?? 0) + (per ?? 0) * employees,
            (p.minimumMonthly ?? 0) * (annual ? 12 : 1),
          );
          const overLimit =
            p.employeeLimit !== null && employees > p.employeeLimit;
          return (
            <article
              key={p.code}
              className={`marketing-plan ${p.code === "PROFESSIONAL" ? "marketing-plan-featured" : ""}`}
            >
              <p className="marketing-plan-kicker">
                {p.code === "PROFESSIONAL"
                  ? "CONNECTED HR & PAYROLL"
                  : p.code === "ENTERPRISE"
                    ? "FOR COMPLEX REQUIREMENTS"
                    : "YOUR EVERYDAY ESSENTIALS"}
              </p>
              <h2>{p.name}</h2>
              <p className="marketing-plan-description">{p.description}</p>
              <div className="marketing-plan-price">
                {priced && !overLimit ? (
                  <>
                    <strong>{money(per ?? base ?? 0, p.currency)}</strong>
                    <span>
                      /{per !== null ? "employee/" : ""}
                      {period}
                    </span>
                    {per !== null && base !== null && (
                      <p>
                        + {money(base, p.currency)} /{period} base fee
                      </p>
                    )}
                    <small>
                      Billed {annual ? "annually" : "monthly"} · Excludes tax
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Let’s talk</strong>
                    <small>
                      {overLimit
                        ? "Your team needs a larger plan or a custom quote."
                        : "A quote tailored to your team and requirements."}
                    </small>
                  </>
                )}
              </div>
              <Link href="/contact" className="marketing-button">
                Request a demo <ArrowUpRight size={16} />
              </Link>
              {priced && !overLimit && (
                <div className="marketing-plan-estimate" aria-live="polite">
                  <strong>
                    {money(total, p.currency)} /{period}
                  </strong>
                  <span>
                    Estimated for {employees} employees, excluding tax (
                    {p.taxRate}%).
                    {p.minimumMonthly
                      ? ` Minimum ${money(p.minimumMonthly, p.currency)}/month applies.`
                      : ""}
                  </span>
                </div>
              )}
              <p className="marketing-plan-limit">
                {p.employeeLimit
                  ? `Up to ${p.employeeLimit} employees`
                  : "No fixed employee limit"}
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>
                    <Check size={16} />
                    {labels[f] ?? f}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {!plans.length && (
        <p className="text-center">
          We’re preparing our plans.{" "}
          <Link href="/contact" className="marketing-text-link">
            Contact us for pricing.
          </Link>
        </p>
      )}
      <div className="marketing-pricing-note">
        <ShieldCheck size={19} />
        <p>
          {trial?.trialDays
            ? `Explore BlueCoreeHR with a ${trial.trialDays}-day free trial. `
            : "Explore BlueCoreeHR with a free trial. "}
          No card needed. <Link href="/start-trial">Start your trial →</Link>
        </p>
      </div>
      <section className="marketing-enterprise">
        <div>
          <h2>A larger team or a different requirement?</h2>
          <p>
            Tell us about your locations, employee count and the modules you
            need. We’ll help you find the right fit.
          </p>
        </div>
        <Link href="/contact" className="marketing-button">
          Talk to sales <ArrowUpRight size={16} />
        </Link>
      </section>
      {plans.length > 0 && (
        <section className="marketing-comparison">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow">THE DETAILS, SIDE BY SIDE</p>
            <h2>Find the right fit for your team.</h2>
          </div>
          <div
            className="marketing-comparison-scroll"
            role="region"
            aria-label="Plan feature comparison"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                Features included in each subscription plan
              </caption>
              <thead>
                <tr>
                  <th scope="col">Features</th>
                  {plans.map((p) => (
                    <th scope="col" key={p.code}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f}>
                    <th scope="row">{labels[f]}</th>
                    {plans.map((p) => (
                      <td key={p.code}>
                        {p.features.includes(f) ? (
                          <>
                            <Check aria-hidden="true" size={18} />
                            <span className="sr-only">Included</span>
                          </>
                        ) : (
                          <>
                            <Minus aria-hidden="true" size={18} />
                            <span className="sr-only">Not included</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data.addOns.length > 0 && (
        <section className="marketing-addons">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow">BUILD ON YOUR PLAN</p>
            <h2>Add what your team needs.</h2>
            <p>Optional modules, priced separately from your subscription.</p>
          </div>
          <div>
            {data.addOns.map((a) => (
              <article key={a.code}>
                <h3>{a.code === "AI_COPILOT" ? "Ask Me assistant" : a.name}</h3>
                <p>{a.description}</p>
                <strong>
                  {money(annual ? a.priceAnnual : a.priceMonthly)}{" "}
                  <small>
                    /{a.perEmployee ? "employee/" : ""}
                    {period}
                  </small>
                </strong>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="marketing-faq">
        <h2>A few things you may be wondering.</h2>
        {[
          [
            "How is my price calculated?",
            "When a plan has a per-employee price, the estimate adds that amount for every employee to the base fee. A configured minimum charge may apply. Add-ons and taxes are separate.",
          ],
          [
            "Can I try BlueCoreeHR before subscribing?",
            `Yes. ${trial?.trialDays ? `The free trial runs for ${trial.trialDays} days. ` : ""}You can start without a payment card and explore the trial features with your team.`,
          ],
          [
            "What if I need a custom plan?",
            "Use Talk to sales to share your employee count, locations and required modules. Our team can discuss the right plan for your organisation.",
          ],
          [
            "Are taxes included?",
            "Displayed prices exclude taxes. Your applicable tax rate is shown with the plan estimate, and the final amount is confirmed in your quote or invoice.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </>
  );
}
