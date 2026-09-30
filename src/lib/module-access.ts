// Keep sidebar, home shortcuts and setup links aligned with effective access.
export const moduleFeatures: Record<string, string> = {
  workforce: "jobtracking",
  sites: "reports",
  "hr-copilot": "ai",
  attendance: "attendance",
  leave: "attendance",
  "time-settings": "attendance",
  payslips: "payroll",
  payroll: "payroll",
  expenses: "expenses",
  recruitment: "recruitment",
  performance: "performance",
  training: "training",
  assets: "assets",
  reports: "reports",
  onboarding: "onboarding",
  integrations: "api",
  dashboard: "reports",
  devices: "mobile",
};
type Subscription =
  { status: string; plan: { features: string[] } } | null | undefined;
export function moduleAllowed(subscription: Subscription, module: string) {
  const feature = moduleFeatures[module.split(/[?#]/)[0].replace(/^\//, "")];
  return (
    !feature ||
    !!(
      subscription &&
      subscription.status !== "EXPIRED" &&
      subscription.plan.features.includes(feature)
    )
  );
}
export function permissionFeature(permission: string) {
  const module = permission.split(".")[0];
  if (module === "ai") return "ai";
  if (module === "fieldtracking") return "livetracking";
  if (module === "biometric") return "biometric";
  return module === "timeoff" || module === "time"
    ? "attendance"
    : moduleFeatures[module];
}
// Role permissions never override a subscription. This also keeps module
// buttons and self-service pages aligned with the sidebar.
export function subscriptionPermissions(grants: string[], subscription: Subscription) {
  return grants.filter((permission) => {
    const feature = permissionFeature(permission);
    return !feature || !!(subscription && subscription.status !== "EXPIRED" && subscription.plan.features.includes(feature));
  });
}
