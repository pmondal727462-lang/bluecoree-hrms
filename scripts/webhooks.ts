import "dotenv/config";
import { deliverDue } from "../src/modules/integrations/outbound";
import { db } from "../src/lib/db";
// Sends due webhook deliveries, including scheduled retries. Run every minute.
deliverDue(undefined, 500)
  .then((r) => console.log(`Webhooks attempted ${r.attempted}, delivered ${r.delivered}.`))
  .catch(() => {
    console.error("Webhook delivery job failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
