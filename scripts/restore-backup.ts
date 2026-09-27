import "dotenv/config";
import { restoreBackup } from "../src/modules/platform/backup";
import { db } from "../src/lib/db";
// Usage: npm run backup:restore -- <file.hrmsbak> <empty-target-database>
const [file, database] = process.argv.slice(2);
if (!file || !database || !/^[A-Za-z0-9_]+$/.test(database)) {
  console.error(
    "Provide a backup file and an existing, empty target database name.",
  );
  process.exit(1);
}
restoreBackup(file, database)
  .then(() => console.log(`Restored ${file} into ${database}.`))
  .catch((error) => {
    console.error(
      `Restore failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
