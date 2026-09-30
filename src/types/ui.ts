export type Named = { id: string; name: string };
export type Branding = {
  companyCode: string;
  brandName: string | null;
  portalTitle: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  loginMessage: string | null;
  logoUrl: string | null;
  emailFooter?: string | null;
  payslipFooter?: string | null;
};
export type Me = {
  userId: string;
  companyId: string;
  name: string;
  roleId: string;
  roleName: string;
  isSuperAdmin: boolean;
  permissions: string[];
  sessionId: string;
  mfaSetupRequired?: boolean;
  passwordChangeRequired?: boolean;
  temporaryPassword?: boolean;
  subscription?: {
    status: "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED";
    plan: { code: string; name: string; features: string[] };
    endsAt: string | null;
    graceEndsAt: string | null;
  } | null;
  branding?: Branding | null;
  companyLogoUrl?: string | null;
  platformRole?: "super" | "staff" | null;
  company: Named & { code: string; timezone?: string; dateFormat?: string };
};
export type Row = { id: string; [key: string]: unknown };
export type PageData = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
};
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "date"
    | "datetime-local"
    | "number"
    | "select"
    | "textarea"
    | "password";
  required?: boolean;
  options?: { value: string; label: string }[];
  section?: string;
  maxLength?: number;
  reference?:
    "employees" | "users" | "departments" | "designations" | "branches";
  excludeId?: string;
};
