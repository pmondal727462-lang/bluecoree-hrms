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
    note: "Automatic face scanning while the attendance page is open; requires a configured verification provider",
    feature: "mobile",
  },
  { label: "Offline Time Capture", feature: "attendance" },
  { label: "Job-based Time Tracking", feature: "jobtracking" },
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
    feature: "workplanning",
  },
  {
    label: "Activity Planning & Tracking",
    feature: "workplanning",
  },
  { label: "Overtime, Breaktime & Advanced Policies", feature: "attendance" },
  { label: "Advanced Reports & Insights", feature: "reports" },
  {
    label: "Contractor / Agency Management",
    feature: "contractors",
  },
];
