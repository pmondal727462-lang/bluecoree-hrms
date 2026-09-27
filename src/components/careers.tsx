"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";

type Job = {
  id: string;
  title: string;
  location: string | null;
  employmentType: string;
  openings: number;
  closesOn: string | null;
  description: string;
  department: { name: string } | null;
};
type Careers = {
  company: {
    code: string;
    name: string;
    website: string | null;
    intro: string | null;
  };
  jobs: Job[];
};
async function pdfOf(file: File) {
  if (file.type !== "application/pdf")
    throw new Error("Upload your resume as a PDF.");
  if (file.size > 2 * 1024 * 1024)
    throw new Error("The resume must be 2 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
  return {
    name: file.name,
    type: file.type,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
}

// Public careers page for one company (no sign-in).
export function CareersPage({ code }: { code: string }) {
  const data = useQuery({
    queryKey: ["careers", code],
    queryFn: () => api<Careers>(`public/careers/${encodeURIComponent(code)}`),
    retry: false,
  });
  const [open, setOpen] = useState<string | null>(null);
  const d = data.data;
  if (data.error)
    return (
      <main className="max-w-3xl mx-auto p-6">
        <div className="card p-6 error">{data.error.message}</div>
      </main>
    );
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <header>
        <p className="eyebrow">Careers</p>
        <h1 className="text-2xl font-bold mt-2">Work at {d.company.name}</h1>
        {d.company.intro && (
          <p className="muted mt-3 whitespace-pre-line">{d.company.intro}</p>
        )}
      </header>
      {!d.jobs.length && (
        <div className="card p-6 empty">
          There are no open positions right now. Please check back later.
        </div>
      )}
      {d.jobs.map((j) => (
        <article key={j.id} className="card p-5 space-y-3">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{j.title}</h2>
              <p className="muted text-sm">
                {[
                  j.department?.name,
                  j.location,
                  j.employmentType,
                  j.openings > 1 ? `${j.openings} openings` : null,
                  j.closesOn ? `Apply by ${j.closesOn.slice(0, 10)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setOpen(open === j.id ? null : j.id)}
            >
              {open === j.id ? "Close" : "View and apply"}
            </Button>
          </div>
          {open === j.id && (
            <>
              <p className="text-sm whitespace-pre-line">{j.description}</p>
              <ApplyForm code={code} job={j} />
            </>
          )}
        </article>
      ))}
    </main>
  );
}

function ApplyForm({ code, job }: { code: string; job: Job }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  if (done) return <div className="card p-4 text-sm">{done}</div>;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 border-t border-[var(--border)] pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        setBusy(true);
        try {
          const resume = f.get("resume");
          if (!(resume instanceof File) || !resume.size)
            throw new Error("Attach your resume.");
          const exp = String(f.get("experienceYears") ?? "");
          const r = await api<{ message: string }>(
            `public/careers/${encodeURIComponent(code)}/jobs/${job.id}/apply`,
            {
              method: "POST",
              body: JSON.stringify({
                name: f.get("name"),
                email: f.get("email"),
                ...(f.get("phone") ? { phone: f.get("phone") } : {}),
                ...(f.get("currentCompany")
                  ? { currentCompany: f.get("currentCompany") }
                  : {}),
                ...(exp ? { experienceYears: Number(exp) } : {}),
                ...(f.get("coverNote")
                  ? { coverNote: f.get("coverNote") }
                  : {}),
                website: f.get("website") || undefined,
                consent: f.get("consent") === "on",
                resume: await pdfOf(resume),
              }),
            },
          );
          setDone(r.message);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Full name
        <input name="name" required minLength={2} maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" required maxLength={200} />
      </label>
      <label>
        Phone
        <input name="phone" maxLength={30} />
      </label>
      <label>
        Current company
        <input name="currentCompany" maxLength={120} />
      </label>
      <label>
        Years of experience
        <input
          name="experienceYears"
          type="number"
          min={0}
          max={60}
          step={0.5}
        />
      </label>
      <label>
        Resume (PDF, up to 2 MB)
        <input name="resume" type="file" accept="application/pdf" required />
      </label>
      <label className="sm:col-span-2">
        Cover note
        <textarea name="coverNote" maxLength={2000} rows={3} />
      </label>
      {/* Hidden from people; bots fill it in. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <label className="sm:col-span-2 flex items-start gap-2 text-sm">
        <input name="consent" type="checkbox" required className="mt-1" />
        <span>
          I agree that the company may store and process my application details
          and resume for recruitment.
        </span>
      </label>
      {error && <div className="error sm:col-span-2">{error}</div>}
      <div className="sm:col-span-2">
        <Button disabled={busy}>
          {busy ? "Sending…" : "Submit application"}
        </Button>
      </div>
    </form>
  );
}

type Offer = {
  company: string;
  candidate: string;
  role: string;
  department: string | null;
  annualCtc: number;
  joiningDate: string;
  expiresOn: string;
  terms: string | null;
  status: string;
};
// Candidate's private offer link.
export function OfferResponse({ token }: { token: string }) {
  const data = useQuery({
    queryKey: ["offer", token],
    queryFn: () => api<Offer>(`public/offers/${token}`),
    retry: false,
  });
  const [note, setNote] = useState(""),
    [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const o = data.data;
  if (data.error)
    return <div className="card p-6 m-6 error">{data.error.message}</div>;
  if (!o) return <div className="empty">Loading…</div>;
  const respond = async (decision: "ACCEPT" | "DECLINE") => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ status: string }>(`public/offers/${token}`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      });
      setResult(
        r.status === "ACCEPTED"
          ? "Thank you for accepting. The team will contact you about joining formalities."
          : "Your response has been recorded. Thank you for letting us know.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  return (
    <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <p className="eyebrow">{o.company}</p>
        <h1 className="text-2xl font-bold mt-2">Your offer, {o.candidate}</h1>
      </div>
      <section className="card p-5 space-y-2 text-sm">
        <p>
          <strong>Role:</strong> {o.role}
          {o.department ? ` · ${o.department}` : ""}
        </p>
        <p>
          <strong>Annual cost to company:</strong> {inr.format(o.annualCtc)}
        </p>
        <p>
          <strong>Joining date:</strong> {o.joiningDate.slice(0, 10)}
        </p>
        <p>
          <strong>Respond by:</strong> {o.expiresOn.slice(0, 10)}
        </p>
        {o.terms && <p className="whitespace-pre-line pt-2">{o.terms}</p>}
      </section>
      {result ? (
        <div className="card p-4 text-sm">{result}</div>
      ) : o.status === "SENT" ? (
        <section className="card p-5 space-y-3">
          <label>
            Message to the company (optional)
            <textarea
              value={note}
              maxLength={1000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => respond("ACCEPT")}>
              Accept offer
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => respond("DECLINE")}
            >
              Decline
            </Button>
          </div>
        </section>
      ) : (
        <div className="card p-4 text-sm">
          {o.status === "ACCEPTED"
            ? "You have accepted this offer."
            : o.status === "DECLINED"
              ? "You have declined this offer."
              : o.status === "EXPIRED"
                ? "This offer has expired. Please contact the company."
                : "This offer is no longer available."}
        </div>
      )}
    </main>
  );
}
