import { describe, expect, it } from "vitest";
import { completeDay, shiftSnapshot } from "../../src/modules/time/rules";

const shift = {
  name: "General",
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  graceMinutes: 15,
  breakMinutes: 60,
  kind: "FIXED",
  minimumMinutes: 480,
  halfDayMinutes: 240,
  earlyExitGraceMinutes: 10,
  overtimeAfterMinutes: 30,
};
const at = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00Z`);
const day = (checkIn: string, checkOut: string, extra = {}) =>
  completeDay({
    checkIn: at(checkIn),
    checkOut: at(checkOut),
    breakMinutes: 60,
    expectedMinutes: 480,
    scheduledEnd: at("18:00"),
    shift,
    offDay: false,
    overtimeRequiresApproval: false,
    ...extra,
  });

describe("attendance rule engine", () => {
  it("marks late only after the grace period", () => {
    expect(shiftSnapshot(at("09:15"), "UTC", shift).lateMinutes).toBe(0);
    expect(shiftSnapshot(at("09:16"), "UTC", shift).lateMinutes).toBe(16);
  });

  it("derives present, half day and short from worked minutes", () => {
    expect(day("09:00", "18:00")).toMatchObject({
      workedMinutes: 480,
      status: "PRESENT",
    });
    expect(day("09:00", "15:00").status).toBe("HALF_DAY");
    expect(day("09:00", "12:00").status).toBe("SHORT");
  });

  it("records early exit beyond its grace", () => {
    expect(day("09:00", "17:55").earlyExitMinutes).toBe(0);
    expect(day("09:00", "17:40").earlyExitMinutes).toBe(20);
  });

  it("counts overtime only past the threshold and applies approval", () => {
    expect(day("09:00", "18:20").overtimeMinutes).toBe(0);
    expect(day("09:00", "19:00")).toMatchObject({
      overtimeMinutes: 60,
      overtimeStatus: "APPROVED",
      approvedOvertimeMinutes: 60,
    });
    expect(
      day("09:00", "19:00", { overtimeRequiresApproval: true }),
    ).toMatchObject({ overtimeStatus: "PENDING", approvedOvertimeMinutes: 0 });
  });

  it("treats all work on an off day as overtime without early exit", () => {
    expect(day("10:00", "13:00", { offDay: true })).toMatchObject({
      workedMinutes: 120,
      overtimeMinutes: 120,
      earlyExitMinutes: 0,
      status: "PRESENT",
    });
  });

  it("keeps a rostered night shift on its own work date", () => {
    const night = { ...shift, startMinute: 22 * 60, endMinute: 7 * 60 };
    // Without a roster date, 02:00 belongs to the previous night.
    expect(
      shiftSnapshot(at("02:00"), "UTC", night).workDate.toISOString(),
    ).toBe("2026-09-13T00:00:00.000Z");
    expect(
      shiftSnapshot(
        at("22:05"),
        "UTC",
        night,
        "2026-09-14",
      ).workDate.toISOString(),
    ).toBe("2026-09-14T00:00:00.000Z");
  });
});
