import { z } from "zod";
import { AppError } from "@/lib/errors";
import { assertPublicUrl } from "@/modules/integrations/outbound";
import { zonedTime } from "@/modules/time/rules";

// One punch as a device reports it. Times are converted to UTC here; the
// sync service decides check-in/check-out from the employee's work day.
export type RawPunch = {
  deviceUserId: string;
  punchedAt: Date;
  directionHint?: string | null;
  verifyMode?: string | null;
  raw?: Record<string, unknown>;
};
export const deviceVendors = [
  "ZKTECO",
  "ESSL",
  "HIKVISION",
  "SUPREMA",
  "GENERIC",
] as const;
export type DeviceVendor = (typeof deviceVendors)[number];
// How each vendor connects. ZKTeco and eSSL terminals push over the ADMS
// ("iclock") protocol; Hikvision pushes ISAPI event notifications; Suprema is
// polled through BioStar 2; generic devices or local agents push JSON.
export const vendorMode: Record<DeviceVendor, "PUSH" | "PULL"> = {
  ZKTECO: "PUSH",
  ESSL: "PUSH",
  HIKVISION: "PUSH",
  SUPREMA: "PULL",
  GENERIC: "PUSH",
};

const userId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "Device user IDs are letters, digits, . _ -");

// Device wall-clock time ("YYYY-MM-DD HH:MM:SS") in the device time zone.
export function deviceTime(value: string, timezone: string) {
  const m = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, day, h, min, sec] = m;
  if (Number(h) > 23 || Number(min) > 59 || Number(sec ?? 0) > 59) return null;
  const at = new Date(
    zonedTime(day, Number(h) * 60 + Number(min), timezone).getTime() +
      Number(sec ?? 0) * 1000,
  );
  return Number.isNaN(at.getTime()) ? null : at;
}
function isoOrLocal(value: string, timezone: string) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return deviceTime(value, timezone);
}
const plausible = (at: Date) =>
  at.getTime() > Date.UTC(2000, 0, 1) && at.getTime() < Date.now() + 86400000;

// ZKTeco / eSSL ADMS ATTLOG upload: one tab-separated line per punch:
// PIN, date time, status (0 in, 1 out, ...), verify mode, work code, ...
export function parseAdmsAttlog(body: string, timezone: string) {
  const punches: RawPunch[] = [];
  let rejected = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [pin, time, status, verify] = line.split("\t");
    const at = time ? deviceTime(time, timezone) : null;
    if (!userId.safeParse(pin?.trim()).success || !at || !plausible(at)) {
      rejected++;
      continue;
    }
    punches.push({
      deviceUserId: pin.trim(),
      punchedAt: at,
      directionHint:
        status === "0" ? "IN" : status === "1" ? "OUT" : (status ?? null),
      verifyMode: verify ?? null,
      raw: { line: line.slice(0, 300) },
    });
  }
  return { punches, rejected };
}

// Hikvision ISAPI event notifications. Access events carry the enrolled
// employee number; other events (door, alarm, heartbeat) are ignored.
export function parseHikvisionEvents(events: unknown[], timezone: string) {
  const punches: RawPunch[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const event = e as Record<string, unknown>;
    const acs = event.AccessControllerEvent as
      Record<string, unknown> | undefined;
    const employee = acs?.employeeNoString ?? acs?.employeeNo;
    const time = event.dateTime;
    if (employee === undefined || typeof time !== "string") continue;
    const id = userId.safeParse(String(employee));
    const at = isoOrLocal(time, timezone);
    if (!id.success || !at || !plausible(at)) continue;
    punches.push({
      deviceUserId: id.data,
      punchedAt: at,
      directionHint:
        acs?.attendanceStatus === "checkIn"
          ? "IN"
          : acs?.attendanceStatus === "checkOut"
            ? "OUT"
            : null,
      verifyMode: acs?.currentVerifyMode ? String(acs.currentVerifyMode) : null,
      raw: {
        majorEventType: acs?.majorEventType ?? null,
        subEventType: acs?.subEventType ?? null,
        serialNo: acs?.serialNo ?? null,
      },
    });
  }
  return punches;
}

// Generic JSON push for other devices and on-premises connector agents.
export const genericPushSchema = z
  .object({
    punches: z
      .array(
        z
          .object({
            deviceUserId: userId,
            punchedAt: z.string().max(40),
            direction: z.enum(["IN", "OUT"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export function parseGenericPush(
  body: z.infer<typeof genericPushSchema>,
  timezone: string,
) {
  return body.punches.map((p, i) => {
    const at = isoOrLocal(p.punchedAt, timezone);
    if (!at || !plausible(at))
      throw new AppError(422, `Punch ${i + 1} has an invalid time.`);
    return {
      deviceUserId: p.deviceUserId,
      punchedAt: at,
      directionHint: p.direction ?? null,
    } satisfies RawPunch;
  });
}

// Suprema BioStar 2 event search. Authentication (verify / identify) success
// events are 0x1000-0x10FF and 0x1300-0x13FF.
const successCode = (code: number) =>
  (code >= 4096 && code <= 4351) || (code >= 4864 && code <= 5119);
const biostarRows = z.object({
  EventCollection: z
    .object({
      rows: z
        .array(
          z
            .object({
              datetime: z.string(),
              user_id: z.object({ user_id: z.string() }).partial().optional(),
              device_id: z.object({ id: z.string() }).partial().optional(),
              event_type_id: z
                .object({ code: z.string() })
                .partial()
                .optional(),
            })
            .passthrough(),
        )
        .default([]),
    })
    .default({ rows: [] }),
});
export async function pullBiostar(
  device: {
    endpoint: string | null;
    username: string | null;
    serialNumber: string;
  },
  secret: string,
  from: Date,
  to: Date,
  timezone: string,
) {
  if (!device.endpoint || !device.username)
    throw new AppError(422, "Set the BioStar 2 server URL and login.");
  const base = await assertPublicUrl(device.endpoint);
  const call = async (path: string, body: unknown, session?: string) => {
    const res = await fetch(new URL(path, base), {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        ...(session ? { "bs-session-id": session } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new AppError(502, `BioStar 2 returned HTTP ${res.status}.`);
    return res;
  };
  const login = await call("/api/login", {
    User: { login_id: device.username, password: secret },
  });
  const session = login.headers.get("bs-session-id");
  if (!session) throw new AppError(502, "BioStar 2 did not start a session.");
  const res = await call(
    "/api/events/search",
    {
      Query: {
        limit: 5000,
        conditions: [
          {
            column: "datetime",
            operator: 3,
            values: [from.toISOString(), to.toISOString()],
          },
          {
            column: "device_id.id",
            operator: 2,
            values: [device.serialNumber],
          },
        ],
        orders: [{ column: "datetime", descending: false }],
      },
    },
    session,
  );
  const parsed = biostarRows.safeParse(await res.json());
  if (!parsed.success)
    throw new AppError(502, "BioStar 2 returned an unexpected response.");
  const punches: RawPunch[] = [];
  for (const row of parsed.data.EventCollection.rows) {
    const code = Number(row.event_type_id?.code);
    const user = userId.safeParse(row.user_id?.user_id);
    const at = isoOrLocal(row.datetime, timezone);
    if (!successCode(code) || !user.success || !at || !plausible(at)) continue;
    if (row.device_id?.id && row.device_id.id !== device.serialNumber) continue;
    punches.push({
      deviceUserId: user.data,
      punchedAt: at,
      verifyMode: String(code),
      raw: { eventCode: code },
    });
  }
  return punches;
}
