import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture, password } from "./helpers";

// Accounts created with a temporary password must choose their own first.
const f = new Fixture();
beforeAll(async () => {
  const c = await f.company("A");
  const { email } = await f.user("owner", c.id, "Company Admin", {
    login: false,
  });
  await db.user.update({
    where: { id: f.users.owner },
    data: { mustChangePassword: true },
  });
  await f.login("owner", c.id, email);
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("temporary passwords", () => {
  it("blocks protected services until a different password is chosen", async () => {
    const me = await call(f, "auth/me", "GET", "owner");
    expect(me.status).toBe(200);
    expect(me.body.data.passwordChangeRequired).toBe(true);
    expect(me.body.data.temporaryPassword).toBe(true);
    const blocked = await call(f, "employees", "GET", "owner");
    expect(blocked.status).toBe(428);
    expect(blocked.body.message).toBe("Choose your own password to continue.");
    expect(
      (
        await call(f, "auth/password", "PUT", "owner", {
          currentPassword: password,
          newPassword: password,
        })
      ).status,
    ).toBe(422);
    const changed = await call(f, "auth/password", "PUT", "owner", {
      currentPassword: password,
      newPassword: "A-brand-new-owner-password-42",
    });
    expect(changed.status).toBe(200);
    expect((await call(f, "auth/me", "GET", "owner")).status).toBe(401);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: f.users.owner } }))
        .mustChangePassword,
    ).toBe(false);
    const u = await db.user.findUniqueOrThrow({ where: { id: f.users.owner } });
    await f.login(
      "owner",
      u.companyId,
      u.email,
      "A-brand-new-owner-password-42",
    );
    expect((await call(f, "employees", "GET", "owner")).status).toBe(200);
  });

  it("requires a change for administrator-created and administrator-replaced passwords", async () => {
    const owner = await db.user.findUniqueOrThrow({
      where: { id: f.users.owner },
    });
    const role = await db.role.findUniqueOrThrow({
      where: {
        companyId_name: { companyId: owner.companyId, name: "Employee" },
      },
    });
    const email = `temporary@${f.prefix.toLowerCase()}.example.com`;
    const created = await call(f, "users", "POST", "owner", {
      name: "Temporary user",
      email,
      password,
      roleId: role.id,
    });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect(
      (await db.user.findUniqueOrThrow({ where: { id } })).mustChangePassword,
    ).toBe(true);
    expect((await f.login("temporary", owner.companyId, email)).status).toBe(
      200,
    );
    expect(
      (await call(f, "auth/me", "GET", "temporary")).body.data.temporaryPassword,
    ).toBe(true);
    const ownPassword = "My-own-new-password-42!";
    expect(
      (
        await call(f, "auth/password", "PUT", "temporary", {
          currentPassword: password,
          newPassword: ownPassword,
        })
      ).status,
    ).toBe(200);
    await f.login("temporary", owner.companyId, email, ownPassword);
    expect(
      (await call(f, "auth/me", "GET", "temporary")).body.data
        .passwordChangeRequired,
    ).toBe(false);
    expect(
      (
        await call(f, `users/${id}`, "PUT", "owner", {
          password: "Replacement-temporary-password-42!",
        })
      ).status,
    ).toBe(200);
    expect((await call(f, "auth/me", "GET", "temporary")).status).toBe(401);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id } })).mustChangePassword,
    ).toBe(true);
  });
});
