import { describe, expect, it } from "vitest";
import { moduleAllowed, permissionFeature } from "../../src/lib/module-access";
describe("subscription-only module visibility", () => {
  const basic = {
    status: "ACTIVE",
    plan: {
      features: ["attendance", "mobile", "reports", "face", "jobtracking"],
    },
  };
  it("shows purchased modules and hides unrelated shortcuts including devices", () => {
    expect(moduleAllowed(basic, "/attendance?ask=1")).toBe(true);
    expect(moduleAllowed(basic, "workforce")).toBe(true);
    expect(moduleAllowed(basic, "/payroll")).toBe(false);
    expect(moduleAllowed(basic, "expenses")).toBe(false);
    expect(moduleAllowed({ ...basic, plan: { features: [] } }, "devices")).toBe(
      false,
    );
  });
  it("keeps essential account pages accessible and hides paid modules after expiry", () => {
    expect(moduleAllowed({ ...basic, status: "EXPIRED" }, "attendance")).toBe(
      false,
    );
    expect(moduleAllowed(null, "attendance")).toBe(false);
    expect(moduleAllowed(null, "profile")).toBe(true);
    expect(moduleAllowed(null, "subscription")).toBe(true);
    expect(permissionFeature("timeoff.manage")).toBe("attendance");
    expect(permissionFeature("payroll.self")).toBe("payroll");
  });
});
