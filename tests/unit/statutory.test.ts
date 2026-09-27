import { describe, expect, it } from "vitest";
import {
  annualTax,
  calculateMonth,
  defaultStatutory,
  ptTemplates,
  remainingMonths,
  type Structure,
} from "../../src/modules/payroll/statutory";

const structure = (s: Partial<Structure>): Structure => ({
  basic: 0,
  hra: 0,
  specialAllowance: 0,
  otherAllowance: 0,
  pfApplicable: true,
  esiApplicable: true,
  ptApplicable: true,
  taxRegime: "NEW",
  section80C: 0,
  section80D: 0,
  hraExemption: 0,
  otherDeductions: 0,
  ...s,
});
const month = (s: Partial<Structure>, extra: Record<string, unknown> = {}) =>
  calculateMonth({
    period: "2026-04",
    structure: structure(s),
    config: { ...defaultStatutory, ptEnabled: true, ptSlabs: ptTemplates["West Bengal"] },
    paidDays: 30,
    totalDays: 30,
    ytdTaxableGross: 0,
    ytdTds: 0,
    ytdEmployeePf: 0,
    ytdPt: 0,
    ...extra,
  });

describe("Income tax", () => {
  it("applies the new regime rebate with marginal relief and cess", () => {
    expect(annualTax(1200000, "NEW")).toBe(0);
    expect(annualTax(1210000, "NEW")).toBe(10400);
    expect(annualTax(1500000, "NEW")).toBe(109200);
  });
  it("applies old regime slabs and rebate", () => {
    expect(annualTax(500000, "OLD")).toBe(0);
    expect(annualTax(1000000, "OLD")).toBe(117000);
  });
  it("counts months left in the April–March financial year", () => {
    expect(remainingMonths("2026-04")).toBe(12);
    expect(remainingMonths("2026-12")).toBe(4);
    expect(remainingMonths("2027-03")).toBe(1);
  });
});

describe("Monthly statutory deductions", () => {
  it("caps PF at the wage ceiling and splits EPS from EPF", () => {
    const r = month({ basic: 20000, hra: 8000, specialAllowance: 7000 });
    expect(r.gross).toBe(35000);
    expect(r.pf).toEqual({
      wage: 15000,
      epsWage: 15000,
      employee: 1800,
      employerEpf: 550,
      employerEps: 1250,
      edli: 75,
      admin: 75,
    });
    expect(r.esi.employee).toBe(0);
    expect(r.pt).toBe(150);
    expect(r.tds).toBe(0);
    expect(r.netPay).toBe(35000 - 1800 - 150);
  });
  it("applies ESI below the threshold, rounding contributions up", () => {
    const r = month({ basic: 10000, hra: 4000, specialAllowance: 4000 });
    expect(r.esi).toEqual({ wage: 18000, employee: 135, employer: 585 });
    expect(r.pf.employee).toBe(1200);
    expect(r.pf.employerEps).toBe(833);
    expect(r.pf.employerEpf).toBe(367);
  });
  it("prorates pay for unpaid days but decides ESI on the full wage", () => {
    const r = month(
      { basic: 20000, hra: 8000, specialAllowance: 7000 },
      { paidDays: 15 },
    );
    expect(r.gross).toBe(17500);
    expect(r.pf.employee).toBe(1200);
    expect(r.esi.employee).toBe(0);
  });
  it("spreads projected annual tax over the remaining months", () => {
    const r = month({ basic: 100000, specialAllowance: 50000, ptApplicable: false });
    expect(r.projectedAnnualTaxable).toBe(1725000);
    expect(r.projectedAnnualTax).toBe(150800);
    expect(r.tds).toBe(12567);
    const later = month(
      { basic: 100000, specialAllowance: 50000, ptApplicable: false },
      { period: "2027-03", ytdTaxableGross: 1650000, ytdTds: 138233 },
    );
    expect(later.tds).toBe(150800 - 138233);
  });
  it("uses the February amount for Maharashtra professional tax", () => {
    const r = calculateMonth({
      period: "2027-02",
      structure: structure({ basic: 20000 }),
      config: { ...defaultStatutory, ptEnabled: true, ptSlabs: ptTemplates.Maharashtra },
      paidDays: 28,
      totalDays: 28,
      ytdTaxableGross: 0,
      ytdTds: 0,
      ytdEmployeePf: 0,
      ytdPt: 0,
    });
    expect(r.pt).toBe(300);
  });
});
