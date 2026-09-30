import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { cronMatches } from "../src/jobs/cron";
import { runTask, tasks } from "../src/jobs/tasks";
import { logger } from "../src/lib/errors";

// Background worker (spec §66). With REDIS_URL, jobs are BullMQ repeatable
// jobs: one schedule across any number of workers, with retries. Without it,
// an in-process scheduler runs each task when its cron pattern matches
// (use a single worker process in that mode).
const queueName = "hrms-jobs";

async function withRedis(url: string) {
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection });
  await queue.removeJobScheduler("biometric-sync");
  for (const [name, t] of Object.entries(tasks))
    await queue.upsertJobScheduler(
      name,
      { pattern: t.pattern, tz: "UTC" },
      {
        name,
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 30000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      },
    );
  const worker = new Worker(queueName, (job) => runTask(job.name), {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  });
  worker.on("failed", (job, error) =>
    logger.error({ job: job?.name, error: String(error) }, "Queued job failed"),
  );
  logger.info(
    { tasks: Object.keys(tasks).length },
    "Worker started with Redis",
  );
  const stop = async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

function inProcess() {
  const running = new Set<string>();
  const tick = () => {
    const now = new Date();
    for (const [name, t] of Object.entries(tasks)) {
      if (!cronMatches(t.pattern, now) || running.has(name)) continue;
      running.add(name);
      runTask(name)
        .catch(() => undefined)
        .finally(() => running.delete(name));
    }
  };
  // Align to the start of each minute.
  setTimeout(
    () => {
      tick();
      setInterval(tick, 60000);
    },
    60000 - (Date.now() % 60000),
  );
  logger.info(
    { tasks: Object.keys(tasks).length },
    "Worker started without Redis (in-process schedule)",
  );
}

if (process.env.REDIS_URL) void withRedis(process.env.REDIS_URL);
else inProcess();
