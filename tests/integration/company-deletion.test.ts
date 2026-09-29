import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { deleteFile } from "../../src/lib/storage";
import { cleanupDeletedCompanyFiles } from "../../src/modules/platform/delete-company";
import { Fixture, call } from "./helpers";

vi.mock("../../src/lib/storage", async (original) => ({
  ...(await original<typeof import("../../src/lib/storage")>()),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));
const f = new Fixture();
let provider = "",
  target = "",
  code = "",
  other = "";
const remove = (
  id = target,
  companyCode = code,
  who = "owner",
  method = "DELETE",
) => call(f, `platform/companies/${id}`, method, who, { companyCode });

beforeAll(async () => {
  provider = (await f.company("P")).id;
  const c = await f.company("D");
  target = c.id;
  code = c.code;
  other = (await f.company("O")).id;
  await f.user("owner", provider, "Super Admin", { superAdmin: true });
  await f.user("client", target, "Company Admin");
  await f.user("other", other, "Company Admin");
  await f.user("support", provider, "SaaS Admin");
});
afterAll(async () => {
  await f.cleanup();
  await db.$disconnect();
});

describe("Company deletion", () => {
  it("requires owner authorization, correct confirmation, and DELETE", async () => {
    expect((await remove(target, code, "")).status).toBe(401);
    expect((await remove(target, code, "client")).status).toBe(403);
    expect((await remove(target, code, "support")).status).toBe(403);
    expect((await remove(target, "wrong-code")).status).toBe(422);
    expect((await remove(target, code, "owner", "POST")).status).toBe(404);
    expect((await remove("missing-company")).status).toBe(404);
    expect(
      await db.company.findUnique({ where: { id: target } }),
    ).not.toBeNull();
  });

  it("protects the current company, owner accounts, and legal holds", async () => {
    expect((await remove(provider, f.codes[0])).status).toBe(409);
    await db.user.update({
      where: { id: f.users.client },
      data: { isSuperAdmin: true },
    });
    expect((await remove()).status).toBe(409);
    await db.user.update({
      where: { id: f.users.client },
      data: { isSuperAdmin: false },
    });
    await db.company.update({
      where: { id: target },
      data: { legalHold: true },
    });
    expect((await remove()).status).toBe(409);
    const list = await call(f, "platform/companies", "GET", "owner");
    expect(
      list.body.data.find((c: { id: string }) => c.id === target)
        .deletionBlockedReason,
    ).toContain("legal hold");
    await db.company.update({
      where: { id: target },
      data: { legalHold: false },
    });
  });

  it("deletes linked tenant data, revokes sessions, preserves other tenants and retries file cleanup", async () => {
    const employeeId = f.employees.client;
    const onboarding = await db.onboarding.create({
      data: {
        companyId: target,
        employeeId,
        name: "New hire",
        email: "hire@example.com",
        employeeCode: "HIRE",
        joiningDate: new Date(),
        createdBy: f.users.client,
      },
    });
    const document = await db.document.create({
      data: {
        companyId: target,
        employeeId,
        onboardingId: onboarding.id,
        title: "Contract",
        category: "OTHER",
        uploadedBy: f.users.client,
        versions: {
          create: {
            version: 1,
            fileName: "contract.pdf",
            contentType: "application/pdf",
            size: 1,
            storageKey: `${target}/contract`,
            sha256: "test",
            uploadedBy: f.users.client,
          },
        },
      },
    });
    await db.onboardingTask.create({
      data: {
        companyId: target,
        onboardingId: onboarding.id,
        documentId: document.id,
        title: "Read contract",
        category: "OTHER",
        assignee: "EMPLOYEE",
      },
    });
    const attendance = await db.attendance.create({
      data: {
        companyId: target,
        employeeId,
        workDate: new Date("2026-01-02"),
        checkIn: new Date("2026-01-02T09:00:00Z"),
      },
    });
    await db.compOffRequest.create({
      data: {
        companyId: target,
        employeeId,
        attendanceId: attendance.id,
        workDate: new Date("2026-01-02"),
        reason: "Weekend work",
        days: 1,
      },
    });
    await db.authChallenge.create({
      data: {
        companyId: target,
        userId: f.users.client,
        kind: "reset",
        tokenHash: "test",
        expiresAt: new Date(),
      },
    });
    const conversation = await db.aiConversation.create({
      data: {
        companyId: target,
        userId: f.users.client,
        accessFingerprint: "test",
        expiresAt: new Date(),
      },
    });
    await db.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        contentEncrypted: "Test",
      },
    });
    const otherBefore = await db.user.count({ where: { companyId: other } });
    vi.mocked(deleteFile).mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    const result = await remove();
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data).toMatchObject({ deleted: true, pendingFiles: 1 });
    expect(await db.company.findUnique({ where: { id: target } })).toBeNull();
    expect(await db.user.count({ where: { companyId: target } })).toBe(0);
    expect(await db.session.count({ where: { userId: f.users.client } })).toBe(
      0,
    );
    expect(await db.authChallenge.count({ where: { companyId: target } })).toBe(
      0,
    );
    expect(
      await db.aiMessage.count({ where: { conversationId: conversation.id } }),
    ).toBe(0);
    expect(
      await db.documentVersion.count({ where: { companyId: target } }),
    ).toBe(0);
    expect(await db.attendance.count({ where: { companyId: target } })).toBe(0);
    expect(await db.user.count({ where: { companyId: other } })).toBe(
      otherBefore,
    );
    expect((await call(f, "auth/me", "GET", "client")).status).toBe(401);
    expect((await call(f, "auth/me", "GET", "other")).status).toBe(200);
    await cleanupDeletedCompanyFiles();
    const log = await db.auditLog.findFirstOrThrow({
      where: {
        companyId: provider,
        recordId: target,
        action: "COMPANY_DELETED",
      },
    });
    expect(log.newValue).toEqual({ pendingFiles: [], filesRemoved: 1 });
    expect(deleteFile).toHaveBeenCalledWith(`${target}/contract`);
    expect((await remove()).status).toBe(404);
  });
});
