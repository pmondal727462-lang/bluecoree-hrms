import { MarketingShell } from "@/components/marketing";
import { ContactForm } from "@/components/marketing-forms";
import { salesContact } from "@/config/sales";

export const metadata = { title: "Contact" };

export default function Contact() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-4 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Talk to us or request a demo</h1>
        <p className="muted">
          Questions about pricing, migration or large deployments? Leave your
          details and we will reply within one working day.
        </p>
        <ContactForm />
        <div className="flex gap-5 flex-wrap">
          <a className="underline" href={`mailto:${salesContact.email}`}>
            {salesContact.email}
          </a>
          <a
            className="underline"
            href={salesContact.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp: +91 7003904693
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
