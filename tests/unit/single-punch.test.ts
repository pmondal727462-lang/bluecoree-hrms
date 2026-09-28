import { describe, expect, it } from "vitest";
import { effectiveAttendanceStatus } from "../../src/modules/time/single-punch";

const now = new Date("2026-09-28T10:00:00Z");
const row = {
  workDate: new Date("2026-09-27"),
  checkOut: null,
  status: "PRESENT",
  scheduledEnd: new Date("2026-09-27T18:00:00Z"),
  _count: { punches: 1 },
};
const resolve = (policy: string, changes = {}) =>
  effectiveAttendanceStatus({ ...row, ...changes }, policy, "2026-09-28", now);
describe("single punch attendance policy", () => {
  it.each(["ABSENT", "PRESENT", "HALF_DAY", "MISSED_PUNCH"])(
    "resolves a completed past shift as %s",
    (policy) => {
      expect(resolve(policy)).toBe(policy);
      expect(resolve(policy, { status: "MISSED_PUNCH" })).toBe(policy);
    },
  );
  it("leaves active shifts, complete punches and reviewed statuses alone", () => {
    expect(resolve("ABSENT", { workDate: new Date("2026-09-28") })).toBe(
      "PRESENT",
    );
    expect(
      resolve("ABSENT", { scheduledEnd: new Date("2026-09-28T11:00:00Z") }),
    ).toBe("PRESENT");
    expect(
      resolve("ABSENT", { checkOut: new Date("2026-09-27T18:00:00Z") }),
    ).toBe("PRESENT");
    expect(resolve("ABSENT", { _count: { punches: 3 } })).toBe("PRESENT");
    expect(resolve("ABSENT", { status: "PENDING_REVIEW" })).toBe(
      "PENDING_REVIEW",
    );
    expect(resolve("PRESENT", { status: "HALF_DAY" })).toBe("HALF_DAY");
  });
});
