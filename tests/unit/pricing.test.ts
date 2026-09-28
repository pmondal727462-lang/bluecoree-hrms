import { describe, expect, it } from "vitest";
import {
  financialYearLabel,
  periodFrom,
  quote,
  type PricedPlan,
} from "../../src/modules/saas/pricing";

const plan: PricedPlan = {
  code: "PRO",
  name: "Professional",
  priceMonthly: 1000,
  priceAnnual: 10000,
  pricePerEmployeeMonthly: 50,
  pricePerEmployeeAnnual: 500,
  minimumMonthly: 3000,
  employeeLimit: 500,
  taxRate: 18,
};

describe("subscription pricing", () => {
  it("quotes annual per-employee pricing and rejects an unconfigured monthly cycle", () => {
    const annualOnly = {
      ...plan,
      priceMonthly: null,
      pricePerEmployeeMonthly: null,
      priceAnnual: 30000,
      pricePerEmployeeAnnual: 100,
      minimumMonthly: null,
    };
    expect(
      quote({
        plan: annualOnly,
        cycle: "ANNUAL",
        employees: 50,
        sameState: false,
      }).subtotal,
    ).toBe(35000);
    expect(
      quote({
        plan: { ...annualOnly, pricePerEmployeeAnnual: 150 },
        cycle: "ANNUAL",
        employees: 50,
        sameState: false,
      }).subtotal,
    ).toBe(37500);
    const tracking = {
      code: "LIVE_TRACKING",
      name: "Live Tracking",
      priceMonthly: null,
      priceAnnual: 150,
      perEmployee: true,
      quantity: 1,
    };
    expect(
      quote({
        plan: annualOnly,
        cycle: "ANNUAL",
        employees: 50,
        sameState: false,
        addOns: [tracking],
      }).subtotal,
    ).toBe(42500);
    expect(() =>
      quote({
        plan,
        cycle: "MONTHLY",
        employees: 50,
        sameState: false,
        addOns: [tracking],
      }),
    ).toThrow(/not offered for monthly/);
    expect(() =>
      quote({
        plan: annualOnly,
        cycle: "MONTHLY",
        employees: 50,
        sameState: false,
      }),
    ).toThrow(/no monthly price/);
  });
  it("applies the minimum monthly charge to small companies", () => {
    const q = quote({ plan, cycle: "MONTHLY", employees: 10, sameState: true });
    // 1000 + 10 × 50 = 1500, raised to the 3000 minimum.
    expect(q.lines.map((l) => l.amount)).toEqual([1000, 500, 1500]);
    expect(q.subtotal).toBe(3000);
    expect(q.cgst).toBe(270);
    expect(q.sgst).toBe(270);
    expect(q.igst).toBe(0);
    expect(q.total).toBe(3540);
  });

  it("charges per employee annually, with add-ons, a coupon and IGST", () => {
    const q = quote({
      plan,
      cycle: "ANNUAL",
      employees: 100,
      addOns: [
        {
          code: "AI",
          name: "AI Copilot",
          priceMonthly: 20,
          priceAnnual: 200,
          perEmployee: true,
          quantity: 1,
        },
        {
          code: "API",
          name: "API",
          priceMonthly: 1499,
          priceAnnual: 14990,
          perEmployee: false,
          quantity: 1,
        },
      ],
      coupon: { code: "LAUNCH10", percentOff: 10, amountOff: null },
      sameState: false,
    });
    // 10000 + 100 × 500 = 60000 (above the 36000 annual minimum),
    // + 100 × 200 + 14990 = 94990.
    expect(q.subtotal).toBe(94990);
    expect(q.discount).toBe(9499);
    expect(q.igst).toBe(15388.38);
    expect(q.cgst).toBe(0);
    expect(q.total).toBe(100879.38);
  });

  it("caps a fixed coupon at the subtotal and enforces the employee limit", () => {
    const q = quote({
      plan: { ...plan, minimumMonthly: null },
      cycle: "MONTHLY",
      employees: 1,
      coupon: { code: "FREE", percentOff: null, amountOff: 99999 },
      sameState: true,
    });
    expect(q.total).toBe(0);
    expect(() =>
      quote({ plan, cycle: "MONTHLY", employees: 501, sameState: true }),
    ).toThrow(/up to 500 employees/);
  });

  it("computes billing periods and financial years", () => {
    const start = new Date("2026-01-31T00:00:00Z");
    expect(periodFrom(start, "ANNUAL").end.toISOString().slice(0, 10)).toBe(
      "2027-01-31",
    );
    expect(financialYearLabel(new Date("2026-03-31"))).toBe("2025-26");
    expect(financialYearLabel(new Date("2026-04-01"))).toBe("2026-27");
  });
});
