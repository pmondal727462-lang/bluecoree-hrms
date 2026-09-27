import "dotenv/config";
import { systemDb } from "../src/lib/db";
import { syncDueDevices } from "../src/modules/biometric/service";
// Pulls due BioStar 2 devices and retries failed or unmapped punches.
// Run every 5 minutes (Task Scheduler or cron).
syncDueDevices()
  .then((r) =>
    console.log(
      `Biometric sync: ${r.pulled} devices pulled, ${r.failed} failed, ${r.processed} punches applied.`,
    ),
  )
  .catch(() => {
    console.error("Biometric sync job failed.");
    process.exitCode = 1;
  })
  .finally(() => systemDb.$disconnect());
