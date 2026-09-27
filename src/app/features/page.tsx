import Link from "next/link";
import { MarketingShell, modules } from "@/components/marketing";

export const metadata = { title: "Features" };

export default function Features() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-4 py-12 space-y-10">
        <h1 className="text-3xl font-bold">Everything HR, in one system</h1>
        {modules.map((m) => (
          <article key={m.key} id={m.key} className="card p-6 scroll-mt-20">
            <h2 className="text-xl font-semibold">{m.title}</h2>
            <p className="muted mt-1">{m.text}</p>
            <ul className="list-disc pl-5 mt-3 space-y-1 text-sm">
              {m.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </article>
        ))}
        <Link href="/start-trial" className="font-semibold underline">
          Try it free →
        </Link>
      </section>
    </MarketingShell>
  );
}
