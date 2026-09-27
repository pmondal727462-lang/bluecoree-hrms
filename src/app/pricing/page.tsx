import { MarketingShell } from "@/components/marketing";
import { Pricing } from "@/components/marketing-forms";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-4 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Simple, per-employee pricing</h1>
        <p className="muted">
          Pay monthly or annually. Add only the modules you need. Prices exclude
          GST.
        </p>
        <Pricing />
      </section>
    </MarketingShell>
  );
}
