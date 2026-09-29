import { describe, expect, it } from "vitest";
import { deductedBreakMinutes } from "../../src/modules/workforce/attendance";

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 8, 28, 9) + minutes * 60000);
describe("unpaid break deductions", () => {
  it("uses the scheduled minimum without double charging actual breaks", () => {
    expect(deductedBreakMinutes(60, [], at(540))).toBe(60);
    expect(
      deductedBreakMinutes(
        60,
        [{ startedAt: at(0), endedAt: at(30) }],
        at(540),
      ),
    ).toBe(60);
    expect(
      deductedBreakMinutes(
        60,
        [
          { startedAt: at(0), endedAt: at(40) },
          { startedAt: at(60), endedAt: at(120) },
        ],
        at(540),
      ),
    ).toBe(100);
  });
  it("ends an open break at checkout and combines fractional minutes before rounding", () => {
    expect(
      deductedBreakMinutes(0, [{ startedAt: at(0), endedAt: null }], at(90)),
    ).toBe(90);
    expect(
      deductedBreakMinutes(
        0,
        [
          { startedAt: at(0), endedAt: at(0.5) },
          { startedAt: at(1), endedAt: at(1.5) },
        ],
        at(10),
      ),
    ).toBe(1);
  });
});
