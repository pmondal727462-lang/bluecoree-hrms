import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "../../src/lib/crypto";
import { can, defaultGrants, permissions } from "../../src/config/permissions";
import {
  employeeSchema,
  profileSchema,
  companySchema,
  password,
} from "../../src/modules/shared/validators";
import { signToken, verifyToken } from "../../src/modules/auth/tokens";
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.JWT_SECRET = randomBytes(48).toString("hex");
  process.env.JWT_REFRESH_SECRET = randomBytes(48).toString("hex");
});
describe("Phase 1 security foundations", () => {
  it("encrypts confidential fields with a fresh authenticated nonce", () => {
    const value = { pan: "TESTPAN123", bankAccount: "123456789" };
    const a = encrypt(value),
      b = encrypt(value);
    expect(a).not.toContain(value.bankAccount);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toEqual(value);
    const parts = a.split(".");
    parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("rejects invalid tokens and separates access from refresh", async () => {
    const token = await signToken("user", "session");
    expect(await verifyToken(token)).toEqual({
      userId: "user",
      sessionId: "session",
    });
    await expect(verifyToken(token, true)).rejects.toThrow();
    await expect(verifyToken(token + "broken")).rejects.toThrow();
  });
  it("employee role cannot access the directory or administer permissions", () => {
    expect(can(defaultGrants.Employee, "profile.read")).toBe(true);
    expect(can(defaultGrants.Employee, "employees.read")).toBe(false);
    expect(can(defaultGrants.Employee, "roles.write")).toBe(false);
    for (const grants of Object.values(defaultGrants))
      for (const key of grants) expect(key in permissions).toBe(true);
  });
  it("rejects self-service role and salary injection", () => {
    expect(
      profileSchema.safeParse({ mobile: "123", roleId: "admin" }).success,
    ).toBe(false);
    expect(profileSchema.safeParse({ sensitive: { pan: "123" } }).success).toBe(
      false,
    );
  });
  it("validates calendar dates and disallows tenant injection", () => {
    const employee = {
      employeeCode: "EMP-1",
      firstName: "Test",
      lastName: "Person",
      officialEmail: "test@example.com",
      joinedAt: "2026-02-30",
    };
    expect(employeeSchema.safeParse(employee).success).toBe(false);
    expect(
      employeeSchema.safeParse({
        ...employee,
        joinedAt: "2026-02-28",
        companyId: "other",
      }).success,
    ).toBe(false);
    expect(
      employeeSchema.safeParse({ ...employee, joinedAt: "2026-02-28" }).success,
    ).toBe(true);
  });
  it("requires strong passwords and valid organization defaults", () => {
    expect(password.safeParse("short").success).toBe(false);
    expect(password.safeParse("😀".repeat(30)).success).toBe(false);
    expect(
      companySchema.safeParse({
        code: "ACME",
        name: "Acme",
        email: "hr@acme.test",
        workingDays: [1, 1],
      }).success,
    ).toBe(false);
    expect(
      companySchema.safeParse({
        code: "ACME",
        name: "Acme",
        email: "hr@acme.test",
        timezone: "Invalid/Zone",
      }).success,
    ).toBe(false);
  });
});
