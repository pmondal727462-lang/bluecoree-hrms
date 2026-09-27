import { MarketingShell } from "@/components/marketing";
import { ContactForm } from "@/components/marketing-forms";

export const metadata = { title: "Contact" };

export default function Contact() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-4 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Talk to us</h1>
        <p className="muted">
          Questions about pricing, migration or large deployments? Leave your
          details and we will reply within one working day.
        </p>
        <ContactForm />
      </section>
    </MarketingShell>
  );
}
