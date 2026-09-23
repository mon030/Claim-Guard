import { runCli } from "../lib/cli";
import { DatasetError } from "../lib/dataset";
import { getDb } from "../lib/mongodb";
import { resetUserData } from "../lib/reset-user-data";
import { isDryRun } from "../lib/cli-options";
await runCli(async () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) throw new DatasetError("Usage: npm run reset-user-data -- [--dry-run]");
  const dryRun = isDryRun(args);
  const counts = await resetUserData(await getDb(), dryRun);
  for (const [name, count] of Object.entries(counts)) console.log(`${name}: ${count} ${dryRun ? "would be deleted" : "deleted"}`);
  console.log("vision_cache and usage were left untouched");
});
