import { MarketingShell } from "@/components/marketing";
import { StartTrialForm } from "@/components/marketing-forms";

export const metadata = { title: "Start free trial" };

export default function StartTrial() {
  return (
    <MarketingShell>
      <section className="max-w-xl mx-auto px-4 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Start your free trial</h1>
        <p className="muted">
          Full access during the trial. No card needed. Your data is kept if you
          decide not to continue.
        </p>
        <StartTrialForm />
      </section>
    </MarketingShell>
  );
}
