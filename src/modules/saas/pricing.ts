// Subscription pricing (spec §46-47): flat and per-employee prices,
// minimum monthly charge, add-ons, coupon and GST. Amounts are computed in
// paise and returned in rupees with two decimals.
export type Cycle = "MONTHLY" | "ANNUAL";
type Money = number | string | { toString(): string } | null | undefined;
export type PricedPlan = {
  code: string;
  name: string;
  priceMonthly: Money;
  priceAnnual: Money;
  pricePerEmployeeMonthly: Money;
  pricePerEmployeeAnnual: Money;
  minimumMonthly: Money;
  employeeLimit: number | null;
  taxRate: Money;
};
export type PricedAddOn = {
  code: string;
  name: string;
  priceMonthly: Money;
  priceAnnual: Money;
  perEmployee: boolean;
  quantity: number;
};
export type PricedCoupon = {
  code: string;
  percentOff: Money;
  amountOff: Money;
} | null;
export type Line = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

const paise = (v: Money) =>
  v === null || v === undefined ? 0 : Math.round(Number(v.toString()) * 100);
const rupees = (p: number) => Math.round(p) / 100;

export function quote(input: {
  plan: PricedPlan;
  cycle: Cycle;
  employees: number;
  addOns?: PricedAddOn[];
  coupon?: PricedCoupon;
  // GST: the same state as the supplier is CGST + SGST, otherwise IGST.
  sameState: boolean;
}) {
  const { plan, cycle, employees } = input;
  const annual = cycle === "ANNUAL";
  if (plan.employeeLimit !== null && employees > plan.employeeLimit)
    throw new Error(
      `The ${plan.name} plan allows up to ${plan.employeeLimit} employees.`,
    );
  const lines: Line[] = [];
  const add = (description: string, quantity: number, unit: number) => {
    if (unit <= 0 || quantity <= 0) return;
    lines.push({
      description,
      quantity,
      unitPrice: rupees(unit),
      amount: rupees(unit * quantity),
    });
  };
  const period = annual ? "annual" : "monthly";
  add(
    `${plan.name} plan (${period})`,
    1,
    paise(annual ? plan.priceAnnual : plan.priceMonthly),
  );
  add(
    `${plan.name} per employee (${period})`,
    employees,
    paise(annual ? plan.pricePerEmployeeAnnual : plan.pricePerEmployeeMonthly),
  );
  // The minimum charge applies to the plan, before add-ons.
  const planTotal = lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const minimum = paise(plan.minimumMonthly) * (annual ? 12 : 1);
  if (minimum > planTotal)
    add("Minimum plan charge adjustment", 1, minimum - planTotal);
  for (const a of input.addOns ?? []) {
    const qty = a.perEmployee ? employees : a.quantity;
    add(
      `${a.name} add-on (${period})`,
      qty,
      paise(annual ? a.priceAnnual : a.priceMonthly),
    );
  }
  const subtotal = lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const c = input.coupon;
  const discount = !c
    ? 0
    : Math.min(
        subtotal,
        c.percentOff !== null && c.percentOff !== undefined
          ? Math.round((subtotal * Number(c.percentOff.toString())) / 100)
          : paise(c.amountOff),
      );
  const taxable = subtotal - discount;
  const rate = Number((plan.taxRate ?? 0).toString());
  const tax = Math.round((taxable * rate) / 100);
  const half = Math.floor(tax / 2);
  return {
    cycle,
    employees,
    lines,
    subtotal: rupees(subtotal),
    discount: rupees(discount),
    taxRate: rate,
    cgst: input.sameState ? rupees(half) : 0,
    sgst: input.sameState ? rupees(tax - half) : 0,
    igst: input.sameState ? 0 : rupees(tax),
    total: rupees(taxable + tax),
    couponCode: c?.code ?? null,
  };
}
export type Quote = ReturnType<typeof quote>;

// Period covered by a payment made now.
export function periodFrom(start: Date, cycle: Cycle) {
  const end = new Date(start);
  if (cycle === "ANNUAL") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}
// Indian financial year label for invoice numbering, e.g. 2026-27.
export function financialYearLabel(d: Date) {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
