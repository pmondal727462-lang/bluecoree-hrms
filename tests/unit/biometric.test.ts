import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceTime,
  parseAdmsAttlog,
  parseGenericPush,
  parseHikvisionEvents,
  pullBiostar,
} from "../../src/modules/biometric/connectors";

afterEach(() => vi.unstubAllGlobals());

describe("biometric connectors", () => {
  it("reads device wall-clock time in the device time zone", () => {
    expect(
      deviceTime("2026-09-14 09:05:30", "Asia/Kolkata")?.toISOString(),
    ).toBe("2026-09-14T03:35:30.000Z");
    expect(deviceTime("2026-09-14 25:00:00", "UTC")).toBeNull();
  });

  it("parses ZKTeco/eSSL ADMS ATTLOG lines and rejects malformed ones", () => {
    const body = [
      "1001\t2026-09-14 09:05:00\t0\t1\t0\t0",
      "1001\t2026-09-14 18:10:00\t1\t1\t0\t0",
      "bad user\t2026-09-14 09:00:00\t0\t1",
      "1002\tnot-a-time\t0\t1",
      "",
    ].join("\n");
    const { punches, rejected } = parseAdmsAttlog(body, "UTC");
    expect(rejected).toBe(2);
    expect(
      punches.map((p) => [
        p.deviceUserId,
        p.punchedAt.toISOString(),
        p.directionHint,
      ]),
    ).toEqual([
      ["1001", "2026-09-14T09:05:00.000Z", "IN"],
      ["1001", "2026-09-14T18:10:00.000Z", "OUT"],
    ]);
  });

  it("keeps only Hikvision access events with an employee number", () => {
    const punches = parseHikvisionEvents(
      [
        {
          dateTime: "2026-09-14T09:01:02+05:30",
          eventType: "AccessControllerEvent",
          AccessControllerEvent: {
            employeeNoString: "E42",
            majorEventType: 5,
            subEventType: 75,
            attendanceStatus: "checkIn",
          },
        },
        { dateTime: "2026-09-14T09:02:00+05:30", eventType: "heartBeat" },
        "not an object",
      ],
      "UTC",
    );
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({
      deviceUserId: "E42",
      directionHint: "IN",
    });
    expect(punches[0].punchedAt.toISOString()).toBe("2026-09-14T03:31:02.000Z");
  });

  it("validates generic JSON pushes", () => {
    const punches = parseGenericPush(
      {
        punches: [
          { deviceUserId: "7", punchedAt: "2026-09-14 08:00:00" },
          {
            deviceUserId: "7",
            punchedAt: "2026-09-14T17:00:00Z",
            direction: "OUT",
          },
        ],
      },
      "Asia/Kolkata",
    );
    expect(punches.map((p) => p.punchedAt.toISOString())).toEqual([
      "2026-09-14T02:30:00.000Z",
      "2026-09-14T17:00:00.000Z",
    ]);
    expect(() =>
      parseGenericPush(
        { punches: [{ deviceUserId: "7", punchedAt: "yesterday" }] },
        "UTC",
      ),
    ).toThrow(/invalid time/);
  });

  it("pulls authentication-success events from BioStar 2 for the device", async () => {
    const calls: { url: string; body: unknown; session: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const headers = new Headers(init.headers);
        calls.push({
          url: String(url),
          body: JSON.parse(String(init.body)),
          session: headers.get("bs-session-id"),
        });
        if (String(url).endsWith("/api/login"))
          return new Response("{}", { headers: { "bs-session-id": "S1" } });
        return Response.json({
          EventCollection: {
            rows: [
              {
                datetime: "2026-09-14T03:31:00.00Z",
                user_id: { user_id: "501" },
                device_id: { id: "5001" },
                event_type_id: { code: "4867" },
              },
              {
                datetime: "2026-09-14T03:32:00.00Z",
                user_id: { user_id: "501" },
                device_id: { id: "5001" },
                event_type_id: { code: "6401" },
              },
              {
                datetime: "2026-09-14T03:33:00.00Z",
                user_id: { user_id: "502" },
                device_id: { id: "9999" },
                event_type_id: { code: "4867" },
              },
            ],
          },
        });
      }),
    );
    const punches = await pullBiostar(
      {
        endpoint: "https://93.184.216.34",
        username: "api",
        serialNumber: "5001",
      },
      "secret",
      new Date("2026-09-14T00:00:00Z"),
      new Date("2026-09-15T00:00:00Z"),
      "UTC",
    );
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ deviceUserId: "501" });
    expect(calls[1].session).toBe("S1");
    await expect(
      pullBiostar(
        {
          endpoint: "https://127.0.0.1",
          username: "api",
          serialNumber: "5001",
        },
        "secret",
        new Date(),
        new Date(),
        "UTC",
      ),
    ).rejects.toThrow(/Private or local/);
  });
});
