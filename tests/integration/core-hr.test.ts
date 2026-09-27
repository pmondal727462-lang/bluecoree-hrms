import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { systemDb as db } from "../../src/lib/db";
import { decrypt, encrypt } from "../../src/lib/crypto";
import { backfillBankAccounts } from "../../src/modules/employees/bank-backfill";
import { call, Fixture, png } from "./helpers";

const f = new Fixture();
const photo = { name: "me.png", type: "image/png", base64: png.split(",")[1] };
const pdf = {
  name: "policy.pdf",
  type: "application/pdf",
  base64: Buffer.from("%PDF-1.4\n% test\n").toString("base64"),
};
let a = "",
  storage = "";
beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), "hrms-corehr-"));
  process.env.LOCAL_STORAGE_DIR = storage;
  a = (await f.company("A")).id;
  const b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("peer", a, "Employee");
  await f.user("hrexec", a, "HR Executive");
  await f.user("other", b, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await rm(storage, { recursive: true, force: true });
  await db.$disconnect();
});

describe("Phase 2 Core HR", () => {
  it("manages private employee photos with role and tenant checks", async () => {
    expect((await call(f, "profile/photo", "GET", "staff")).body.data).toEqual({
      url: null,
    });
    expect(
      (await call(f, "profile/photo", "PUT", "staff", { file: photo })).status,
    ).toBe(200);
    const own = await call(f, "profile/photo", "GET", "staff");
    expect(own.body.data.url).toMatch(/\/api\/files\//);
    // Only the flag is exposed; the storage key stays server-side.
    const record = await call(
      f,
      `employees/${f.employees.staff}`,
      "GET",
      "admin",
    );
    expect(record.body.data.hasPhoto).toBe(true);
    expect(record.body.data).not.toHaveProperty("photoKey");
    const profile = await call(f, "profile", "GET", "staff");
    expect(profile.body.data).not.toHaveProperty("photoKey");

    expect(
      (
        await call(f, `employees/${f.employees.staff}/photo`, "PUT", "peer", {
          file: photo,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(f, `employees/${f.employees.staff}/photo`, "GET", "peer"))
        .status,
    ).toBe(403);
    expect(
      (await call(f, `employees/${f.employees.staff}/photo`, "GET", "other"))
        .status,
    ).toBe(404);
    expect(
      (
        await call(f, "profile/photo", "PUT", "staff", {
          file: { name: "x.pdf", type: "application/pdf", base64: pdf.base64 },
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await call(f, `employees/${f.employees.peer}/photo`, "PUT", "admin", {
          file: photo,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(f, `employees/${f.employees.peer}/photo`, "DELETE", "admin"))
        .body.data,
    ).toEqual({ deleted: true });
    const peer = await db.employee.findUniqueOrThrow({
      where: { id: f.employees.peer },
    });
    expect(peer).toMatchObject({ photoKey: null, photoSize: null });
    const audit = await db.auditLog.findMany({
      where: { companyId: a, action: { in: ["PHOTO_UPDATE", "PHOTO_DELETE"] } },
    });
    expect(audit.length).toBe(3);
  });

  it("paginates and searches documents on the server", async () => {
    for (let i = 0; i < 3; i++)
      expect(
        (
          await call(f, "documents", "POST", "admin", {
            title: `Handbook part ${i}`,
            category: "POLICY",
            visibility: "ALL_EMPLOYEES",
            file: pdf,
          })
        ).status,
      ).toBe(200);
    const first = await call(
      f,
      "documents?scope=company&page=1&pageSize=2",
      "GET",
      "admin",
    );
    expect(first.body.data).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.body.data.items).toHaveLength(2);
    const second = await call(
      f,
      "documents?scope=company&page=2&pageSize=2",
      "GET",
      "admin",
    );
    expect(second.body.data.items).toHaveLength(1);
    const searched = await call(
      f,
      "documents?scope=company&page=1&search=part%201",
      "GET",
      "admin",
    );
    expect(
      searched.body.data.items.map((d: { title: string }) => d.title),
    ).toEqual(["Handbook part 1"]);
    // The unpaged form is kept for older clients.
    expect(
      Array.isArray(
        (await call(f, "documents?scope=company", "GET", "admin")).body.data,
      ),
    ).toBe(true);
    expect(
      (await call(f, "documents?scope=company&page=1", "GET", "other")).body
        .data.total,
    ).toBe(0);
  });

  it("exports the whole filtered directory without sensitive fields", async () => {
    await db.employee.update({
      where: { id: f.employees.staff },
      data: { sensitiveEncrypted: "must-not-appear" },
    });
    const csv = await call(f, "employees/export?format=csv", "GET", "admin");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.body).toContain("Employee code");
    for (const code of ["ADMIN", "STAFF", "PEER"])
      expect(csv.body).toContain(code);
    expect(csv.body).not.toContain("OTHER");
    expect(csv.body).not.toContain("must-not-appear");
    const filtered = await call(
      f,
      "employees/export?format=json&search=peer",
      "GET",
      "admin",
    );
    expect(
      filtered.body.rows.map((r: { employeeCode: string }) => r.employeeCode),
    ).toEqual(["PEER"]);
    expect(Object.keys(filtered.body.rows[0])).not.toContain("sensitive");
    const pdfExport = await call(
      f,
      "employees/export?format=pdf",
      "GET",
      "admin",
    );
    expect(pdfExport.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await call(f, "employees/export?format=csv", "GET", "staff")).status,
    ).toBe(403);
    expect(
      (await call(f, "employees/export?format=exe", "GET", "admin")).status,
    ).toBe(422);
    expect(
      await db.auditLog.count({
        where: { companyId: a, module: "employees", action: "EXPORT" },
      }),
    ).toBe(3);
  });

  it("stores addresses and emergency contacts in their own tables", async () => {
    const address = {
      current: "12 MG Road",
      permanent: "Village Road",
      city: "Pune",
      state: "Maharashtra",
      pin: "411001",
      country: "India",
    };
    const saved = await call(
      f,
      `employees/${f.employees.peer}`,
      "PUT",
      "admin",
      {
        address,
        emergencyContact: {
          name: "Asha",
          relationship: "Sister",
          phone: "+919999999999",
        },
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data.address).toEqual(address);
    expect(saved.body.data.emergencyContact).toEqual({
      name: "Asha",
      relationship: "Sister",
      phone: "+919999999999",
    });
    expect(
      await db.employeeAddress.findMany({
        where: { employeeId: f.employees.peer },
        orderBy: { type: "asc" },
        select: { type: true, line: true, city: true },
      }),
    ).toEqual([
      { type: "CURRENT", line: "12 MG Road", city: "Pune" },
      { type: "PERMANENT", line: "Village Road", city: null },
    ]);

    // The employee edits their own details and adds a second contact.
    const own = await call(f, "profile", "PUT", "peer", {
      address: { ...address, permanent: "" },
    });
    expect(own.body.data.address.permanent).toBe("");
    expect(
      await db.employeeAddress.count({
        where: { employeeId: f.employees.peer, type: "PERMANENT" },
      }),
    ).toBe(0);
    const added = await call(f, "profile/emergency-contacts", "POST", "peer", {
      name: "Ravi",
      relationship: "Father",
      phone: "+919888888888",
      isPrimary: true,
    });
    expect(added.body.data.map((c: { name: string }) => c.name)).toEqual([
      "Ravi",
      "Asha",
    ]);
    const asha = added.body.data[1].id;
    expect(
      (
        await call(
          f,
          `employees/${f.employees.peer}/emergency-contacts/${asha}`,
          "DELETE",
          "peer",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          f,
          `employees/${f.employees.peer}/emergency-contacts`,
          "GET",
          "other",
        )
      ).status,
    ).toBe(404);
    const removed = await call(
      f,
      `profile/emergency-contacts/${added.body.data[0].id}`,
      "DELETE",
      "peer",
    );
    // The remaining contact becomes primary.
    expect(removed.body.data).toEqual([
      expect.objectContaining({ name: "Asha", isPrimary: true }),
    ]);
  });

  it("keeps salary bank accounts encrypted, with history", async () => {
    const put = (accountNumber: string) =>
      call(f, `employees/${f.employees.staff}`, "PUT", "admin", {
        sensitive: {
          pan: "ABCDE1234F",
          bankAccount: accountNumber,
          ifsc: "HDFC0001234",
        },
      });
    expect((await put("123456789012")).status).toBe(200);
    const blob = await db.employee.findUniqueOrThrow({
      where: { id: f.employees.staff },
    });
    expect(blob.sensitiveEncrypted).not.toContain("123456789012");
    const row = await db.employeeBankAccount.findFirstOrThrow({
      where: { employeeId: f.employees.staff, active: true },
    });
    expect(row).toMatchObject({ accountLast4: "9012", ifsc: "HDFC0001234" });
    expect(row.accountEncrypted).not.toContain("123456789012");
    const record = await call(
      f,
      `employees/${f.employees.staff}`,
      "GET",
      "admin",
    );
    expect(record.body.data.sensitive).toMatchObject({
      pan: "ABCDE1234F",
      bankAccount: "123456789012",
      ifsc: "HDFC0001234",
    });
    // Unchanged details do not create history; a new account does.
    await put("123456789012");
    await put("999988887777");
    const history = await call(
      f,
      `employees/${f.employees.staff}/bank-accounts`,
      "GET",
      "admin",
    );
    expect(
      history.body.data.map((b: { accountMasked: string; active: boolean }) => [
        b.accountMasked,
        b.active,
      ]),
    ).toEqual([
      ["XXXX7777", true],
      ["XXXX9012", false],
    ]);
    const added = await call(
      f,
      `employees/${f.employees.staff}/bank-accounts`,
      "POST",
      "admin",
      { accountNumber: "555566667777", ifsc: "SBIN0000001", bankName: "SBI" },
    );
    expect(added.body.data[0]).toMatchObject({
      accountNumber: "555566667777",
      isPrimary: true,
    });
    expect(
      (
        await call(
          f,
          `employees/${f.employees.staff}/bank-accounts`,
          "POST",
          "admin",
          { accountNumber: "12", ifsc: "BAD" },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          f,
          `employees/${f.employees.staff}/bank-accounts`,
          "GET",
          "hrexec",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          f,
          `employees/${f.employees.staff}/bank-accounts`,
          "GET",
          "other",
        )
      ).status,
    ).toBe(404);
    const hr = await call(f, `employees/${f.employees.staff}`, "GET", "hrexec");
    expect(hr.body.data).not.toHaveProperty("sensitive");
    expect(JSON.stringify(hr.body.data)).not.toContain("555566667777");
    const profile = await call(f, "profile", "GET", "staff");
    expect(JSON.stringify(profile.body.data)).not.toContain("555566667777");
  });

  it("moves legacy bank details out of the identity field", async () => {
    await db.employee.update({
      where: { id: f.employees.hrexec },
      data: {
        sensitiveEncrypted: encrypt({
          pan: "PQRSX1234Z",
          bankAccount: "111122223333",
          ifsc: "ICIC0000001",
        }),
      },
    });
    await db.employee.update({
      where: { id: f.employees.admin },
      data: { sensitiveEncrypted: encrypt({ ifsc: "ICIC0000002" }) },
    });
    const result = await backfillBankAccounts([a]);
    expect(result.incomplete).toEqual([f.employees.admin]);
    const moved = await db.employee.findUniqueOrThrow({
      where: { id: f.employees.hrexec },
    });
    expect(decrypt(moved.sensitiveEncrypted!)).toEqual({ pan: "PQRSX1234Z" });
    const account = await db.employeeBankAccount.findFirstOrThrow({
      where: { employeeId: f.employees.hrexec },
    });
    expect(decrypt(account.accountEncrypted).accountNumber).toBe(
      "111122223333",
    );
    expect(account).toMatchObject({ ifsc: "ICIC0000001", isPrimary: true });
    // Running again changes nothing.
    await backfillBankAccounts([a]);
    expect(
      await db.employeeBankAccount.count({
        where: { employeeId: f.employees.hrexec },
      }),
    ).toBe(1);
    const untouched = await db.employee.findUniqueOrThrow({
      where: { id: f.employees.admin },
    });
    expect(decrypt(untouched.sensitiveEncrypted!)).toEqual({
      ifsc: "ICIC0000002",
    });
  });

  it("paginates and searches HR tickets on the server", async () => {
    for (const subject of ["Payslip missing", "Laptop request", "Leave query"])
      expect(
        (
          await call(f, "helpdesk", "POST", "staff", {
            category: "HR",
            subject,
            body: "Please help with this request.",
            priority: "MEDIUM",
          })
        ).status,
      ).toBe(200);
    const page = await call(
      f,
      "helpdesk?scope=all&page=1&pageSize=2",
      "GET",
      "admin",
    );
    expect(page.body.data).toMatchObject({ total: 3, pageSize: 2 });
    expect(page.body.data.items).toHaveLength(2);
    const search = await call(
      f,
      "helpdesk?scope=own&page=1&search=laptop",
      "GET",
      "staff",
    );
    expect(
      search.body.data.items.map((t: { subject: string }) => t.subject),
    ).toEqual(["Laptop request"]);
    expect(
      (await call(f, "helpdesk?scope=own&page=1", "GET", "peer")).body.data
        .total,
    ).toBe(0);
  });
});
