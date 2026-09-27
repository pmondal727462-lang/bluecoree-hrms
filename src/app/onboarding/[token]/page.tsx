import { OnboardingPortal } from "@/components/onboarding";

// Public pre-joining checklist, reached through the joiner's private link.
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OnboardingPortal token={token} />;
}
