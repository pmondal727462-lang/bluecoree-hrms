// Commercial packaging supplied by the owner. Notes distinguish requested
// roadmap capabilities from the capabilities currently implemented.
export type PricingBenefit = {
  label: string;
  note?: string;
  planned?: boolean;
  feature: string;
};
export const basicBenefits: PricingBenefit[] = [
  { label: "AI Face Recognition", feature: "face" },
  { label: "GPS Geofencing for location-based punches", feature: "attendance" },
  {
    label: "Mobile, Tablet & Auto Clock-in Options",
    note: "Mobile and tablet supported; auto clock-in planned",
    feature: "mobile",
  },
  { label: "Offline Time Capture", feature: "attendance" },
  { label: "Job-based Time Tracking", planned: true, feature: "attendance" },
  {
    label: "Spoof & Proxy Punch Detection",
    note: "Requires configured face verification and liveness provider",
    feature: "face",
  },
  { label: "Time Correction & Approval Workflows", feature: "attendance" },
  { label: "Basic Timesheets, Policies & Reports", feature: "reports" },
  { label: "Multi-site Dashboard & Controls", feature: "attendance" },
  { label: "Leave Management", feature: "attendance" },
];
export const advancedBenefits: PricingBenefit[] = [
  {
    label: "Shift & Job Scheduling",
    note: "Shift scheduling supported; job scheduling planned",
    feature: "attendance",
  },
  {
    label: "Activity Planning & Tracking",
    planned: true,
    feature: "attendance",
  },
  { label: "Overtime, Breaktime & Advanced Policies", feature: "attendance" },
  { label: "Advanced Reports & Insights", feature: "reports" },
  {
    label: "Contractor / Agency Management",
    planned: true,
    feature: "attendance",
  },
];
