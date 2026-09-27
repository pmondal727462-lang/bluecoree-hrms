import { MarketingShell } from "@/components/marketing";
import { VerifySignup } from "@/components/marketing-forms";

// Email verification link from signup; creates the company on success.
export default async function Verify({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <MarketingShell>
      <section className="max-w-xl mx-auto px-4 py-12">
        <VerifySignup token={token} />
      </section>
    </MarketingShell>
  );
}
