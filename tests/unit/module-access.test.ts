import { describe, expect, it } from "vitest";
import { moduleAllowed, permissionFeature, subscriptionPermissions } from "../../src/lib/module-access";
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
  it("limits the same role to the features purchased by Basic and Advanced", () => {
    const grants = ["profile.read", "attendance.self", "payroll.self", "expenses.self", "training.self", "performance.self", "assets.self", "ai.use", "fieldtracking.read"];
    expect(subscriptionPermissions(grants, basic)).toEqual(["profile.read", "attendance.self"]);
    const advanced = { status: "ACTIVE", plan: { features: [...basic.plan.features, "payroll", "expenses", "training", "performance", "assets", "ai", "livetracking"] } };
    expect(subscriptionPermissions(grants, advanced)).toEqual(grants);
    expect(subscriptionPermissions(grants, { ...advanced, status: "EXPIRED" })).toEqual(["profile.read"]);
    expect(moduleAllowed(basic, "training")).toBe(false);
    expect(moduleAllowed(advanced, "training")).toBe(true);
  });
});
