import Link from "next/link";
import { MarketingShell } from "@/components/marketing";

export const metadata = { title: "Resources" };

const faq: [string, string][] = [
  [
    "How long is the free trial?",
    "The trial length is shown on the pricing page. You can buy a plan at any time during or after the trial.",
  ],
  [
    "What happens when the trial ends?",
    "Paid modules pause and your data is kept. Nothing is deleted automatically; choose a plan to continue.",
  ],
  [
    "How is the price calculated?",
    "A plan price plus a per-employee price for active employees, with a minimum monthly charge, plus any add-ons, less coupons, plus GST.",
  ],
  [
    "Do you store card details?",
    "No. Payments are made with the payment provider; we keep only the payment reference and status.",
  ],
  [
    "Can we connect our biometric devices?",
    "Yes. ZKTeco/eSSL (ADMS push), Hikvision event push, Suprema BioStar 2 and a generic JSON push are supported.",
  ],
  [
    "Is there an API?",
    "Yes. A REST API with scoped keys, webhooks and an accounting journal export. See the API reference.",
  ],
];

export default function Resources() {
  return (
    <MarketingShell>
      <section className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        <h1 className="text-3xl font-bold">Resources</h1>
        <div className="card p-6 space-y-2">
          <h2 className="font-semibold">Developers</h2>
          <p className="text-sm">
            <Link className="underline" href="/api-docs">
              API reference
            </Link>{" "}
            · machine-readable OpenAPI at <code>/api/docs</code>
          </p>
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Frequently asked questions</h2>
          {faq.map(([q, a]) => (
            <details key={q} className="card p-4">
              <summary className="font-semibold cursor-pointer">{q}</summary>
              <p className="muted text-sm mt-2">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
