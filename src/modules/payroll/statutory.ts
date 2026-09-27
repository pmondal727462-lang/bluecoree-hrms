// Indian statutory payroll calculations. Defaults reflect FY 2025-26 rules as
// commonly applied; every rate is company-configurable and must be verified
// with the company's payroll adviser before filing.

export type PtSlab = {
  min: number;
  max: number | null;
  amount: number;
  februaryAmount?: number;
};
export type StatutoryConfig = {
  pfEnabled: boolean;
  pfWageCeiling: number;
  pfCapAtCeiling: boolean;
  pfEmployeeRate: number;
  pfEmployerRate: number;
  epsRate: number;
  edliRate: number;
  pfAdminRate: number;
  esiEnabled: boolean;
  esiWageThreshold: number;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  ptEnabled: boolean;
  ptSlabs: PtSlab[];
  tdsEnabled: boolean;
};
export const defaultStatutory: StatutoryConfig = {
  pfEnabled: true,
  pfWageCeiling: 15000,
  pfCapAtCeiling: true,
  pfEmployeeRate: 12,
  pfEmployerRate: 12,
  epsRate: 8.33,
  edliRate: 0.5,
  pfAdminRate: 0.5,
  esiEnabled: true,
  esiWageThreshold: 21000,
  esiEmployeeRate: 0.75,
  esiEmployerRate: 3.25,
  ptEnabled: false,
  ptSlabs: [],
  tdsEnabled: true,
};
// Starting points only; state PT rules change and must be confirmed.
export const ptTemplates: Record<string, PtSlab[]> = {
  "West Bengal": [
    { min: 0, max: 10000, amount: 0 },
    { min: 10000.01, max: 15000, amount: 110 },
    { min: 15000.01, max: 25000, amount: 130 },
    { min: 25000.01, max: 40000, amount: 150 },
    { min: 40000.01, max: null, amount: 200 },
  ],
  Maharashtra: [
    { min: 0, max: 7500, amount: 0 },
    { min: 7500.01, max: 10000, amount: 175 },
    { min: 10000.01, max: null, amount: 200, februaryAmount: 300 },
  ],
};

export type Structure = {
  basic: number;
  hra: number;
  conveyance?: number;
  specialAllowance: number;
  otherAllowance: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: "NEW" | "OLD";
  // Annual old-regime declarations.
  section80C: number;
  section80D: number;
  hraExemption: number;
  otherDeductions: number;
};
type Slab = { upTo: number | null; rate: number };
export type TaxRule = {
  standardDeduction: number;
  slabs: Slab[];
  rebateLimit: number;
  marginalRelief?: boolean;
  cessRate?: number;
  surchargeCap: number;
};
export type TaxTables = { NEW: TaxRule; OLD: TaxRule };
// FY 2025-26 income-tax slabs (Budget 2025). Payroll reads the effective
// statutory rules; these are the fallback and the test reference.
export const taxRules: TaxTables = {
  NEW: {
    marginalRelief: true,
    cessRate: 4,
    standardDeduction: 75000,
    slabs: [
      { upTo: 400000, rate: 0 },
      { upTo: 800000, rate: 5 },
      { upTo: 1200000, rate: 10 },
      { upTo: 1600000, rate: 15 },
      { upTo: 2000000, rate: 20 },
      { upTo: 2400000, rate: 25 },
      { upTo: null, rate: 30 },
    ] as Slab[],
    rebateLimit: 1200000,
    surchargeCap: 25,
  },
  OLD: {
    standardDeduction: 50000,
    slabs: [
      { upTo: 250000, rate: 0 },
      { upTo: 500000, rate: 5 },
      { upTo: 1000000, rate: 20 },
      { upTo: null, rate: 30 },
    ] as Slab[],
    rebateLimit: 500000,
    marginalRelief: false,
    cessRate: 4,
    surchargeCap: 37,
  },
};
const rupee = (v: number) => Math.round(v);
const up = (v: number) => Math.ceil(Math.round(v * 100) / 100);

function slabTax(income: number, slabs: Slab[]) {
  let tax = 0,
    lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Number.POSITIVE_INFINITY;
    if (income > lower)
      tax += ((Math.min(income, upper) - lower) * s.rate) / 100;
    lower = upper;
  }
  return tax;
}
// Annual tax including the section 87A rebate (with marginal relief under the
// new regime), surcharge above ₹50 lakh and 4% health and education cess.
export function annualTax(
  taxable: number,
  regime: "NEW" | "OLD",
  tables: TaxTables = taxRules,
) {
  const r = tables[regime];
  const income = Math.max(0, Math.floor(taxable));
  let tax = slabTax(income, r.slabs);
  if (income <= r.rebateLimit) tax = 0;
  else if (r.marginalRelief) tax = Math.min(tax, income - r.rebateLimit);
  const surchargeRate =
    income > 50000000
      ? Math.min(37, r.surchargeCap)
      : income > 20000000
        ? 25
        : income > 10000000
          ? 15
          : income > 5000000
            ? 10
            : 0;
  tax += (tax * surchargeRate) / 100;
  return rupee(tax * (1 + (r.cessRate ?? 4) / 100));
}
// Financial year runs April to March; months left including this one.
export function remainingMonths(period: string) {
  const month = Number(period.slice(5, 7));
  return month >= 4 ? 12 - (month - 4) : 4 - month;
}
export function financialYear(period: string) {
  const year = Number(period.slice(0, 4)),
    month = Number(period.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return {
    start,
    label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`,
  };
}
export function professionalTax(
  gross: number,
  slabs: PtSlab[],
  period: string,
) {
  const slab = slabs.find(
    (s) => gross >= s.min && (s.max === null || gross <= s.max),
  );
  if (!slab) return 0;
  return period.endsWith("-02") && slab.februaryAmount !== undefined
    ? slab.februaryAmount
    : slab.amount;
}

export type MonthInput = {
  period: string;
  structure: Structure;
  config: StatutoryConfig;
  paidDays: number;
  totalDays: number;
  // Taxable gross and TDS already paid earlier in this financial year.
  ytdTaxableGross: number;
  ytdTds: number;
  ytdEmployeePf: number;
  ytdPt: number;
  reimbursements?: number;
  otherDeductions?: number;
  // Variable pay for this month only (not projected for TDS).
  bonus?: number;
  incentive?: number;
  otherEarnings?: number;
  overtimePay?: number;
  encashmentPay?: number;
  loanDeduction?: number;
  advanceDeduction?: number;
  tax?: TaxTables;
};
export function calculateMonth(input: MonthInput) {
  const { structure: s, config: c } = input;
  const factor =
    input.totalDays > 0
      ? Math.min(1, Math.max(0, input.paidDays / input.totalDays))
      : 0;
  const earnings = {
    basic: rupee(s.basic * factor),
    hra: rupee(s.hra * factor),
    conveyance: rupee((s.conveyance ?? 0) * factor),
    specialAllowance: rupee(s.specialAllowance * factor),
    otherAllowance: rupee(s.otherAllowance * factor),
    bonus: rupee(input.bonus ?? 0),
    incentive: rupee(input.incentive ?? 0),
    overtime: rupee(input.overtimePay ?? 0),
    leaveEncashment: rupee(input.encashmentPay ?? 0),
    otherEarnings: rupee(input.otherEarnings ?? 0),
  };
  const gross = Object.values(earnings).reduce((a, b) => a + b, 0);
  const fullGross =
    s.basic +
    s.hra +
    (s.conveyance ?? 0) +
    s.specialAllowance +
    s.otherAllowance;

  const pfOn = c.pfEnabled && s.pfApplicable;
  const pfWage = pfOn
    ? c.pfCapAtCeiling
      ? Math.min(earnings.basic, c.pfWageCeiling)
      : earnings.basic
    : 0;
  const cappedWage = Math.min(pfWage, c.pfWageCeiling);
  const pfEmployee = rupee((pfWage * c.pfEmployeeRate) / 100);
  const employerTotal = rupee((pfWage * c.pfEmployerRate) / 100);
  const eps = pfOn
    ? Math.min(employerTotal, rupee((cappedWage * c.epsRate) / 100))
    : 0;
  const pf = {
    wage: pfWage,
    epsWage: cappedWage,
    employee: pfEmployee,
    employerEpf: employerTotal - eps,
    employerEps: eps,
    edli: pfOn ? rupee((cappedWage * c.edliRate) / 100) : 0,
    admin: pfOn ? rupee((pfWage * c.pfAdminRate) / 100) : 0,
  };

  // Coverage is decided on the full monthly wage; contributions on wages paid.
  const esiOn =
    c.esiEnabled &&
    s.esiApplicable &&
    fullGross <= c.esiWageThreshold &&
    gross > 0;
  const esi = {
    wage: esiOn ? gross : 0,
    employee: esiOn ? up((gross * c.esiEmployeeRate) / 100) : 0,
    employer: esiOn ? up((gross * c.esiEmployerRate) / 100) : 0,
  };

  const pt =
    c.ptEnabled && s.ptApplicable && gross > 0
      ? professionalTax(gross, c.ptSlabs, input.period)
      : 0;

  // TDS: tax on projected annual income, less tax already deducted, spread
  // across the months left in the financial year.
  const months = remainingMonths(input.period);
  const projectedGross =
    input.ytdTaxableGross + gross + fullGross * (months - 1);
  const tables = input.tax ?? taxRules;
  const rule = tables[s.taxRegime];
  let taxable = projectedGross - rule.standardDeduction;
  if (s.taxRegime === "OLD") {
    const projectedPf =
      input.ytdEmployeePf + pfEmployee + pfEmployee * (months - 1);
    const projectedPt = input.ytdPt + pt * months;
    taxable -=
      Math.min(150000, s.section80C + projectedPf) +
      s.section80D +
      s.hraExemption +
      s.otherDeductions +
      Math.min(2500, projectedPt);
  }
  const projectedTax = annualTax(Math.max(0, taxable), s.taxRegime, tables);
  const tds =
    c.tdsEnabled && gross > 0
      ? Math.max(0, rupee((projectedTax - input.ytdTds) / months))
      : 0;

  const reimbursements = rupee(input.reimbursements ?? 0);
  const other = rupee(input.otherDeductions ?? 0);
  // Loan and advance instalments never take net pay below zero.
  const statutory = pf.employee + esi.employee + pt + tds + other;
  const room = Math.max(0, gross - statutory);
  const loan = Math.min(rupee(input.loanDeduction ?? 0), room);
  const advance = Math.min(rupee(input.advanceDeduction ?? 0), room - loan);
  const deductions = statutory + loan + advance;
  return {
    factor,
    earnings,
    gross,
    pf,
    esi,
    pt,
    tds,
    projectedAnnualTaxable: Math.max(0, Math.floor(taxable)),
    projectedAnnualTax: projectedTax,
    reimbursements,
    otherDeductions: other,
    loanDeduction: loan,
    advanceDeduction: advance,
    deductions,
    netPay: gross - deductions + reimbursements,
    employerCost:
      gross +
      pf.employerEpf +
      pf.employerEps +
      pf.edli +
      pf.admin +
      esi.employer,
  };
}
