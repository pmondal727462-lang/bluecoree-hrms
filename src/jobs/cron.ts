// Minimal five-field cron matcher (minute hour day month weekday) for the
// in-process scheduler used when Redis is not configured. Supports *, */n,
// numbers, ranges (a-b) and lists (a,b). Times are evaluated in UTC.
function field(expr: string, value: number, min: number, max: number) {
  return expr.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let lo = min,
      hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b ?? (stepText ? max : a);
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}
export function cronMatches(pattern: string, at: Date) {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron pattern: ${pattern}`);
  const [m, h, dom, mon, dow] = parts;
  return (
    field(m, at.getUTCMinutes(), 0, 59) &&
    field(h, at.getUTCHours(), 0, 23) &&
    field(dom, at.getUTCDate(), 1, 31) &&
    field(mon, at.getUTCMonth() + 1, 1, 12) &&
    field(dow, at.getUTCDay(), 0, 6)
  );
}
