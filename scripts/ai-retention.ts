import "dotenv/config";
import { purgeExpiredAI } from "../src/modules/ai/service";
import { db } from "../src/lib/db";
purgeExpiredAI().then(() => console.log("Expired AI records removed.")).catch(() => { console.error("AI retention job failed."); process.exitCode = 1; }).finally(() => db.$disconnect());
