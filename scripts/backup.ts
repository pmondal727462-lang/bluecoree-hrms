import "dotenv/config";
import { runBackup, type BackupKind } from "../src/modules/platform/backup";
import { db } from "../src/lib/db";
// Usage: npm run backup -- daily|weekly|manual [--restore-test]
const kind = (process.argv[2] || "manual").toUpperCase() as BackupKind;
if (!["DAILY", "WEEKLY", "MANUAL"].includes(kind)) {
  console.error("Use daily, weekly or manual.");
  process.exit(1);
}
runBackup(kind, { restoreTest: process.argv.includes("--restore-test") })
  .then((b) =>
    console.log(
      `Backup ${b.id} verified: ${b.location} (${b.sizeBytes} bytes, sha256 ${b.checksum})` +
        (b.restoredTables
          ? `; restore test loaded ${b.restoredTables} tables`
          : "") +
        (b.pruned ? `; removed ${b.pruned} expired backups` : ""),
    ),
  )
  .catch((error) => {
    console.error(
      `Backup failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
