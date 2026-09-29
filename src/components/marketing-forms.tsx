"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { salesContact } from "@/config/sales";

export function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  if (done)
    return (
      <div className="card p-6">
        <p>
          Thank you. Your enquiry has been saved. Our team will contact you.
        </p>
        <a
          className="underline inline-block mt-3"
          href={salesContact.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Chat with BlueCoreeHR on WhatsApp
        </a>
      </div>
    );
  return (
    <form
      className="card p-6 grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        setBusy(true);
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
              message: `${f.get("requestType")}: ${f.get("message")}`,
              website: f.get("website") || undefined,
            }),
          });
          setDone(true);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
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
        <input name="phone" type="tel" required maxLength={30} />
      </label>
      <label>
        Employees
        <input name="employees" type="number" min={1} />
      </label>
      <label>
        I would like to
        <select name="requestType" defaultValue="Request a demo">
          <option>Request a demo</option>
          <option>Talk to sales</option>
        </select>
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
        <textarea
          name="message"
          required
          minLength={5}
          maxLength={2900}
          rows={4}
        />
      </label>
      {error && <div className="error sm:col-span-2">{error}</div>}
      <div className="sm:col-span-2">
        <p className="muted text-xs mb-3">
          Your details will be shared with the BlueCoreeHR sales team by email
          and WhatsApp so we can respond to your enquiry.
        </p>
        <Button disabled={busy}>{busy ? "Sending…" : "Send enquiry"}</Button>
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
