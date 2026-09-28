import { MarketingShell } from "@/components/marketing";
import { Pricing } from "@/components/public-pricing";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="marketing-container marketing-pricing-page">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">YOUR TEAM. THE RIGHT PLAN.</p>
          <h1>
            Clear plans.
            <br />
            <em>Room to grow.</em>
          </h1>
          <p>
            Choose the tools your people need, from everyday attendance to
            connected HR and payroll.
          </p>
        </div>
        <Pricing />
      </section>
    </MarketingShell>
  );
}
