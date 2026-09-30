import { expect, it } from "vitest";
import {
  effectivePermissions,
  employeePages,
  employeePermissions,
} from "../../src/lib/employee-access";
it("allows employee self-service modules while rejecting old administrative grants", () => {
  const grants = [
    ...employeePermissions,
    "payroll.read",
    "employees.read",
    "attendance.read",
    "ai.use",
    "documents.self",
  ];
  expect(
    effectivePermissions({ roleName: "Employee", isSuperAdmin: false }, grants),
  ).toEqual(employeePermissions);
  expect(Object.keys(employeePages)).toEqual([
    "profile",
    "attendance",
    "leave",
    "payslips",
    "home",
    "workforce",
    "expenses",
    "performance",
    "training",
    "assets",
  ]);
  expect(
    effectivePermissions(
      { roleName: "HR Manager", isSuperAdmin: false },
      grants,
    ),
  ).toEqual(grants);
});
