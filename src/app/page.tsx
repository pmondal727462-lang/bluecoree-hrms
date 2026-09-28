import Link from "next/link";
import Image from "next/image";
import { MarketingShell, modules } from "@/components/marketing";
import { product } from "@/config/product";

// Public home page; signed-in users use "Sign in" to reach their workspace.
export default function Home() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-4 py-16 grid lg:grid-cols-2 gap-10 items-center">
        <div className="space-y-6">
          <p className="eyebrow">HR, attendance and payroll in one place</p>
          <h1 className="text-3xl sm:text-5xl font-bold max-w-3xl">
            Run your people operations on {product.name}
          </h1>
          <p className="muted max-w-2xl text-lg">
            Attendance with face, GPS and biometric devices; statutory payroll
            with approval; recruitment, performance and learning; an AI HR
            Copilot; and a mobile app for every employee.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/start-trial"
              className="px-5 py-3 rounded-lg bg-[var(--primary,#1f4e99)] text-white font-semibold"
            >
              Start your free trial
            </Link>
            <Link
              href="/pricing"
              className="px-5 py-3 rounded-lg border border-[var(--border)] font-semibold"
            >
              See pricing
            </Link>
          </div>
          <p className="muted text-sm">
            No card needed for the trial. Your data stays yours: it is never
            deleted when a trial or subscription ends.
          </p>
        </div>
        <div className="relative">
          <Image
            src="/team-collaboration.png"
            alt="Colleagues collaborating in a bright office"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="rounded-3xl shadow-xl w-full h-auto"
          />
          <div className="card p-4 mt-4 flex justify-between gap-4 text-sm">
            <span>👥 One connected team</span>
            <span>🕒 Clear attendance</span>
            <span>📊 Confident payroll</span>
          </div>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link
            key={m.key}
            href={`/features#${m.key}`}
            className="card p-5 block"
          >
            <h2 className="font-semibold text-lg">{m.title}</h2>
            <p className="muted text-sm mt-1">{m.text}</p>
          </Link>
        ))}
      </section>
      <section className="max-w-6xl mx-auto px-4 py-16 grid gap-6 sm:grid-cols-3">
        {[
          [
            "Company-isolated",
            "Every company's data is separated in the database itself, not only in the application.",
          ],
          [
            "Built for India",
            "PF, ESI, PT and TDS, GST invoices, Indian holidays and financial years.",
          ],
          [
            "Open",
            "REST API, webhooks, accounting exports and SMS/WhatsApp notifications.",
          ],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-semibold">{t}</h3>
            <p className="muted text-sm mt-1">{d}</p>
          </div>
        ))}
      </section>
    </MarketingShell>
  );
}
