import { describe, it, expect } from "vitest";
import {
  codeForStep,
  verifyTotp,
  newSecret,
} from "../../src/modules/auth/totp";
describe("RFC 6238 TOTP", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it("matches RFC SHA-1 reference vectors", () => {
    for (const [time, code] of [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ] as const)
      expect(codeForStep(secret, Math.floor(time / 30), 8)).toBe(code);
  });
  it("rejects replay and codes outside the time window", () => {
    const now = 1234567890000,
      step = Math.floor(now / 30000),
      code = codeForStep(secret, step);
    expect(verifyTotp(secret, code, null, now)).toBe(step);
    expect(verifyTotp(secret, code, BigInt(step), now)).toBeNull();
    expect(verifyTotp(secret, code, null, now + 90000)).toBeNull();
    expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
