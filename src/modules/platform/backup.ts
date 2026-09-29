import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform, type Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { db, jobScope } from "@/lib/db";

const magic = Buffer.from("HRMSBK1\n");
export type BackupKind = "DAILY" | "WEEKLY" | "MANUAL";

export function backupConfig() {
  const key = process.env.BACKUP_ENCRYPTION_KEY || "";
  return {
    dir: path.resolve(
      /*turbopackIgnore: true*/ process.env.BACKUP_DIR || "data/backups",
    ),
    key: /^[a-f0-9]{64}$/i.test(key) ? Buffer.from(key, "hex") : null,
    pgBin:
      process.env.PG_BIN_DIR ||
      (process.platform === "win32"
        ? "C:\\Program Files\\PostgreSQL\\18\\bin"
        : ""),
    dailyAt: process.env.BACKUP_DAILY_AT || "02:00",
    weeklyDay: Number(process.env.BACKUP_WEEKLY_DAY ?? 0),
    dailyRetentionDays: Number(process.env.BACKUP_DAILY_RETENTION_DAYS || 7),
    weeklyRetentionDays: Number(process.env.BACKUP_WEEKLY_RETENTION_DAYS || 35),
  };
}
// Next scheduled run of each kind in the server's local time.
export function nextBackups(now = new Date()) {
  const c = backupConfig();
  const [h, m] = c.dailyAt.split(":").map(Number);
  const daily = new Date(now);
  daily.setHours(h, m, 0, 0);
  if (daily <= now) daily.setDate(daily.getDate() + 1);
  const weekly = new Date(daily);
  weekly.setHours(h + 1, m, 0, 0);
  while (weekly.getDay() !== c.weeklyDay || weekly <= now)
    weekly.setDate(weekly.getDate() + 1);
  return { daily, weekly };
}
const tool = (name: string) => {
  const dir = backupConfig().pgBin;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : exe;
};
// Connection details come from DATABASE_URL. The password is passed through
// the environment so it never appears in process listings.
function connection(database?: string) {
  const url = new URL(process.env.DATABASE_URL || "");
  return {
    args: [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      decodeURIComponent(url.username),
    ],
    database: database ?? url.pathname.slice(1),
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  };
}
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: Readable,
) {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString().slice(0, 4000)));
  const done = new Promise<void>((resolve, reject) => {
    // pg_restore --list can finish after reading the archive index, before
    // stdin has consumed the full dump. Its exit status still determines success.
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (
        args.includes("--list") &&
        (error.code === "EPIPE" || error.code === "EOF")
      ) {
        input?.unpipe(child.stdin);
        input?.resume();
      } else reject(error);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`${path.basename(command)} failed: ${stderr.trim()}`),
          ),
    );
  });
  if (input) input.pipe(child.stdin);
  else child.stdin.end();
  return { stdout: child.stdout, done };
}

export function encryptor(key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      const out = cipher.update(chunk);
      if (!started) {
        started = true;
        return cb(null, Buffer.concat([magic, iv, out]));
      }
      cb(null, out);
    },
    flush(cb) {
      const final = cipher.final();
      cb(
        null,
        Buffer.concat([
          ...(started ? [] : [magic, iv]),
          final,
          cipher.getAuthTag(),
        ]),
      );
    },
  });
}
// Streams the plaintext of an encrypted backup; the stream errors if the
// file was altered, because the GCM tag no longer matches.
export async function decryptFile(file: string, key: Buffer) {
  const { size } = await stat(file);
  const header = magic.length + 12;
  if (size < header + 16) throw new Error("Backup file is truncated.");
  const handle = await open(file, "r");
  const head = Buffer.alloc(header),
    tag = Buffer.alloc(16);
  await handle.read(head, 0, header, 0);
  await handle.read(tag, 0, 16, size - 16);
  await handle.close();
  if (!head.subarray(0, magic.length).equals(magic))
    throw new Error("Not an HRMS backup file.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    head.subarray(magic.length),
  );
  decipher.setAuthTag(tag);
  const out = new PassThrough();
  pipeline(
    createReadStream(file, { start: header, end: size - 17 }),
    decipher,
    out,
  ).catch((error) => out.destroy(error));
  return out;
}
async function sha256(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}
async function verify(file: string, key: Buffer) {
  const plain = await decryptFile(file, key);
  const drained = finished(plain);
  const listing = run(tool("pg_restore"), ["--list"], process.env, plain);
  let entries = 0;
  listing.stdout.on("data", (d) => {
    entries += d
      .toString()
      .split("\n")
      .filter((l: string) => /^\d+;/.test(l)).length;
  });
  await Promise.all([listing.done, drained]);
  if (!entries) throw new Error("Backup contains no restorable entries.");
  return entries;
}
async function restoreTest(file: string, key: Buffer) {
  const name = `hrms_restore_check_${randomBytes(4).toString("hex")}`;
  // The migration owner creates and drops the check database; the runtime
  // roles cannot create databases.
  const owner = connection();
  const finish = (r: ReturnType<typeof run>) => {
    r.stdout.resume();
    return r.done;
  };
  await finish(run(tool("createdb"), [...owner.args, name], owner.env));
  try {
    const c = connection(name);
    const restore = run(
      tool("pg_restore"),
      [
        ...c.args,
        "--dbname",
        name,
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
      ],
      c.env,
      await decryptFile(file, key),
    );
    restore.stdout.resume();
    await restore.done;
    const check = run(
      tool("psql"),
      [
        ...c.args,
        "--dbname",
        name,
        "-tAc",
        "select count(*) from information_schema.tables where table_schema='public'",
      ],
      c.env,
    );
    let out = "";
    check.stdout.on("data", (d) => (out += d));
    await check.done;
    const tables = Number(out.trim());
    if (!tables) throw new Error("Restored database has no tables.");
    return tables;
  } finally {
    await finish(
      run(tool("dropdb"), [...owner.args, "--if-exists", name], owner.env),
    );
  }
}
async function prune(now: Date) {
  const expired = await db.backupLog.findMany({
    where: {
      retentionUntil: { lt: now },
      deletedAt: null,
      location: { not: null },
    },
  });
  for (const b of expired) {
    await rm(b.location!, { force: true });
    await db.backupLog.update({
      where: { id: b.id },
      data: { deletedAt: now },
    });
  }
  // Remove partial files left by interrupted runs. Only stale files are
  // touched, so a backup still running in parallel keeps its file.
  const c = backupConfig();
  const known = new Set(
    (
      await db.backupLog.findMany({
        where: { deletedAt: null, location: { not: null } },
        select: { location: true },
      })
    ).map((b) => b.location),
  );
  for (const f of await readdir(/*turbopackIgnore: true*/ c.dir).catch(
    () => [],
  )) {
    const file = path.join(/*turbopackIgnore: true*/ c.dir, f);
    if (
      f.endsWith(".hrmsbak") &&
      !known.has(file) &&
      now.getTime() - (await stat(file)).mtimeMs > 86400000
    )
      await rm(file, { force: true });
  }
  return expired.length;
}

async function runBackupJob(
  kind: BackupKind,
  options = { restoreTest: false },
) {
  const c = backupConfig();
  const log = await db.backupLog.create({ data: { kind } });
  try {
    if (!c.key)
      throw new Error("BACKUP_ENCRYPTION_KEY must be 32 random bytes in hex.");
    await mkdir(c.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(
      c.dir,
      `hrms-${kind.toLowerCase()}-${stamp}.hrmsbak`,
    );
    const conn = connection();
    const dump = run(
      tool("pg_dump"),
      [...conn.args, "--format=custom", "--no-owner", conn.database],
      conn.env,
    );
    await Promise.all([
      pipeline(
        dump.stdout,
        encryptor(c.key),
        createWriteStream(file, { mode: 0o600 }),
      ),
      dump.done,
    ]);
    const [{ size }, checksum] = await Promise.all([stat(file), sha256(file)]);
    await verify(file, c.key);
    const tested = options.restoreTest ? await restoreTest(file, c.key) : null;
    const now = new Date();
    const retentionDays =
      kind === "WEEKLY" ? c.weeklyRetentionDays : c.dailyRetentionDays;
    const saved = await db.backupLog.update({
      where: { id: log.id },
      data: {
        status: "SUCCESS",
        finishedAt: now,
        sizeBytes: BigInt(size),
        location: file,
        checksum,
        verificationStatus: "VERIFIED",
        verifiedAt: now,
        restoreTestedAt: tested ? now : null,
        retentionUntil: new Date(now.getTime() + retentionDays * 86400000),
      },
    });
    const pruned = await prune(now);
    return { ...saved, restoredTables: tested, pruned };
  } catch (error) {
    await db.backupLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message.slice(0, 2000) : "Failed",
      },
    });
    throw error;
  }
}
// Restores an encrypted backup into an existing, empty database.
async function restoreBackupJob(file: string, database: string) {
  const c = backupConfig();
  if (!c.key) throw new Error("BACKUP_ENCRYPTION_KEY is not configured.");
  const conn = connection(database);
  const restore = run(
    tool("pg_restore"),
    [
      ...conn.args,
      "--dbname",
      database,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
    ],
    conn.env,
    await decryptFile(file, c.key),
  );
  restore.stdout.resume();
  await restore.done;
}
export function runBackup(kind: BackupKind, options = { restoreTest: false }) {
  return jobScope(() => runBackupJob(kind, options));
}
export function restoreBackup(file: string, database: string) {
  return jobScope(() => restoreBackupJob(file, database));
}
