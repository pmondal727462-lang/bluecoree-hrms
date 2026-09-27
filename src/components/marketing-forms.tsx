"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";

type PublicPlan = {
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
type PublicAddOn = {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceAnnual: number;
  perEmployee: boolean;
};
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
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
  ai: "AI Copilot",
  mobile: "Mobile app",
  reports: "Reports",
  api: "API & integrations",
  whitelabel: "White label",
};

// Plans and add-ons from the Super Admin's configuration, with an estimate.
export function Pricing() {
  const [data, setData] = useState<{
    plans: PublicPlan[];
    addOns: PublicAddOn[];
  } | null>(null);
  const [annual, setAnnual] = useState(false);
  const [employees, setEmployees] = useState(50);
  useEffect(() => {
    api<{ plans: PublicPlan[]; addOns: PublicAddOn[] }>("public/plans")
      .then(setData)
      .catch(() => setData({ plans: [], addOns: [] }));
  }, []);
  if (!data) return <p className="muted">Loading prices…</p>;
  const estimate = (p: PublicPlan) => {
    const flat = (annual ? p.priceAnnual : p.priceMonthly) ?? 0;
    const per =
      (annual ? p.pricePerEmployeeAnnual : p.pricePerEmployeeMonthly) ?? 0;
    const min = (p.minimumMonthly ?? 0) * (annual ? 12 : 1);
    return Math.max(flat + per * employees, min);
  };
  const trial = data.plans.find((p) => p.code === "FREE_TRIAL");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-6 items-end">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="w-auto"
            checked={annual}
            onChange={(e) => setAnnual(e.target.checked)}
          />
          Pay annually
        </label>
        <label>
          Employees
          <input
            type="number"
            min={1}
            value={employees}
            onChange={(e) =>
              setEmployees(Math.max(1, Number(e.target.value) || 1))
            }
          />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {data.plans
          .filter((p) => p.code !== "FREE_TRIAL")
          .map((p) => {
            const priced =
              p.priceMonthly !== null || p.pricePerEmployeeMonthly !== null;
            return (
              <article key={p.code} className="card p-6 space-y-3">
                <h2 className="text-xl font-semibold">{p.name}</h2>
                <p className="muted text-sm">{p.description}</p>
                {priced ? (
                  <>
                    <p className="text-2xl font-bold">
                      {inr(estimate(p))}
                      <span className="text-sm font-normal muted">
                        /{annual ? "year" : "month"}
                      </span>
                    </p>
                    <p className="muted text-xs">
                      For {employees} employees, excluding GST ({p.taxRate}%).
                      {p.pricePerEmployeeMonthly
                        ? ` ${inr((annual ? p.pricePerEmployeeAnnual : p.pricePerEmployeeMonthly) ?? 0)} per employee.`
                        : ""}
                      {p.minimumMonthly
                        ? ` Minimum ${inr(p.minimumMonthly)}/month.`
                        : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-2xl font-bold">Talk to us</p>
                )}
                <p className="text-sm">
                  {p.employeeLimit
                    ? `Up to ${p.employeeLimit} employees`
                    : "Unlimited employees"}
                </p>
                <ul className="text-sm list-disc pl-5">
                  {p.features.map((f) => (
                    <li key={f}>{labels[f] ?? f}</li>
                  ))}
                </ul>
                <Link
                  href={priced ? "/start-trial" : "/contact"}
                  className="font-semibold underline"
                >
                  {priced ? "Start free trial" : "Contact sales"}
                </Link>
              </article>
            );
          })}
      </div>
      {trial?.trialDays && (
        <p className="text-sm">
          Every plan starts with a {trial.trialDays}-day free trial with full
          access. No card needed.
        </p>
      )}
      {data.addOns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Add-ons</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {data.addOns.map((a) => (
              <div key={a.code} className="card p-4">
                <div className="font-semibold">{a.name}</div>
                <p className="muted text-sm">{a.description}</p>
                <p className="text-sm mt-1">
                  {inr(annual ? a.priceAnnual : a.priceMonthly)}
                  {a.perEmployee ? " per employee" : ""}/
                  {annual ? "year" : "month"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ContactForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  if (done)
    return (
      <div className="card p-6">
        Thank you. We will get back to you within one working day.
      </div>
    );
  return (
    <form
      className="card p-6 grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        try {
          await api("public/contact", {
            method: "POST",
            body: JSON.stringify({
              name: f.get("name"),
              email: f.get("email"),
              ...(f.get("company") ? { company: f.get("company") } : {}),
              ...(f.get("phone") ? { phone: f.get("phone") } : {}),
              ...(f.get("employees")
                ? { employees: Number(f.get("employees")) }
                : {}),
              message: f.get("message"),
              website: f.get("website") || undefined,
            }),
          });
          setDone(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        Name
        <input name="name" required minLength={2} />
      </label>
      <label>
        Work email
        <input name="email" type="email" required />
      </label>
      <label>
        Company
        <input name="company" />
      </label>
      <label>
        Phone
        <input name="phone" />
      </label>
      <label>
        Employees
        <input name="employees" type="number" min={1} />
      </label>
      <input
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <label className="sm:col-span-2">
        How can we help?
        <textarea name="message" required minLength={5} rows={4} />
      </label>
      {error && <div className="error sm:col-span-2">{error}</div>}
      <div className="sm:col-span-2">
        <Button>Send</Button>
      </div>
    </form>
  );
}

export function StartTrialForm() {
  const [sent, setSent] = useState<{
    message: string;
    devLink?: string;
  } | null>(null);
  const [error, setError] = useState("");
  if (sent)
    return (
      <div className="card p-6 space-y-2">
        <p>{sent.message}</p>
        {sent.devLink && (
          <p className="text-sm muted">
            Email is not configured on this server. Development link:{" "}
            <a className="underline break-all" href={sent.devLink}>
              {sent.devLink}
            </a>
          </p>
        )}
      </div>
    );
  return (
    <form
      className="card p-6 grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        try {
          setSent(
            await api("public/signup", {
              method: "POST",
              body: JSON.stringify({
                companyName: f.get("companyName"),
                adminName: f.get("adminName"),
                email: f.get("email"),
                ...(f.get("phone") ? { phone: f.get("phone") } : {}),
                password: f.get("password"),
                timezone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone ||
                  "Asia/Kolkata",
                acceptTerms: f.get("acceptTerms") === "on",
                website: f.get("website") || undefined,
              }),
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        Company name
        <input name="companyName" required minLength={2} />
      </label>
      <label>
        Your name
        <input name="adminName" required minLength={2} />
      </label>
      <label>
        Work email
        <input name="email" type="email" required />
      </label>
      <label>
        Phone
        <input name="phone" />
      </label>
      <label>
        Password (at least 12 characters)
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={72}
        />
      </label>
      <input
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          name="acceptTerms"
          type="checkbox"
          required
          className="w-auto mt-1"
        />
        <span>I agree to the terms of service and privacy policy.</span>
      </label>
      {error && <div className="error">{error}</div>}
      <Button>Create my trial</Button>
      <p className="muted text-xs">
        We will email you a link to verify your address before the company is
        created.
      </p>
    </form>
  );
}

export function VerifySignup({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; code?: string }>({});
  useEffect(() => {
    api<{ companyCode: string }>("public/signup/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((r) => setState({ code: r.companyCode }))
      .catch((e: Error) => setState({ error: e.message }));
  }, [token]);
  if (state.error) return <div className="card p-6 error">{state.error}</div>;
  if (!state.code) return <p className="muted">Verifying…</p>;
  return (
    <div className="card p-6 space-y-3">
      <h1 className="text-xl font-bold">Your company is ready</h1>
      <p>
        Your company code is <strong>{state.code}</strong>. You will need it to
        sign in, so keep it safe.
      </p>
      <Button onClick={() => router.push("/dashboard")}>
        Set up my company
      </Button>
    </div>
  );
}
