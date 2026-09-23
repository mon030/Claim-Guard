import { EnvironmentError } from "../lib/env";
import { closeMongoClient, ensureIndexes, getDb } from "../lib/mongodb";

try {
  await ensureIndexes(await getDb());
  console.log("ClaimGuard indexes are ready for all six collections.");
} catch (error) {
  console.error(error instanceof EnvironmentError ? error.message :
    "Index creation failed. Check MongoDB connectivity, permissions, and existing index definitions. No indexes were dropped.");
  process.exitCode = 1;
} finally {
  await closeMongoClient();
}
