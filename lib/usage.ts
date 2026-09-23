import type { Collection } from "mongodb";
import { getOptionalEnv } from "./env";
import { getCollections } from "./mongodb";
import { USER_DATA_RETENTION_MS, type UsageRecord } from "./models";

/** Atomically reserves a paid HTTP attempt. Failed attempts still consume a slot. */
export async function reserveUsage(collection: Collection<UsageRecord>, type: UsageRecord["type"], limit: number, now = new Date()): Promise<boolean> {
  if (limit <= 0) return false;
  const date = now.toISOString().slice(0, 10);
  const filter = { date, type };
  try {
    await collection.updateOne(filter, { $setOnInsert: {
      ...filter, count: 0, createdAt: now, expiresAt: new Date(now.getTime() + USER_DATA_RETENTION_MS),
    } }, { upsert: true, timeoutMS: 1_000 });
  } catch (error) {
    // Another process can win the first upsert. The unique date/type index
    // makes the loser safe to proceed to the conditional atomic increment.
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
  const reservation = await collection.findOneAndUpdate({ ...filter, count: { $lt: limit } },
    { $inc: { count: 1 } }, { returnDocument: "after", includeResultMetadata: false, timeoutMS: 1_000 });
  return reservation !== null;
}
export async function reserveDailyUsage(type: UsageRecord["type"]): Promise<boolean> {
  const options = getOptionalEnv();
  const { usage } = await getCollections();
  return reserveUsage(usage, type, type === "vision" ? options.DAILY_VISION_LIMIT : options.DAILY_LLM_LIMIT);
}
