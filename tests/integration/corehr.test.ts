import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture, png } from "./helpers";

const f = new Fixture();
const pdf = Buffer.from("%PDF-1.4\n% policy\n").toString("base64");
const pngFile = (name = "id.png") => ({
  name,
  type: "image/png",
  base64: png.split(",")[1],
});
let a = "",
  storage = "";
beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), "hrms-files-"));
  process.env.LOCAL_STORAGE_DIR = storage;
  a = (await f.company("A")).id;
  const b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("hr", a, "HR Executive");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("other", b, "Company Admin");
});
afterAll(async () => {
  await f.cleanup();
  await rm(storage, { recursive: true, force: true });
  await db.$disconnect();
});
const unread = async (who: string) =>
  (await call(f, "notifications", "GET", who)).body.data.unreadCount as number;

describe("Documents", () => {
  let idProof = "",
    policy = "";
  it("reviews employee uploads and serves files only through signed links", async () => {
    expect(
      (
        await call(f, "documents", "POST", "staff", {
          title: "Web page",
          category: "OTHER",
          file: {
            name: "x.html",
            type: "text/html",
            base64: Buffer.from("<script>").toString("base64"),
          },
        })
      ).status,
    ).toBe(422);
    const up = await call(f, "documents", "POST", "staff", {
      title: "Aadhaar",
      category: "ID_PROOF",
      file: pngFile(),
    });
    expect(up.body.data.status).toBe("PENDING_APPROVAL");
    idProof = up.body.data.id;
    expect(await unread("hr")).toBeGreaterThan(0);
    expect(
      (
        await call(f, `documents/${idProof}/review`, "POST", "staff", {
          action: "approve",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(f, `documents/${idProof}/download`, "GET", "other")).status,
    ).toBe(404);
    expect(
      (
        await call(f, `documents/${idProof}/review`, "POST", "hr", {
          action: "reject",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, `documents/${idProof}/review`, "POST", "hr", {
          action: "approve",
        })
      ).body.data.status,
    ).toBe("APPROVED");
    const link = (
      await call(f, `documents/${idProof}/download`, "GET", "staff")
    ).body.data.url as string;
    const token = link.split("/").pop()!;
    const file = await call(f, `files/${token}`, "GET", "");
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(
      (await call(f, `files/${token.slice(0, -2)}xx`, "GET", "")).status,
    ).toBe(404);
  });
  it("publishes policies for acknowledgement and hides HR-only files", async () => {
    const created = await call(f, "documents", "POST", "hr", {
      title: "Code of conduct",
      category: "POLICY",
      visibility: "ALL_EMPLOYEES",
      requiresAcknowledgement: true,
      file: { name: "conduct.pdf", type: "application/pdf", base64: pdf },
    });
    policy = created.body.data.id;
    const policies = (await call(f, "documents?scope=policies", "GET", "staff"))
      .body.data;
    expect(policies.map((d: { id: string }) => d.id)).toContain(policy);
    expect(
      (await call(f, "home", "GET", "staff")).body.data.documents.toAcknowledge,
    ).toBe(1);
    await call(f, `documents/${policy}/acknowledge`, "POST", "staff");
    expect(
      (await call(f, "home", "GET", "staff")).body.data.documents.toAcknowledge,
    ).toBe(0);
    await call(f, `documents/${policy}/versions`, "POST", "hr", {
      file: { name: "conduct-v2.pdf", type: "application/pdf", base64: pdf },
    });
    expect(
      (await call(f, "home", "GET", "staff")).body.data.documents.toAcknowledge,
    ).toBe(1);
    const hidden = await call(f, "documents", "POST", "hr", {
      employeeId: f.employees.staff,
      title: "Disciplinary note",
      category: "OTHER",
      visibility: "HR_ONLY",
      file: pngFile("note.png"),
    });
    const own = (await call(f, "documents", "GET", "staff")).body.data.map(
      (d: { id: string }) => d.id,
    );
    expect(own).toContain(idProof);
    expect(own).not.toContain(hidden.body.data.id);
    expect(
      (
        await call(
          f,
          `documents/${hidden.body.data.id}/download`,
          "GET",
          "staff",
        )
      ).status,
    ).toBe(404);
  });
});

describe("HR helpdesk", () => {
  it("routes requests to HR agents with private internal notes", async () => {
    const t = await call(f, "helpdesk", "POST", "staff", {
      category: "PAYROLL",
      subject: "Missing allowance",
      body: "My July allowance is missing.",
      attachment: pngFile("slip.png"),
    });
    expect(t.body).toEqual(expect.objectContaining({ success: true }));
    const id = t.body.data.id;
    expect((await call(f, `helpdesk/${id}`, "GET", "other")).status).toBe(404);
    expect(
      (await call(f, `helpdesk/${id}`, "PUT", "staff", { status: "RESOLVED" }))
        .status,
    ).toBe(403);
    const before = await unread("staff");
    await call(f, `helpdesk/${id}`, "PUT", "hr", {
      status: "OPEN",
      assigneeUserId: f.users.hr,
    });
    await call(f, `helpdesk/${id}/messages`, "POST", "hr", {
      body: "Checking with payroll.",
      internal: true,
    });
    await call(f, `helpdesk/${id}/messages`, "POST", "hr", {
      body: "Fixed in next run.",
    });
    const seen = (await call(f, `helpdesk/${id}`, "GET", "staff")).body.data;
    expect(seen.status).toBe("IN_PROGRESS");
    expect(seen.assigneeName).toBe("hr user");
    expect(seen.messages.map((m: { body: string }) => m.body)).not.toContain(
      "Checking with payroll.",
    );
    expect(await unread("staff")).toBeGreaterThan(before);
    expect(
      (await call(f, `helpdesk/${id}`, "PUT", "staff", { status: "CLOSED" }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(f, `helpdesk/${id}/messages`, "POST", "staff", {
          body: "Thanks",
        })
      ).status,
    ).toBe(409);
  });
});

describe("Onboarding", () => {
  it("collects joiner documents through a private link and creates the employee", async () => {
    expect(
      (
        await call(f, "onboarding", "POST", "staff", {
          name: "Ravi Joiner",
          email: "ravi@example.com",
          employeeCode: "NEW-9",
          joiningDate: "2026-10-01",
        })
      ).status,
    ).toBe(403);
    const o = (
      await call(f, "onboarding", "POST", "hr", {
        name: "Ravi Joiner",
        email: "ravi@example.com",
        employeeCode: "NEW-9",
        joiningDate: "2026-10-01",
      })
    ).body.data;
    const invite = await call(f, `onboarding/${o.id}/invite`, "POST", "hr");
    const token = (invite.body.data.link as string).split("/").pop()!;
    const portal = (await call(f, `public/onboarding/${token}`, "GET", "")).body
      .data;
    expect(portal.name).toBe("Ravi Joiner");
    const idTask = portal.tasks.find(
      (t: { title: string }) => t.title === "Identity proof",
    );
    const policyTask = portal.tasks.find(
      (t: { category: string }) => t.category === "POLICY",
    );
    expect(
      (
        await call(
          f,
          `public/onboarding/${token}/tasks/${idTask.id}`,
          "POST",
          "",
          { file: pngFile("aadhaar.png") },
        )
      ).body.data.status,
    ).toBe("SUBMITTED");
    expect(
      (
        await call(
          f,
          `public/onboarding/${token}/tasks/${policyTask.id}`,
          "POST",
          "",
          { accept: true },
        )
      ).body.data.status,
    ).toBe("DONE");
    expect(
      (await call(f, "public/onboarding/not-a-real-token", "GET", "")).status,
    ).toBe(404);
    expect(
      (await call(f, `onboarding/${o.id}/complete`, "POST", "hr")).status,
    ).toBe(409);
    const detail = (await call(f, `onboarding/${o.id}`, "GET", "hr")).body.data;
    for (const t of detail.tasks.filter(
      (x: { required: boolean; status: string }) =>
        x.required && x.status !== "DONE",
    ))
      await call(f, `onboarding/${o.id}/tasks/${t.id}`, "PUT", "hr", {
        status: "DONE",
      });
    const done = await call(f, `onboarding/${o.id}/complete`, "POST", "hr");
    const employee = await db.employee.findUniqueOrThrow({
      where: { id: done.body.data.employeeId },
    });
    expect(employee.status).toBe("Probation");
    expect(employee.employeeCode).toBe("NEW-9");
    expect(
      await db.document.count({ where: { employeeId: employee.id } }),
    ).toBe(1);
    expect(
      (await call(f, `public/onboarding/${token}`, "GET", "")).status,
    ).toBe(404);
  });
});

describe("Announcements, home and notifications", () => {
  it("publishes announcements and shows each person their own home", async () => {
    expect(
      (
        await call(f, "announcements", "POST", "staff", {
          title: "Hi",
          body: "Hello",
          audience: "ALL",
        })
      ).status,
    ).toBe(403);
    await call(f, "announcements", "POST", "hr", {
      title: "Diwali holidays",
      body: "Office closed on 20 October.",
      audience: "ALL",
      pinned: true,
    });
    const home = (await call(f, "home", "GET", "staff")).body.data;
    expect(home.announcements[0].title).toBe("Diwali holidays");
    expect(home.employee.employeeCode).toBe("STAFF");
    expect(home.approvals.documents).toBe(0);
    expect(
      (await call(f, "home", "GET", "other")).body.data.announcements,
    ).toHaveLength(0);
    const inbox = (await call(f, "notifications", "GET", "staff")).body.data;
    expect(
      inbox.items.some((n: { title: string }) => n.title === "Diwali holidays"),
    ).toBe(true);
    await call(f, "notifications/read", "POST", "staff");
    expect(await unread("staff")).toBe(0);
  });
  it("lets administrators override notification templates", async () => {
    const body = {
      event: "leave.approved",
      channel: "EMAIL",
      subject: "Leave OK",
      body: "Enjoy {{leaveType}}",
      active: true,
    };
    expect(
      (await call(f, "notifications/templates", "PUT", "hr", body)).status,
    ).toBe(403);
    expect(
      (
        await call(f, "notifications/templates", "PUT", "admin", {
          ...body,
          event: "not.real",
        })
      ).status,
    ).toBe(422);
    await call(f, "notifications/templates", "PUT", "admin", body);
    const list = (await call(f, "notifications/templates", "GET", "admin")).body
      .data;
    expect(
      list.find((t: { event: string }) => t.event === "leave.approved").email
        .subject,
    ).toBe("Leave OK");
  });
});
