import "dotenv/config";
import { systemDb } from "../src/lib/db";
import { runTask, tasks } from "../src/jobs/tasks";

// Runs one scheduled task now: npm run job -- <name>
const name = process.argv[2];
if (!name || !tasks[name]) {
  console.error(`Usage: npm run job -- <${Object.keys(tasks).join("|")}>`);
  process.exit(1);
}
runTask(name)
  .then((r) => console.log(JSON.stringify(r)))
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => systemDb.$disconnect());
