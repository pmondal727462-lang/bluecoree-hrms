import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 8: public careers page, pipeline stages and the offer lifecycle.
const f = new Fixture();
let a = "";
let job = "";
let draftJob = "";
const pdf = {
  name: "resume.pdf",
  type: "application/pdf",
  base64: Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  ).toString("base64"),
};
const apply = (body: Record<string, unknown>, jobId = job, code = f.codes[0]) =>
  call(f, `public/careers/${code}/jobs/${jobId}/apply`, "POST", "", {
    name: "Asha Rao",
    email: "asha@example.com",
    resume: pdf,
    consent: true,
    ...body,
  });
const tokenOf = (link: string) => link.split("/offer/")[1];

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  await db.offer.deleteMany({ where: { companyId: { in: f.companies } } });
  await db.jobOpening.deleteMany({
    where: { companyId: { in: f.companies } },
  });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 8 recruitment", () => {
  it("publishes open jobs on the careers page only when enabled", async () => {
    const make = (title: string, status: string) =>
      call(f, "recruitment/jobs", "POST", "admin", {
        title,
        employmentType: "Full time",
        openings: 2,
        description: `${title} role`,
        status,
      });
    job = (await make("Backend engineer", "OPEN")).body.data.id;
    draftJob = (await make("Secret project", "DRAFT")).body.data.id;
    await call(f, "recruitment/jobs", "POST", "other", {
      title: "Other tenant job",
      employmentType: "Full time",
      openings: 1,
      description: "x",
      status: "OPEN",
    });
    expect(
      (await call(f, `public/careers/${f.codes[0]}`, "GET", "")).status,
    ).toBe(404);
    expect(
      (
        await call(f, "recruitment/careers", "PUT", "staff", {
          enabled: true,
        })
      ).status,
    ).toBe(403);
    const saved = await call(f, "recruitment/careers", "PUT", "admin", {
      enabled: true,
      intro: "We build HR software.",
    });
    expect(saved.body.data.url).toContain(`/careers/${f.codes[0]}`);
    const page = (await call(f, `public/careers/${f.codes[0]}`, "GET", "")).body
      .data;
    expect(page.company.intro).toBe("We build HR software.");
    expect(page.jobs.map((j: { title: string }) => j.title)).toEqual([
      "Backend engineer",
    ]);
  });

  it("accepts applications with consent and a PDF resume", async () => {
    expect((await apply({ consent: false })).status).toBe(422);
    expect(
      (
        await apply({
          resume: { name: "cv.txt", type: "text/plain", base64: "aGVsbG8=" },
        })
      ).status,
    ).toBe(422);
    expect((await apply({}, draftJob)).status).toBe(404);
    const ok = await apply({ phone: "9876543210", experienceYears: 4 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.received).toBe(true);
    // A repeat and a honeypot submission look the same but add nothing.
    expect((await apply({})).body.data.received).toBe(true);
    expect(
      (await apply({ email: "bot@example.com", website: "http://spam" })).body
        .data.received,
    ).toBe(true);
    const saved = await db.candidate.findMany({ where: { jobId: job } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      source: "Careers page",
      stage: "APPLIED",
      experienceYears: 4,
    });
    expect(saved[0].consentAt).toBeInstanceOf(Date);
    const found = await call(
      f,
      "recruitment/candidates?q=asha",
      "GET",
      "admin",
    );
    expect(found.body.data).toHaveLength(1);
  });

  it("moves through shortlisted and selected, then requires an accepted offer to hire", async () => {
    const c = await db.candidate.findFirstOrThrow({ where: { jobId: job } });
    for (const stage of ["SCREENING", "SHORTLISTED", "SELECTED"])
      expect(
        (
          await call(
            f,
            `recruitment/candidates/${c.id}/stage`,
            "POST",
            "admin",
            {
              stage,
            },
          )
        ).body.data.stage,
      ).toBe(stage);
    const later = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const offer = await call(
      f,
      `recruitment/candidates/${c.id}/offers`,
      "POST",
      "admin",
      {
        annualCtc: 1200000,
        joiningDate: later(30),
        expiresOn: later(7),
        terms: "Probation of six months.",
      },
    );
    expect(offer.body.data.status).toBe("DRAFT");
    expect(
      (await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).stage,
    ).toBe("OFFER");
    expect(
      (
        await call(
          f,
          `recruitment/candidates/${c.id}/offers`,
          "POST",
          "admin",
          {
            annualCtc: 1,
            joiningDate: later(30),
            expiresOn: later(7),
          },
        )
      ).status,
    ).toBe(409);
    const hire = {
      employeeCode: "ASHA1",
      joinedAt: later(30),
    };
    const early = await call(
      f,
      `recruitment/candidates/${c.id}/hire`,
      "POST",
      "admin",
      hire,
    );
    expect(early.body.errorCode).toBe("OFFER_NOT_ACCEPTED");
    const letter = await call(
      f,
      `recruitment/offers/${offer.body.data.id}/letter`,
      "GET",
      "admin",
    );
    expect(letter.headers.get("content-type")).toBe("application/pdf");
    expect(
      (
        await call(
          f,
          `recruitment/offers/${offer.body.data.id}`,
          "GET",
          "other",
        )
      ).status,
    ).toBe(404);
    const sent = await call(
      f,
      `recruitment/offers/${offer.body.data.id}/send`,
      "POST",
      "admin",
    );
    const token = tokenOf(sent.body.data.link);
    const view = (await call(f, `public/offers/${token}`, "GET", "")).body.data;
    expect(view).toMatchObject({
      candidate: "Asha Rao",
      role: "Backend engineer",
      annualCtc: 1200000,
      status: "SENT",
    });
    expect((await call(f, `public/offers/not-a-token`, "GET", "")).status).toBe(
      404,
    );
    const accepted = await call(f, `public/offers/${token}`, "POST", "", {
      decision: "ACCEPT",
      note: "Looking forward to it",
    });
    expect(accepted.body.data.status).toBe("ACCEPTED");
    expect(
      (
        await call(f, `public/offers/${token}`, "POST", "", {
          decision: "DECLINE",
        })
      ).status,
    ).toBe(409);
    const hired = await call(
      f,
      `recruitment/candidates/${c.id}/hire`,
      "POST",
      "admin",
      hire,
    );
    expect(hired.status).toBe(200);
    const events = await db.candidateEvent.findMany({
      where: { candidateId: c.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.toStage)).toEqual([
      "APPLIED",
      "SCREENING",
      "SHORTLISTED",
      "SELECTED",
      "OFFER",
      "OFFER",
      "HIRED",
    ]);
  });

  it("records declined, withdrawn and expired offers", async () => {
    const later = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const make = async (email: string) => {
      await apply({ email, name: `Cand ${email}` });
      const c = await db.candidate.findFirstOrThrow({ where: { email } });
      const o = await call(
        f,
        `recruitment/candidates/${c.id}/offers`,
        "POST",
        "admin",
        { annualCtc: 800000, joiningDate: later(20), expiresOn: later(5) },
      );
      const sent = await call(
        f,
        `recruitment/offers/${o.body.data.id}/send`,
        "POST",
        "admin",
      );
      return { c, id: o.body.data.id, token: tokenOf(sent.body.data.link) };
    };
    const declined = await make("decline@example.com");
    expect(
      (
        await call(f, `public/offers/${declined.token}`, "POST", "", {
          decision: "DECLINE",
          note: "Accepted another offer",
        })
      ).body.data.status,
    ).toBe("DECLINED");
    // After a decline the candidate cannot be hired on that offer, but a new
    // offer may be made.
    expect(
      (
        await call(
          f,
          `recruitment/candidates/${declined.c.id}/hire`,
          "POST",
          "admin",
          { employeeCode: "DEC1", joinedAt: later(20) },
        )
      ).body.errorCode,
    ).toBe("OFFER_NOT_ACCEPTED");

    const withdrawn = await make("withdraw@example.com");
    expect(
      (
        await call(
          f,
          `recruitment/offers/${withdrawn.id}/withdraw`,
          "POST",
          "admin",
          { note: "Role put on hold" },
        )
      ).body.data.status,
    ).toBe("WITHDRAWN");
    expect(
      (await call(f, `public/offers/${withdrawn.token}`, "GET", "")).status,
    ).toBe(404);

    const expired = await make("late@example.com");
    await db.offer.update({
      where: { id: expired.id },
      data: { expiresOn: new Date(Date.now() - 86400000) },
    });
    expect(
      (await call(f, `public/offers/${expired.token}`, "GET", "")).body.data
        .status,
    ).toBe("EXPIRED");
    expect(
      (
        await call(f, `public/offers/${expired.token}`, "POST", "", {
          decision: "ACCEPT",
        })
      ).status,
    ).toBe(410);
  });
});
