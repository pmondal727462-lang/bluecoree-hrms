import { Workspace } from "@/components/workspace";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (
    ![
      "dashboard",
      "hr-copilot",
      "attendance",
      "leave",
      "time-settings",
      "payslips",
      "devices",
      "integrations",
      "security",
      "subscription",
      "support",
      "platform",
      "admin",
      "lifecycle",
      "home",
      "documents",
      "helpdesk",
      "onboarding",
      "payroll",
      "expenses",
      "recruitment",
      "performance",
      "training",
      "assets",
      "reports",
      "employees",
      "organization",
      "users",
      "roles",
      "profile",
      "company",
      "companies",
      "sessions",
      "audit",
    ].includes(module)
  )
    notFound();
  return <Workspace module={module} />;
}
