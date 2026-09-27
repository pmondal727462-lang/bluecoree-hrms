import { connect } from "node:net";
import { access, constants, mkdir } from "node:fs/promises";
import nodemailer from "nodemailer";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emailConfigured } from "@/integrations/email";
import { backupConfig } from "./backup";

type Status = "UP" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED";
type Check = {
  component: string;
  status: Status;
  latencyMs?: number;
  details?: Record<string, unknown>;
};
const hour = 3600000;
async function timed(
  component: string,
  run: () => Promise<Omit<Check, "component" | "latencyMs">>,
): Promise<Check> {
  const started = Date.now();
  try {
    const r = await run();
    return { component, latencyMs: Date.now() - started, ...r };
  } catch (error) {
    return {
      component,
      status: "DOWN",
      latencyMs: Date.now() - started,
      details: {
        error: error instanceof Error ? error.message.slice(0, 300) : "Failed",
      },
    };
  }
}
function redisPing(url: string) {
  const u = new URL(url);
  return new Promise<void>((resolve, reject) => {
    const socket = connect(Number(u.port || 6379), u.hostname);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out"));
    }, 3000);
    socket.on("connect", () => {
      if (u.password)
        socket.write(`AUTH ${decodeURIComponent(u.password)}\r\n`);
      socket.write("PING\r\n");
    });
    socket.on("data", (d) => {
      if (d.toString().includes("+PONG")) {
        clearTimeout(timer);
        socket.end();
        resolve();
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// Records 500 responses so the health dashboard can show server errors.
export async function recordServerError(path: string) {
  await db.systemHealthLog
    .create({
      data: {
        component: "server_error",
        status: "DOWN",
        details: { path: path.slice(0, 200) },
      },
    })
    .catch(() => undefined);
}

export async function runHealthChecks() {
  const now = Date.now();
  const since = new Date(now - 24 * hour);
  const checks = await Promise.all([
    timed("api", async () => ({
      status: "UP",
      details: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        node: process.version,
      },
    })),
    timed("database", async () => {
      await db.$queryRaw`SELECT 1`;
      return { status: "UP" };
    }),
    timed("redis", async () => {
      if (!process.env.REDIS_URL)
        return {
          status: "NOT_CONFIGURED",
          details: {
            note: "The application does not require Redis; rate limits and queues use PostgreSQL.",
          },
        };
      await redisPing(process.env.REDIS_URL);
      return { status: "UP" };
    }),
    timed("queue", async () => {
      const [pending, oldest, failed] = await Promise.all([
        db.webhookDelivery.count({
          where: { status: { in: ["PENDING", "SENDING"] } },
        }),
        db.webhookDelivery.findFirst({
          where: { status: "PENDING", nextAttemptAt: { lte: new Date(now) } },
          orderBy: { nextAttemptAt: "asc" },
          select: { nextAttemptAt: true },
        }),
        db.webhookDelivery.count({
          where: { status: "FAILED", createdAt: { gte: since } },
        }),
      ]);
      const stuckMinutes = oldest
        ? Math.round((now - oldest.nextAttemptAt.getTime()) / 60000)
        : 0;
      return {
        status: stuckMinutes > 15 || failed ? "DEGRADED" : "UP",
        details: {
          pending,
          overdueMinutes: stuckMinutes,
          failedLast24h: failed,
        },
      };
    }),
    timed("storage", async () => {
      const dir = backupConfig().dir;
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      return { status: "UP", details: { backupDir: dir } };
    }),
    timed("backups", async () => {
      const last = await db.backupLog.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
      });
      const failed = await db.backupLog.count({
        where: {
          status: "FAILED",
          startedAt: { gte: new Date(now - 7 * 24 * hour) },
        },
      });
      if (!backupConfig().key)
        return {
          status: "NOT_CONFIGURED",
          details: { note: "BACKUP_ENCRYPTION_KEY is not set." },
        };
      const ageHours = last
        ? Math.round((now - last.startedAt.getTime()) / hour)
        : null;
      return {
        status:
          ageHours === null
            ? "DOWN"
            : ageHours > 26 || failed
              ? "DEGRADED"
              : "UP",
        details: {
          lastSuccess: last?.startedAt ?? null,
          ageHours,
          failedLast7d: failed,
        },
      };
    }),
    timed("email", async () => {
      if (!emailConfigured()) return { status: "NOT_CONFIGURED" };
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 5000,
      });
      await transport.verify();
      return { status: "UP" };
    }),
    timed("notifications", async () => ({
      status: "NOT_CONFIGURED",
      details: {
        note: "Push tokens are registered, but no push provider (FCM/APNs) sender is configured.",
      },
    })),
    timed("biometric", async () => {
      const [face, failing] = await Promise.all([
        Promise.resolve(
          !!process.env.FACE_PROVIDER_URL && !!process.env.FACE_PROVIDER_KEY,
        ),
        db.integration.count({
          where: { category: "BIOMETRIC", active: true, lastStatus: "FAILED" },
        }),
      ]);
      return {
        status: !face ? "NOT_CONFIGURED" : failing ? "DEGRADED" : "UP",
        details: {
          faceProviderConfigured: face,
          failingBiometricIntegrations: failing,
        },
      };
    }),
    timed("integrations", async () => {
      const [failedCalls, failing] = await Promise.all([
        db.integrationLog.count({
          where: { status: "FAILED", createdAt: { gte: since } },
        }),
        db.integration.count({ where: { active: true, lastStatus: "FAILED" } }),
      ]);
      return {
        status: failing ? "DEGRADED" : "UP",
        details: {
          failingIntegrations: failing,
          failedCallsLast24h: failedCalls,
        },
      };
    }),
    timed("server_errors", async () => {
      const [errors, apiErrors] = await Promise.all([
        db.systemHealthLog.count({
          where: { component: "server_error", checkedAt: { gte: since } },
        }),
        db.apiLog.count({
          where: { status: { gte: 500 }, createdAt: { gte: since } },
        }),
      ]);
      return {
        status: errors + apiErrors > 0 ? "DEGRADED" : "UP",
        details: { last24h: errors, publicApiLast24h: apiErrors },
      };
    }),
  ]);
  await db.systemHealthLog.createMany({
    data: checks.map((c) => ({
      component: c.component,
      status: c.status,
      latencyMs: c.latencyMs ?? null,
      details: (c.details ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
  await db.systemHealthLog.deleteMany({
    where: { checkedAt: { lt: new Date(now - 30 * 24 * hour) } },
  });
  return checks;
}
export async function healthHistory() {
  return db.systemHealthLog.findMany({
    where: {
      checkedAt: { gte: new Date(Date.now() - 24 * hour) },
      component: { not: "server_error" },
    },
    orderBy: { checkedAt: "desc" },
    take: 500,
  });
}
