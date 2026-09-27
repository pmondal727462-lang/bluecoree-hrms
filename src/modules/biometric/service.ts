import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, jobScope, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt, digest, encrypt } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assignedSubscription, requireFeature } from "@/modules/saas/service";
import { assertPublicUrl } from "@/modules/integrations/outbound";
import {
  deviceVendors,
  genericPushSchema,
  parseAdmsAttlog,
  parseGenericPush,
  parseHikvisionEvents,
  pullBiostar,
  vendorMode,
  type DeviceVendor,
} from "./connectors";
import { allowedIp, ingest, processPending, type SyncTrigger } from "./sync";

const onlineWindow = 10 * 60000;
const text = (max: number) => z.string().trim().max(max);
const timezone = z
  .string()
  .max(60)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");
const deviceSchema = z
  .object({
    name: text(100).min(2),
    vendor: z.enum(deviceVendors),
    model: text(100).nullable().default(null),
    serialNumber: text(64)
      .min(3)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Use the serial number shown on the device"),
    locationId: z.string().nullable().default(null),
    timezone: timezone.nullable().default(null),
    endpoint: z.string().trim().max(300).nullable().default(null),
    username: text(100).nullable().default(null),
    secret: z.string().max(200).nullable().default(null),
    ipAllowlist: z.array(z.ipv4().or(z.ipv6())).max(20).default([]),
    autoMapByCode: z.boolean().default(true),
    syncIntervalMinutes: z.number().int().min(5).max(1440).default(15),
    active: z.boolean().default(true),
  })
  .strict();
const updateSchema = deviceSchema
  .omit({ vendor: true, serialNumber: true })
  .partial()
  .strict();
const mappingSchema = z
  .object({
    mappings: z
      .array(
        z
          .object({
            deviceUserId: text(64)
              .min(1)
              .regex(/^[A-Za-z0-9_.-]+$/),
            employeeId: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).default(""),
  deviceId: z.string().optional(),
  status: z
    .enum(["PENDING", "PROCESSED", "UNMAPPED", "IGNORED", "REJECTED", "FAILED"])
    .optional(),
});

// Fields safe to return; credentials and token hashes never leave the server.
const publicDevice = {
  id: true,
  name: true,
  vendor: true,
  model: true,
  serialNumber: true,
  mode: true,
  locationId: true,
  location: { select: { id: true, name: true } },
  timezone: true,
  endpoint: true,
  username: true,
  secretEncrypted: true,
  pushTokenHash: true,
  ipAllowlist: true,
  autoMapByCode: true,
  syncIntervalMinutes: true,
  pendingCommand: true,
  active: true,
  lastSeenAt: true,
  lastSyncAt: true,
  lastPunchAt: true,
  lastError: true,
  createdAt: true,
} satisfies Prisma.AttendanceDeviceSelect;
type DeviceRow = Prisma.AttendanceDeviceGetPayload<{
  select: typeof publicDevice;
}>;
function view(d: DeviceRow) {
  const { secretEncrypted, pushTokenHash, ...rest } = d;
  const seen = d.mode === "PULL" ? d.lastSyncAt : d.lastSeenAt;
  return {
    ...rest,
    hasSecret: !!secretEncrypted,
    hasPushToken: !!pushTokenHash,
    status: !d.active
      ? "INACTIVE"
      : !seen
        ? "NEVER_CONNECTED"
        : d.lastError
          ? "ERROR"
          : Date.now() - seen.getTime() <=
              (d.mode === "PULL"
                ? d.syncIntervalMinutes * 120000
                : onlineWindow)
            ? "ONLINE"
            : "OFFLINE",
  };
}
const newToken = () => `hrmsdev_${randomBytes(24).toString("base64url")}`;

async function enforceDeviceLimit(companyId: string, excludeId?: string) {
  const limit = (await assignedSubscription(companyId))?.plan.deviceLimit;
  if (limit === null || limit === undefined) return;
  const used = await db.attendanceDevice.count({
    where: {
      companyId,
      active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (used >= limit)
    throw new AppError(
      402,
      `Your plan allows ${limit} active biometric devices. Upgrade the plan to add more.`,
      "PLAN_LIMIT_REACHED",
    );
}
async function companyTimezone(companyId: string) {
  return (
    await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    })
  ).timezone;
}

// Pull devices fetch from their vendor server; push devices are asked to
// resend (ADMS) or simply have waiting punches reprocessed.
async function syncDevice(
  device: Prisma.AttendanceDeviceGetPayload<object>,
  trigger: SyncTrigger,
) {
  if (device.mode === "PULL") {
    if (device.vendor !== "SUPREMA")
      throw new AppError(422, "This device does not support pull sync.");
    if (!device.secretEncrypted)
      throw new AppError(422, "Set the BioStar 2 password first.");
    const tz = device.timezone ?? (await companyTimezone(device.companyId));
    const to = new Date();
    // Overlap the previous window; duplicates are skipped on insert.
    const from = new Date(
      (device.lastSyncAt?.getTime() ?? to.getTime() - 7 * 86400000) - 3600000,
    );
    try {
      const punches = await pullBiostar(
        device,
        decrypt(device.secretEncrypted).secret,
        from,
        to,
        tz,
      );
      return ingest(device, punches, trigger);
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : "Sync failed"
      ).slice(0, 300);
      await db.attendanceDevice.update({
        where: { id: device.id },
        data: { lastError: message },
      });
      await db.deviceSyncLog.create({
        data: {
          companyId: device.companyId,
          deviceId: device.id,
          trigger,
          status: "FAILED",
          error: message,
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }
  if (device.vendor === "ZKTECO" || device.vendor === "ESSL") {
    // The terminal reads its own local wall-clock time.
    const tz = device.timezone ?? (await companyTimezone(device.companyId));
    const since = new Date(Date.now() - 7 * 86400000);
    const stamp = (d: Date) =>
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(d);
    await db.attendanceDevice.update({
      where: { id: device.id },
      data: {
        pendingCommand: `DATA QUERY ATTLOG StartTime=${stamp(since)}\tEndTime=${stamp(new Date())}`,
      },
    });
  }
  const r = await processPending(device.companyId, {
    deviceId: device.id,
    includeUnmapped: true,
  });
  return db.deviceSyncLog.create({
    data: {
      companyId: device.companyId,
      deviceId: device.id,
      trigger,
      status: r.failed ? "PARTIAL" : "SUCCESS",
      processed: r.processed,
      unmapped: r.unmapped,
      failed: r.failed,
      finishedAt: new Date(),
    },
  });
}

export async function biometricRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  const method = req.method;
  const manage = () => requirePermission(ctx, "time.configure");
  if (method === "GET") requirePermission(ctx, "attendance.read");
  else manage();

  if (resource === "devices" && !id && method === "GET") {
    const devices = await db.attendanceDevice.findMany({
      where: { companyId: ctx.companyId },
      select: publicDevice,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const counts = await db.devicePunch.groupBy({
      by: ["deviceId", "status"],
      where: {
        companyId: ctx.companyId,
        status: { in: ["PENDING", "UNMAPPED", "FAILED"] },
      },
      _count: { _all: true },
    });
    return devices.map((d) => ({
      ...view(d),
      waiting: Object.fromEntries(
        counts
          .filter((c) => c.deviceId === d.id)
          .map((c) => [c.status, c._count._all]),
      ),
    }));
  }
  if (resource === "devices" && !id && method === "POST") {
    const b = deviceSchema.parse(await json(req));
    const mode = vendorMode[b.vendor as DeviceVendor];
    if (mode === "PULL") {
      if (!b.endpoint || !b.username || !b.secret)
        throw new AppError(
          422,
          "BioStar 2 needs its server URL, login and password.",
        );
      await assertPublicUrl(b.endpoint);
    }
    if (b.active) await enforceDeviceLimit(ctx.companyId);
    const token =
      b.vendor === "HIKVISION" || b.vendor === "GENERIC" ? newToken() : null;
    const { secret, ...fields } = b;
    let saved;
    try {
      saved = await db.$transaction(async (tx) => {
        const d = await tx.attendanceDevice.create({
          data: {
            ...fields,
            mode,
            companyId: ctx.companyId,
            createdBy: ctx.userId,
            secretEncrypted: secret ? encrypt({ secret }) : null,
            pushTokenHash: token ? digest(token) : null,
          },
          select: publicDevice,
        });
        await audit(
          tx,
          ctx,
          "DEVICE_REGISTER",
          "biometric",
          d.id,
          undefined,
          { vendor: d.vendor, serialNumber: d.serialNumber },
          ip(req),
        );
        return d;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new AppError(
          409,
          "A device with this vendor and serial number is already registered.",
        );
      throw error;
    }
    return { ...view(saved), pushToken: token };
  }

  const device = id
    ? await db.attendanceDevice.findFirst({
        where: { id, companyId: ctx.companyId },
      })
    : null;
  if (resource === "devices" && id && !device)
    throw new AppError(404, "Device not found.", "NOT_FOUND");
  if (resource === "devices" && device && !action && method === "GET")
    return view(
      await db.attendanceDevice.findUniqueOrThrow({
        where: { id: device.id },
        select: publicDevice,
      }),
    );
  if (resource === "devices" && device && !action && method === "PUT") {
    const b = updateSchema.parse(await json(req));
    if (b.endpoint) await assertPublicUrl(b.endpoint);
    if (b.active && !device.active)
      await enforceDeviceLimit(ctx.companyId, device.id);
    const { secret, ...fields } = b;
    const saved = await db.$transaction(async (tx) => {
      const d = await tx.attendanceDevice.update({
        where: { id: device.id },
        data: {
          ...fields,
          ...(secret ? { secretEncrypted: encrypt({ secret }) } : {}),
        },
        select: publicDevice,
      });
      await audit(
        tx,
        ctx,
        "DEVICE_UPDATE",
        "biometric",
        d.id,
        undefined,
        { fields: Object.keys(b) },
        ip(req),
      );
      return d;
    });
    return view(saved);
  }
  if (
    resource === "devices" &&
    device &&
    action === "sync" &&
    method === "POST"
  ) {
    if (!device.active) throw new AppError(409, "Activate the device first.");
    await rateLimit(`device-sync:${device.id}`, 20);
    return syncDevice(device, "MANUAL");
  }
  if (
    resource === "devices" &&
    device &&
    action === "token" &&
    method === "POST"
  ) {
    if (device.vendor !== "HIKVISION" && device.vendor !== "GENERIC")
      throw new AppError(422, "Only push-token devices have a token.");
    const token = newToken();
    await db.$transaction(async (tx) => {
      await tx.attendanceDevice.update({
        where: { id: device.id },
        data: { pushTokenHash: digest(token) },
      });
      await audit(
        tx,
        ctx,
        "DEVICE_TOKEN_ROTATE",
        "biometric",
        device.id,
        undefined,
        undefined,
        ip(req),
      );
    });
    return { pushToken: token };
  }
  if (
    resource === "devices" &&
    device &&
    action === "logs" &&
    method === "GET"
  ) {
    const q = pageSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const where = { companyId: ctx.companyId, deviceId: device.id };
    const [items, total] = await Promise.all([
      db.deviceSyncLog.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.deviceSyncLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  if (resource === "mappings" && !id && method === "GET") {
    const q = pageSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const contains = { contains: q.search, mode: "insensitive" as const };
    const where: Prisma.DeviceUserMappingWhereInput = {
      companyId: ctx.companyId,
      ...(q.search
        ? {
            OR: [
              { deviceUserId: contains },
              { employee: { employeeCode: contains } },
              { employee: { firstName: contains } },
              { employee: { lastName: contains } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.deviceUserMapping.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { deviceUserId: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.deviceUserMapping.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "mappings" && !id && method === "PUT") {
    const b = mappingSchema.parse(await json(req));
    const employeeIds = [...new Set(b.mappings.map((m) => m.employeeId))];
    if (
      (await db.employee.count({
        where: { companyId: ctx.companyId, id: { in: employeeIds } },
      })) !== employeeIds.length
    )
      throw new AppError(404, "Employee not found.");
    await db.$transaction(async (tx) => {
      for (const m of b.mappings)
        await tx.deviceUserMapping.upsert({
          where: {
            companyId_deviceUserId: {
              companyId: ctx.companyId,
              deviceUserId: m.deviceUserId,
            },
          },
          create: { ...m, companyId: ctx.companyId, createdBy: ctx.userId },
          update: { employeeId: m.employeeId },
        });
      await audit(
        tx,
        ctx,
        "DEVICE_MAPPING_UPDATE",
        "biometric",
        undefined,
        undefined,
        { count: b.mappings.length },
        ip(req),
      );
    });
    // Punches that arrived before the mapping are applied now.
    return processPending(ctx.companyId, {
      includeUnmapped: true,
      deviceUserIds: b.mappings.map((m) => m.deviceUserId),
    });
  }
  if (resource === "mappings" && id && method === "DELETE") {
    const m = await db.deviceUserMapping.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!m) throw new AppError(404, "Mapping not found.", "NOT_FOUND");
    await db.$transaction(async (tx) => {
      await tx.deviceUserMapping.delete({ where: { id: m.id } });
      await audit(
        tx,
        ctx,
        "DEVICE_MAPPING_DELETE",
        "biometric",
        m.id,
        { deviceUserId: m.deviceUserId, employeeId: m.employeeId },
        undefined,
        ip(req),
      );
    });
    return { deleted: true };
  }
  if (resource === "unmapped" && !id && method === "GET") {
    const rows = await db.devicePunch.groupBy({
      by: ["deviceUserId"],
      where: { companyId: ctx.companyId, status: "UNMAPPED" },
      _count: { _all: true },
      _max: { punchedAt: true },
      orderBy: { _max: { punchedAt: "desc" } },
      take: 200,
    });
    return rows.map((r) => ({
      deviceUserId: r.deviceUserId,
      punches: r._count._all,
      lastPunchAt: r._max.punchedAt,
    }));
  }
  if (resource === "punches" && !id && method === "GET") {
    const q = pageSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const where: Prisma.DevicePunchWhereInput = {
      companyId: ctx.companyId,
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { deviceUserId: { contains: q.search, mode: "insensitive" } }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.devicePunch.findMany({
        where,
        select: {
          id: true,
          deviceUserId: true,
          punchedAt: true,
          directionHint: true,
          status: true,
          reason: true,
          attempts: true,
          receivedAt: true,
          attendanceId: true,
          device: { select: { id: true, name: true } },
          employee: {
            select: { employeeCode: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ punchedAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.devicePunch.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "punches" && id === "retry" && method === "POST") {
    const b = z
      .object({ deviceId: z.string().optional() })
      .strict()
      .parse(await json(req));
    // Failed punches become due again; unmapped ones are re-checked.
    await db.devicePunch.updateMany({
      where: {
        companyId: ctx.companyId,
        status: "FAILED",
        ...(b.deviceId ? { deviceId: b.deviceId } : {}),
      },
      data: { nextAttemptAt: new Date(), attempts: 0 },
    });
    return processPending(ctx.companyId, {
      deviceId: b.deviceId,
      includeUnmapped: true,
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// ---- Device push endpoints (no user session; called in system scope) ----

async function pushDevice(
  where: Prisma.AttendanceDeviceWhereInput,
  req: NextRequest,
) {
  const device = await db.attendanceDevice.findFirst({
    where: { ...where, active: true, mode: "PUSH" },
  });
  if (!device) throw new AppError(401, "Unknown or inactive device.");
  allowedIp(device.ipAllowlist, ip(req));
  await rateLimit(`device-push:${device.id}`, 600);
  return device;
}
const seen = (id: string) =>
  db.attendanceDevice.update({
    where: { id },
    data: { lastSeenAt: new Date() },
  });

// Generic JSON push: Authorization: Bearer <device token>.
export async function genericPush(req: NextRequest) {
  const token = req.headers
    .get("authorization")
    ?.match(/^Bearer\s+(hrmsdev_\S+)$/)?.[1];
  if (!token) throw new AppError(401, "A device token is required.");
  const device = await pushDevice(
    { pushTokenHash: digest(token), vendor: "GENERIC" },
    req,
  );
  return withTenant(device.companyId, async () => {
    await requireFeature(device.companyId, "biometric");
    const tz = device.timezone ?? (await companyTimezone(device.companyId));
    const b = genericPushSchema.parse(await json(req, 500000));
    const log = await ingest(device, parseGenericPush(b, tz), "PUSH");
    return {
      received: log.received,
      inserted: log.inserted,
      duplicates: log.duplicates,
      processed: log.processed,
      unmapped: log.unmapped,
    };
  });
}

// Hikvision ISAPI event notification: the device posts JSON, or multipart
// with a JSON part, to /api/biometric/hikvision/<token>.
export async function hikvisionPush(req: NextRequest, token: string) {
  if (!token.startsWith("hrmsdev_"))
    throw new AppError(401, "Unknown or inactive device.");
  const device = await pushDevice(
    { pushTokenHash: digest(token), vendor: "HIKVISION" },
    req,
  );
  return withTenant(device.companyId, async () => {
    await requireFeature(device.companyId, "biometric");
    const tz = device.timezone ?? (await companyTimezone(device.companyId));
    const events: unknown[] = [];
    const type = req.headers.get("content-type") ?? "";
    const parse = (s: string) => {
      try {
        events.push(JSON.parse(s));
      } catch {
        // Non-JSON parts (pictures) are ignored.
      }
    };
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      for (const value of form.values())
        if (typeof value === "string") parse(value);
        else if (value.type.includes("json") && value.size < 200000)
          parse(await value.text());
    } else {
      const body = await req.text();
      if (body.length > 500000) throw new AppError(413, "Payload too large.");
      parse(body);
    }
    const punches = parseHikvisionEvents(events, tz);
    if (!punches.length) {
      await seen(device.id);
      return { received: 0 };
    }
    const log = await ingest(device, punches, "PUSH");
    return { received: log.received, processed: log.processed };
  });
}

const plain = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
// ZKTeco / eSSL ADMS ("iclock") push protocol, served at /iclock/*. The
// terminal identifies itself with its serial number, so register the serial
// exactly and prefer an IP allow-list or a private network for these devices.
export async function admsRoute(req: NextRequest, action: string) {
  const sn = req.nextUrl.searchParams.get("SN")?.trim();
  if (!sn || !/^[A-Za-z0-9_.:-]{3,64}$/.test(sn))
    return plain("Unknown device", 400);
  let device;
  try {
    device = await pushDevice(
      { serialNumber: sn, vendor: { in: ["ZKTECO", "ESSL"] } },
      req,
    );
  } catch {
    return plain("Unknown device", 401);
  }
  return withTenant(device.companyId, async () => {
    try {
      await requireFeature(device.companyId, "biometric");
    } catch {
      // The terminal keeps its logs and retries later.
      return plain("Subscription inactive", 402);
    }
    if (action === "cdata" && req.method === "GET") {
      await seen(device.id);
      return plain(
        [
          `GET OPTION FROM: ${sn}`,
          "ATTLOGStamp=None",
          "OPERLOGStamp=9999",
          "ATTPHOTOStamp=None",
          "ErrorDelay=30",
          "Delay=10",
          "TransTimes=00:00;14:05",
          "TransInterval=1",
          "TransFlag=TransData AttLog",
          "Realtime=1",
          "Encrypt=None",
          "",
        ].join("\n"),
      );
    }
    if (action === "cdata" && req.method === "POST") {
      const table = req.nextUrl.searchParams.get("table");
      const body = await req.text();
      if (body.length > 2_000_000) return plain("Payload too large", 413);
      if (table !== "ATTLOG") {
        await seen(device.id);
        return plain("OK");
      }
      const tz = device.timezone ?? (await companyTimezone(device.companyId));
      const { punches, rejected } = parseAdmsAttlog(body, tz);
      await ingest(device, punches, "PUSH", rejected);
      return plain(`OK: ${punches.length + rejected}`);
    }
    if (action === "getrequest") {
      // One queued command per poll, e.g. a manual "resend logs" request.
      const command = device.pendingCommand;
      await db.attendanceDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(), pendingCommand: null },
      });
      return plain(
        command
          ? `C:${Math.floor(Date.now() / 1000) % 100000}:${command}`
          : "OK",
      );
    }
    await seen(device.id);
    return plain("OK");
  });
}

// Scheduled job (npm run biometric:sync): pulls due devices, then retries
// failed and unmapped punches for every company with waiting punches.
async function syncDueDevicesJob() {
  const now = Date.now();
  const devices = await db.attendanceDevice.findMany({
    where: { active: true, mode: "PULL" },
  });
  let pulled = 0,
    failed = 0;
  for (const d of devices) {
    if (
      d.lastSyncAt &&
      now - d.lastSyncAt.getTime() < d.syncIntervalMinutes * 60000
    )
      continue;
    try {
      await withTenant(d.companyId, async () => {
        await requireFeature(d.companyId, "biometric");
        await syncDevice(d, "SCHEDULED");
      });
      pulled++;
    } catch {
      failed++;
    }
  }
  const waiting = await db.devicePunch.groupBy({
    by: ["companyId"],
    where: { status: { in: ["FAILED", "UNMAPPED", "PENDING"] } },
  });
  let processed = 0;
  for (const { companyId } of waiting)
    processed += (
      await withTenant(companyId, () =>
        processPending(companyId, { includeUnmapped: true }),
      )
    ).processed;
  return { pulled, failed, processed };
}
export function syncDueDevices() {
  return jobScope(() => syncDueDevicesJob());
}
