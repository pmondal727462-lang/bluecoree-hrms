import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, systemDb, withSystem, withTenant } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let a = "",
  b = "";
beforeAll(async () => {
  a = (await f.company("A")).id;
  b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("other", b, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await systemDb.$disconnect();
});

describe("PostgreSQL row-level security", () => {
  it("enables a tenant policy on every company-owned table", async () => {
    const tables = await systemDb.$queryRaw<
      { table: string; rls: boolean; policies: number }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND (
        EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_schema = 'public' AND col.table_name = c.relname
                  AND col.column_name = 'companyId')
        OR c.relname IN ('companies', 'sessions', 'role_permissions', 'ai_messages'))`;
    expect(tables.length).toBeGreaterThan(80);
    expect(tables.filter((t) => !t.rls || t.policies < 1)).toEqual([]);
  });

  it("uses a restricted role for tenants and a separate bypass role for system work", async () => {
    const role = () =>
      db.$queryRaw<{ name: string; bypass: boolean; superuser: boolean }[]>`
        SELECT rolname AS name, rolbypassrls AS bypass, rolsuper AS superuser
        FROM pg_roles WHERE rolname = current_user`;
    const [tenant] = await withTenant(a, role);
    const [system] = await withSystem(role);
    expect(tenant).toMatchObject({ bypass: false, superuser: false });
    expect(system).toMatchObject({ bypass: true, superuser: false });
    expect(tenant.name).not.toBe(system.name);
  });

  it("hides and protects another company's rows even without application filters", async () => {
    const otherEmployee = f.employees.other;
    await withTenant(a, async () => {
      expect(
        await db.employee.findUnique({ where: { id: otherEmployee } }),
      ).toBeNull();
      expect(await db.employee.count({ where: { companyId: b } })).toBe(0);
      expect(await db.company.findMany({ select: { id: true } })).toEqual([
        { id: a },
      ]);
      expect(
        await db.session.count({ where: { user: { companyId: b } } }),
      ).toBe(0);
      expect(
        (
          await db.employee.updateMany({
            where: { id: otherEmployee },
            data: { firstName: "Changed" },
          })
        ).count,
      ).toBe(0);
      await expect(
        db.department.create({ data: { companyId: b, name: "Injected" } }),
      ).rejects.toThrow(/row-level security/);
      // Array and interactive transactions carry the same tenant setting.
      const [employees] = await db.$transaction([db.employee.count()]);
      const inTx = await db.$transaction((tx) => tx.employee.count());
      const own = await systemDb.employee.count({ where: { companyId: a } });
      expect([employees, inTx]).toEqual([own, own]);
    });
    expect(
      (
        await systemDb.employee.findUniqueOrThrow({
          where: { id: otherEmployee },
        })
      ).firstName,
    ).toBe("other");
    expect(await withTenant("unknown-company", () => db.employee.count())).toBe(
      0,
    );
  });

  it("refuses database access outside an explicit scope", () => {
    expect(() => db.employee.count()).toThrow(
      /outside a tenant or system scope/,
    );
  });

  it("scopes authenticated API requests to the signed-in company", async () => {
    const own = await call(f, `employees/${f.employees.admin}`, "GET", "admin");
    expect(own.status).toBe(200);
    const other = await call(
      f,
      `employees/${f.employees.other}`,
      "GET",
      "admin",
    );
    expect(other.status).toBe(404);
  });
});
