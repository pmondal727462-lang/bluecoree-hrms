import { Workspace } from "@/components/workspace";
import { notFound, redirect } from "next/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ report?: string }>;
}) {
  const { module } = await params;
  if (module === "hr-copilot") {
    const { report } = await searchParams;
    redirect(report === "attendance" ? "/attendance?ask=1&report=attendance" : "/home?ask=1");
  }
  if (
    ![
      "dashboard",
      "workforce",
      "sites",
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
