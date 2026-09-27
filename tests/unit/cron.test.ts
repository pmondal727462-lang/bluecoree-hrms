import { describe, expect, it } from "vitest";
import { cronMatches } from "../../src/jobs/cron";
import { tasks } from "../../src/jobs/tasks";

const at = (iso: string) => new Date(iso);

describe("cron matcher", () => {
  it("matches wildcards, steps, lists and ranges in UTC", () => {
    expect(cronMatches("* * * * *", at("2026-09-27T10:07:00Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-09-27T10:10:00Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-09-27T10:11:00Z"))).toBe(false);
    expect(cronMatches("30 20 * * *", at("2026-09-27T20:30:00Z"))).toBe(true);
    expect(cronMatches("0 21 * * 0", at("2026-09-27T21:00:00Z"))).toBe(true); // Sunday
    expect(cronMatches("0 21 * * 0", at("2026-09-28T21:00:00Z"))).toBe(false);
    expect(cronMatches("0 9-17/4 * * 1,3", at("2026-09-28T13:00:00Z"))).toBe(
      true,
    );
    expect(() => cronMatches("* *", new Date())).toThrow();
  });
  it("has a valid pattern for every scheduled task", () => {
    for (const t of Object.values(tasks))
      expect(() => cronMatches(t.pattern, new Date())).not.toThrow();
  });
});
