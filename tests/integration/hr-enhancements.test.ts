import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

const f = new Fixture();
const pdf = {
  name: "letter.pdf",
  type: "application/pdf",
  base64: Buffer.from("%PDF-1.4\n% letter test\n").toString("base64"),
};
let companyId = "",
  storage = "";
beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), "hrms-enhancements-"));
  process.env.LOCAL_STORAGE_DIR = storage;
  companyId = (await f.company("A")).id;
  const other = (await f.company("B")).id;
  await f.user("hr", companyId, "HR Manager");
  await f.user("staff", companyId, "Employee");
  await f.user("peer", companyId, "Employee");
  await f.user("other", other, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await rm(storage, { recursive: true, force: true });
  await db.$disconnect();
});

describe("employee letters, celebrations and attendance policy", () => {
  it("keeps all employment letter types private and HR-controlled", async () => {
    for (const category of [
      "APPOINTMENT_LETTER",
      "INCREMENT_LETTER",
      "PROMOTION_LETTER",
    ]) {
      const body = {
        title: category,
        category,
        employeeId: f.employees.staff,
        visibility: "EMPLOYEE",
        file: pdf,
      };
      expect((await call(f, "documents", "POST", "staff", body)).status).toBe(
        403,
      );
      expect(
        (
          await call(f, "documents", "POST", "hr", {
            ...body,
            visibility: "ALL_EMPLOYEES",
          })
        ).status,
      ).toBe(422);
      const saved = await call(f, "documents", "POST", "hr", body);
      expect(saved.status).toBe(200);
      const id = saved.body.data.id;
      expect(
        (await call(f, `documents/${id}/download`, "GET", "staff")).body.data
          .url,
      ).toContain("/api/files/");
      for (const who of ["peer", "other"])
        expect(
          (await call(f, `documents/${id}/download`, "GET", who)).status,
        ).toBe(404);
      expect(
        (
          await call(f, `documents/${id}/versions`, "POST", "staff", {
            file: pdf,
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(f, `documents/${id}/versions`, "POST", "hr", { file: pdf }))
          .status,
      ).toBe(200);
    }
    expect(
      (await call(f, "documents?scope=own&letters=1", "GET", "staff")).body
        .data,
    ).toHaveLength(3);
    expect(
      (await call(f, "documents?scope=own&letters=1", "GET", "peer")).body.data,
    ).toHaveLength(0);
  });

  it("shares today's events within the company and allows one changeable emoji wish per event", async () => {
    const today = new Date().toISOString().slice(5, 10);
    await db.employee.update({
      where: { id: f.employees.staff },
      data: {
        dateOfBirth: new Date(`1995-${today}`),
        joinedAt: new Date(`2023-${today}`),
      },
    });
    const result = await call(f, "celebrations", "GET", "peer");
    expect(result.status).toBe(200);
    const events = result.body.data.events.filter(
      (e: { employeeId: string }) => e.employeeId === f.employees.staff,
    );
    expect(events).toHaveLength(2);
    expect(events.map((e: { kind: string }) => e.kind).sort()).toEqual([
      "BIRTHDAY",
      "WORK_ANNIVERSARY",
    ]);
    expect(events[0]).not.toHaveProperty("dateOfBirth");
    expect(events[0]).not.toHaveProperty("userId");
    const wish = {
      employeeId: f.employees.staff,
      kind: "BIRTHDAY",
      emoji: "🎂",
    };
    expect((await call(f, "celebrations", "POST", "other", wish)).status).toBe(
      404,
    );
    expect((await call(f, "celebrations", "POST", "peer", wish)).status).toBe(
      200,
    );
    expect(
      (await call(f, "celebrations", "POST", "peer", { ...wish, emoji: "🎉" }))
        .status,
    ).toBe(200);
    expect(await db.celebrationWish.count({ where: { companyId } })).toBe(1);
    expect(
      await db.notification.count({
        where: { companyId, event: "celebration.wish" },
      }),
    ).toBe(1);
    const updated = (
      await call(f, "celebrations", "GET", "peer")
    ).body.data.events.find((e: { kind: string }) => e.kind === "BIRTHDAY");
    expect(updated.myWish).toBe("🎉");
    expect(
      updated.wishes.find((w: { emoji: string }) => w.emoji === "🎉").count,
    ).toBe(1);
    expect(
      (
        await call(f, "celebrations", "POST", "peer", {
          ...wish,
          emoji: "invalid",
        })
      ).status,
    ).toBe(422);
  });

  it("lets HR configure single-punch status consistently in attendance and daily roster", async () => {
    await db.attendance.create({
      data: {
        companyId,
        employeeId: f.employees.staff,
        workDate: new Date("2026-08-07"),
        checkIn: new Date("2026-08-07T09:00:00Z"),
        status: "PRESENT",
        source: "MANUAL",
      },
    });
    const policy = {
      geofenceEnabled: false,
      latitude: null,
      longitude: null,
      radiusMeters: 100,
      singlePunchStatus: "ABSENT",
    };
    expect((await call(f, "time/policy", "PUT", "staff", policy)).status).toBe(
      403,
    );
    for (const [singlePunchStatus, label] of [
      ["ABSENT", "Absent"],
      ["PRESENT", "Present"],
      ["HALF_DAY", "Half day"],
    ]) {
      expect(
        (
          await call(f, "time/policy", "PUT", "hr", {
            ...policy,
            singlePunchStatus,
          })
        ).status,
      ).toBe(200);
      const list = await call(
        f,
        "time/attendance?scope=company&from=2026-08-07&to=2026-08-07",
        "GET",
        "hr",
      );
      expect(list.status).toBe(200);
      expect(list.body.data.items[0].status).toBe(singlePunchStatus);
      const roster = await call(f, "time/roster?date=2026-08-07", "GET", "hr");
      expect(roster.status).toBe(200);
      expect(
        roster.body.data.items.find(
          (e: { id: string }) => e.id === f.employees.staff,
        ).status,
      ).toBe(label);
    }
  });
});
