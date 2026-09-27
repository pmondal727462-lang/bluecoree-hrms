import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  duration,
  localDay,
  shiftSnapshot,
  workingDays,
  zonedTime,
} from "../../src/modules/time/rules";
import { shiftSchema, leaveSchema } from "../../src/modules/time/validators";
describe("Time rules", () => {
  it("uses company-local dates across UTC midnight", () => {
    expect(localDay(new Date("2026-09-23T20:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-09-24",
    );
  });
  it("assigns an after-midnight overnight punch to the prior workday", () => {
    const snapshot = shiftSnapshot(new Date("2026-09-24T01:00:00Z"), "UTC", {
      name: "Night",
      startMinute: 1320,
      endMinute: 360,
      graceMinutes: 10,
      breakMinutes: 60,
    });
    expect(snapshot.workDate.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(snapshot.expectedMinutes).toBe(420);
    expect(snapshot.lateMinutes).toBe(180);
  });
  it("deducts breaks and reports overtime without negative work", () => {
    expect(
      duration(
        new Date("2026-09-23T09:00:00Z"),
        new Date("2026-09-23T19:00:00Z"),
        60,
        480,
      ),
    ).toEqual({ workedMinutes: 540, overtimeMinutes: 60 });
    expect(
      duration(
        new Date("2026-09-23T09:00:00Z"),
        new Date("2026-09-23T09:01:00Z"),
        60,
        480,
      ).workedMinutes,
    ).toBe(0);
  });
  it("excludes weekends and holidays, including leap day", () => {
    expect(
      workingDays("2028-02-28", "2028-03-05", [1, 2, 3, 4, 5], ["2028-02-29"]),
    ).toBe(4);
  });
  it("computes geographic distance and rejects invalid schedules/ranges", () => {
    expect(
      distanceMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(0);
    expect(
      distanceMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeGreaterThan(111000);
    expect(
      shiftSchema.safeParse({
        name: "Invalid",
        startMinute: 540,
        endMinute: 540,
        graceMinutes: 0,
        breakMinutes: 0,
      }).success,
    ).toBe(false);
    expect(
      leaveSchema.safeParse({
        leaveTypeId: "x",
        startDate: "2026-12-31",
        endDate: "2027-01-01",
        reason: "Holiday",
      }).success,
    ).toBe(false);
  });
  it("converts company-local wall time to an instant", () => {
    expect(zonedTime("2026-09-24", 570, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-24T04:00:00.000Z",
    );
    expect(zonedTime("2026-09-24", 0, "UTC").toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
    expect(zonedTime("2026-07-01", 540, "America/New_York").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedTime("2026-01-15", 540, "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });
});
