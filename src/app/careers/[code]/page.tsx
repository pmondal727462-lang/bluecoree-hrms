import { CareersPage } from "@/components/careers";

// Public careers page: open positions and applications, without sign-in.
export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <CareersPage code={code} />;
}
