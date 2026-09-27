import { OfferResponse } from "@/components/careers";

// A candidate views and answers an offer through a private link.
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OfferResponse token={token} />;
}
