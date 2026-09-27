import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 9: configurable rating scale, peer reviews, calibration, OKR key
// results and history.
const f = new Fixture();
let a = "";
let cycle = "";
let review = "";

beforeAll(async () => {
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("manager", a, "Department Manager");
  await f.user("staff", a, "Employee", { managerOf: "manager" });
  await f.user("peer1", a, "Employee");
  await f.user("peer2", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  const where = { companyId: { in: f.companies } };
  await db.peerReview.deleteMany({ where });
  await db.goal.updateMany({ where, data: { parentId: null } });
  await db.goal.deleteMany({ where });
  await db.performanceReview.deleteMany({ where });
  await db.reviewCycle.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 9 performance", () => {
  it("creates a cycle with a custom rating scale and peer reviews", async () => {
    expect(
      (
        await call(f, "performance/cycles", "POST", "admin", {
          name: "Bad labels",
          periodStart: "2026-04-01",
          periodEnd: "2026-09-30",
          selfReview: true,
          ratingScale: 4,
          ratingLabels: ["Low", "High"],
        })
      ).status,
    ).toBe(422);
    const c = await call(f, "performance/cycles", "POST", "admin", {
      name: "H1 2026",
      periodStart: "2026-04-01",
      periodEnd: "2026-09-30",
      selfReview: true,
      peerReview: true,
      ratingScale: 4,
      ratingLabels: ["Below", "Meets", "Exceeds", "Outstanding"],
    });
    cycle = c.body.data.id;
    expect(c.body.data.ratingScale).toBe(4);
    await call(f, `performance/cycles/${cycle}/launch`, "POST", "admin");
    review = (
      await db.performanceReview.findFirstOrThrow({
        where: { cycleId: cycle, employeeId: f.employees.staff },
      })
    ).id;
    // Ratings above the cycle's scale are refused.
    expect(
      (
        await call(f, `performance/reviews/${review}/self`, "PUT", "staff", {
          selfRating: 5,
          selfComments: "Delivered the payroll project.",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(f, `performance/reviews/${review}/self`, "PUT", "staff", {
          selfRating: 3,
          selfComments: "Delivered the payroll project.",
        })
      ).body.data.status,
    ).toBe("PENDING_MANAGER");
  });

  it("collects peer reviews that the employee sees only as an unnamed summary", async () => {
    expect(
      (
        await call(f, `performance/reviews/${review}/peers`, "POST", "staff", {
          employeeIds: [f.employees.peer1],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          f,
          `performance/reviews/${review}/peers`,
          "POST",
          "manager",
          {
            employeeIds: [f.employees.staff],
          },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          f,
          `performance/reviews/${review}/peers`,
          "POST",
          "manager",
          {
            employeeIds: [f.employees.other],
          },
        )
      ).status,
    ).toBe(404);
    const asked = await call(
      f,
      `performance/reviews/${review}/peers`,
      "POST",
      "manager",
      { employeeIds: [f.employees.peer1, f.employees.peer2] },
    );
    expect(asked.body.data).toHaveLength(2);
    const mine = (await call(f, "performance/peer-reviews", "GET", "peer1"))
      .body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0].review.employee.firstName).toBe("staff");
    expect(
      (
        await call(
          f,
          `performance/peer-reviews/${mine[0].id}`,
          "PUT",
          "peer2",
          {
            rating: 3,
            comments: "Not mine",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          f,
          `performance/peer-reviews/${mine[0].id}`,
          "PUT",
          "peer1",
          {
            rating: 9,
            comments: "Too high",
          },
        )
      ).status,
    ).toBe(422);
    await call(f, `performance/peer-reviews/${mine[0].id}`, "PUT", "peer1", {
      rating: 4,
      comments: "Always helps the team.",
    });
    expect(
      (
        await call(
          f,
          `performance/peer-reviews/${mine[0].id}`,
          "PUT",
          "peer1",
          {
            rating: 3,
            comments: "Again",
          },
        )
      ).status,
    ).toBe(409);
    const p2 = (await call(f, "performance/peer-reviews", "GET", "peer2")).body
      .data[0];
    await call(f, `performance/peer-reviews/${p2.id}`, "PUT", "peer2", {
      decline: true,
    });

    // Before completion the employee sees no peer input or manager rating.
    const early = (
      await call(f, `performance/reviews/${review}`, "GET", "staff")
    ).body.data;
    expect(early.peers).toBeNull();
    const managerView = (
      await call(f, `performance/reviews/${review}`, "GET", "manager")
    ).body.data;
    expect(managerView.peers).toMatchObject({
      requested: 2,
      submitted: 1,
      averageRating: 4,
    });
    expect(managerView.peers.items[0].reviewer.firstName).toBe("peer1");

    const done = await call(
      f,
      `performance/reviews/${review}/manager`,
      "PUT",
      "manager",
      { managerRating: 3, managerComments: "Solid half year." },
    );
    expect(done.body.data).toMatchObject({
      status: "COMPLETED",
      finalRating: 3,
    });
    const after = (
      await call(f, `performance/reviews/${review}`, "GET", "staff")
    ).body.data;
    expect(after.peers).toEqual({
      requested: 2,
      submitted: 1,
      averageRating: 4,
      comments: ["Always helps the team."],
    });
    expect(JSON.stringify(after)).not.toContain("peer1");
    // Peers can no longer respond once the review is completed.
    expect(
      (
        await call(f, `performance/peer-reviews/${p2.id}`, "PUT", "peer2", {
          rating: 2,
          comments: "Late",
        })
      ).status,
    ).toBe(409);
  });

  it("lets HR calibrate the final rating with a reason", async () => {
    expect(
      (
        await call(
          f,
          `performance/reviews/${review}/calibrate`,
          "POST",
          "manager",
          {
            finalRating: 4,
            note: "Moderation",
          },
        )
      ).status,
    ).toBe(403);
    const cal = await call(
      f,
      `performance/reviews/${review}/calibrate`,
      "POST",
      "admin",
      { finalRating: 4, note: "Calibrated with peer input" },
    );
    expect(cal.body.data).toMatchObject({ finalRating: 4, managerRating: 3 });
    const own = (await call(f, `performance/reviews/${review}`, "GET", "staff"))
      .body.data;
    expect(own.finalRating).toBe(4);
    expect(own.calibrationNote).toBeNull();
    const history = (await call(f, "performance/history", "GET", "staff")).body
      .data;
    expect(history[0]).toMatchObject({
      finalRating: 4,
      calibrated: true,
      peerAverage: 4,
      managerRating: 3,
    });
    expect(
      (
        await call(
          f,
          `performance/history?employeeId=${f.employees.staff}`,
          "GET",
          "peer1",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          f,
          `performance/history?employeeId=${f.employees.staff}`,
          "GET",
          "other",
        )
      ).status,
    ).toBe(404);
  });

  it("rolls OKR key results up into the objective", async () => {
    const goal = (body: Record<string, unknown>) =>
      call(f, "performance/goals", "POST", "manager", {
        employeeId: f.employees.staff,
        cycleId: cycle,
        ...body,
      });
    const objective = (await goal({ type: "OKR", title: "Launch payroll" }))
      .body.data;
    expect(
      (await goal({ type: "KEY_RESULT", title: "No parent" })).status,
    ).toBe(422);
    const kr = async (title: string, weight: number) =>
      (
        await goal({
          type: "KEY_RESULT",
          title,
          weight,
          parentId: objective.id,
        })
      ).body.data;
    const k1 = await kr("Ten customers live", 75);
    const k2 = await kr("Zero payroll errors", 25);
    for (const g of [objective, k1, k2])
      await call(f, `performance/goals/${g.id}/status`, "POST", "manager", {
        status: "APPROVED",
      });
    await call(f, `performance/goals/${k1.id}/progress`, "PUT", "staff", {
      progress: 80,
      actual: "8",
    });
    await call(f, `performance/goals/${k2.id}/progress`, "PUT", "staff", {
      progress: 40,
      actual: null,
    });
    expect(
      (await db.goal.findUniqueOrThrow({ where: { id: objective.id } }))
        .progress,
    ).toBe(70);
    expect(
      (
        await call(
          f,
          `performance/goals/${objective.id}/progress`,
          "PUT",
          "staff",
          {
            progress: 100,
            actual: null,
          },
        )
      ).status,
    ).toBe(409);
    // A key result cannot hang off another employee's objective.
    const foreign = await call(f, "performance/goals", "POST", "manager", {
      type: "KEY_RESULT",
      title: "Wrong owner",
      parentId: objective.id,
    });
    expect(foreign.status).toBe(404);
  });
});
