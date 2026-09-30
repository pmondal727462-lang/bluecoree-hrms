// The employee portal exposes self-service only. Administrative roles retain
// their configured permissions and workspace.
export const employeePermissions = [
  "profile.read",
  "profile.write",
  "attendance.self",
  "timeoff.self",
  "payroll.self",
  "expenses.self",
  "performance.self",
  "training.self",
  "assets.self",
] as const;
export const employeePages: Record<string, string> = {
  profile: "My profile",
  attendance: "My attendance",
  leave: "Leave & apply leave",
  payslips: "Payslip downloads",
  home: "Check in / Check out",
  workforce: "My jobs & time",
  expenses: "My expenses",
  performance: "My performance",
  training: "My training",
  assets: "My assets",
};
export function isEmployeePortal(user: {
  roleName: string;
  isSuperAdmin: boolean;
}) {
  return !user.isSuperAdmin && user.roleName === "Employee";
}
export function effectivePermissions(
  user: { roleName: string; isSuperAdmin: boolean },
  grants: string[],
) {
  return isEmployeePortal(user)
    ? grants.filter((p) =>
        (employeePermissions as readonly string[]).includes(p),
      )
    : grants;
}

export function employeeApiAllowed(path: string[]) {
  if (path[0] === "v1")
    return [
      "profile",
      "attendance",
      "leave",
      "leave-balances",
      "expenses",
      "performance",
      "training",
      "assets",
      "payslips",
      "face",
      "devices",
      "push-token",
      "geofence-events",
      "field-tracking",
      "notifications",
    ].includes(path[1]);
  if (path.join("/") === "company/settings/logo") return true;
  return [
    "auth",
    "profile",
    "time",
    "payroll",
    "face",
    "notifications",
    "workforce",
    "expenses",
    "performance",
    "training",
    "assets",
  ].includes(path[0]);
}
