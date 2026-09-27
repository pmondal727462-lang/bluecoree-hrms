import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import {
  decryptFile,
  encryptor,
  nextBackups,
} from "../../src/modules/platform/backup";

async function encrypt(data: Buffer, key: Buffer) {
  const file = path.join(
    await mkdtemp(path.join(tmpdir(), "hrmsbak-")),
    "b.hrmsbak",
  );
  await writeFile(
    file,
    await buffer(Readable.from([data]).pipe(encryptor(key))),
  );
  return file;
}
describe("Encrypted backups", () => {
  const key = randomBytes(32);
  it("round-trips data and hides plaintext", async () => {
    const data = Buffer.from("PGDMP sample payload ".repeat(1000));
    const file = await encrypt(data, key);
    expect((await readFile(file)).includes("sample payload")).toBe(false);
    expect(await buffer(await decryptFile(file, key))).toEqual(data);
  });
  it("rejects tampered files and wrong keys", async () => {
    const file = await encrypt(Buffer.from("PGDMP important"), key);
    await expect(
      buffer(await decryptFile(file, randomBytes(32))),
    ).rejects.toThrow();
    const bytes = await readFile(file);
    bytes[30] ^= 1;
    await writeFile(file, bytes);
    await expect(buffer(await decryptFile(file, key))).rejects.toThrow();
  });
  it("schedules the next daily and weekly runs in the future", () => {
    const now = new Date(2026, 8, 26, 12, 0);
    const next = nextBackups(now);
    expect(next.daily > now && next.weekly > now).toBe(true);
    expect(next.daily.getHours()).toBe(2);
    expect(next.weekly.getDay()).toBe(0);
  });
});
