import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

const f = new Fixture();
let a = "";
let accepted = true;
const sample = (n: number | string) =>
  `data:image/jpeg;base64,${Buffer.from(`face-${n}-${f.prefix}`).toString("base64").replace(/=+$/, "")}`;
beforeAll(async () => {
  vi.stubEnv("FACE_PROVIDER_URL", "https://face.example.test");
  vi.stubEnv("FACE_PROVIDER_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json({
        requestId: body.requestId,
        template: "template",
        confidence: accepted ? 0.95 : 0.1,
        livenessPassed: true,
        status: accepted ? "SUCCESS" : "FAILED",
      });
    }),
  );
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("peer", a, "Employee");
  await f.user("other", f.companies[1], "Company Admin");
  await db.employee.updateMany({
    where: { id: { in: [f.employees.staff, f.employees.peer] } },
    data: { faceRequired: true, attendanceMode: "OPEN" },
  });
  for (const who of ["staff", "peer"])
    expect(
      (
        await call(f, "face/enroll", "POST", who, {
          faceSample: sample(`enrol-${who}`),
          consent: true,
        })
      ).status,
    ).toBe(200);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 5 face attendance", () => {
  it("locks face scans after repeated failures", async () => {
    accepted = false;
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call(f, "time/face-punch", "POST", "staff", {
            faceSample: sample(`fail-${i}`),
          })
        ).status,
      ).toBe(403);
    const locked = await call(f, "time/face-punch", "POST", "staff", {
      faceSample: sample("fail-6"),
    });
    expect(locked.status).toBe(429);
    expect(locked.body.errorCode).toBe("FACE_LOCKED");
    accepted = true;
  });

  it("rejects a replayed face image", async () => {
    const first = await call(f, "time/face-punch", "POST", "peer", {
      faceSample: sample("live-1"),
    });
    expect(first.status).toBe(200);
    expect(first.body.data.source).toBe("Face");
    const replay = await call(f, "time/face-punch", "POST", "peer", {
      faceSample: sample("live-1"),
    });
    expect(replay.status).toBe(403);
    expect(replay.body.errorCode).toBe("FACE_REPLAYED");
  });

  it("allows labelled fallback attendance only when the policy permits it", async () => {
    // Face required, no fallback: the locked-out employee cannot mark attendance.
    expect((await call(f, "time/check-in", "POST", "staff", {})).status).toBe(
      429,
    );
    expect((await call(f, "time/check-in", "POST", "peer", {})).status).toBe(
      422,
    );
    expect(
      (
        await call(f, "time/policy", "PUT", "admin", {
          faceFallback: "WEB",
          faceMaxFailedAttempts: 5,
          faceLockoutMinutes: 15,
          gpsTrackingEnabled: false,
          geofenceEnabled: false,
          latitude: null,
          longitude: null,
          radiusMeters: 200,
        })
      ).status,
    ).toBe(200);
    const summary = await call(f, "time/summary", "GET", "staff");
    expect(summary.body.data.faceRules).toEqual({
      maxFailed: 5,
      lockoutMinutes: 15,
      fallback: "WEB",
    });
    const fallback = await call(f, "time/check-in", "POST", "staff", {});
    expect(fallback.status).toBe(200);
    expect(fallback.body.data.source).toBe("Face fallback");
    expect(
      await db.attendancePunch.count({
        where: { attendanceId: fallback.body.data.id, source: "Face fallback" },
      }),
    ).toBe(1);
  });

  it("gives HR enrolment status, verification logs and profile reset", async () => {
    const profiles = await call(f, "face/profiles", "GET", "admin");
    const staff = profiles.body.data.items.find(
      (p: { id: string }) => p.id === f.employees.staff,
    );
    expect(staff.faceProfile).toBeTruthy();
    expect(staff.failedLast24h).toBeGreaterThanOrEqual(5);
    const logs = await call(f, "face/logs?status=FAILED", "GET", "admin");
    expect(logs.body.data.total).toBeGreaterThanOrEqual(6);
    expect(
      logs.body.data.items.some(
        (l: { reason: string }) => l.reason === "REPLAYED_SAMPLE",
      ),
    ).toBe(true);
    expect(JSON.stringify(logs.body.data.items)).not.toContain("template");
    expect((await call(f, "face/logs", "GET", "staff")).status).toBe(403);
    expect((await call(f, "face/logs", "GET", "other")).body.data.total).toBe(
      0,
    );
    expect(
      (await call(f, `face/profiles/${f.employees.staff}`, "DELETE", "other"))
        .status,
    ).toBe(404);
    expect(
      (await call(f, `face/profiles/${f.employees.staff}`, "DELETE", "admin"))
        .body.data,
    ).toEqual({ reset: true });
    expect(
      (await call(f, "face/status", "GET", "staff")).body.data,
    ).toMatchObject({ enrolled: false });
  });
});
