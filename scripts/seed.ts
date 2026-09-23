import { prepareSeed, seedDatabase } from "../lib/seed";
import { getDb } from "../lib/mongodb";
import { runCli } from "../lib/cli";
import { DatasetError } from "../lib/dataset";
import { isDryRun } from "../lib/cli-options";
await runCli(async () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) throw new DatasetError("Usage: npm run seed -- [--dry-run]");
  const prepared = await prepareSeed();
  for (const warning of prepared.warnings) console.warn(`Warning: ${warning} Seeding mappedPhotos: null.`);
  if (isDryRun(args)) {
    console.log(`Dry run verified ${prepared.claims.length} claims and ${prepared.photos.length} JPEGs, hashes, and thumbnails. No database connection or writes.`);
    return;
  }
  const result = await seedDatabase(await getDb(), prepared);
  console.log(JSON.stringify(result, null, 2));
  console.log("Seed complete. Seed records and thumbnails are ready; unmapped photos remain unassigned.");
});
