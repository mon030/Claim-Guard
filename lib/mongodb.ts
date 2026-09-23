import { MongoClient, type Db, type IndexDescription } from "mongodb";
import { getMongoEnv } from "./env";
import type { CollectionModels } from "./models";

const userTtlIndex: IndexDescription = {
  key: { expiresAt: 1 }, name: "user_expiresAt_ttl", expireAfterSeconds: 0,
  partialFilterExpression: { origin: "user" },
};

export const COLLECTION_INDEXES: Record<keyof CollectionModels, IndexDescription[]> = {
  claims: [
    { key: { claimId: 1 }, name: "claimId_unique", unique: true },
    { key: { clientRequestId: 1 }, name: "user_request_unique", unique: true,
      partialFilterExpression: { origin: "user", clientRequestId: { $exists: true } } },
    userTtlIndex,
  ],
  photos: [
    { key: { sha256: 1 }, name: "sha256_lookup" },
    { key: { filename: 1 }, name: "seed_filename_unique", unique: true, partialFilterExpression: { origin: "seed" } },
    { key: { claimId: 1 }, name: "claimId_lookup" },
    { key: { claimId: 1, slot: 1 }, name: "user_claim_slot_unique", unique: true,
      partialFilterExpression: { origin: "user", slot: { $exists: true } } },
    userTtlIndex,
  ],
  vision_cache: [
    { key: { sha256: 1 }, name: "sha256_unique", unique: true },
    { key: { expiresAt: 1 }, name: "cache_expiresAt_ttl", expireAfterSeconds: 0 },
  ],
  decisions: [{ key: { claimId: 1, createdAt: -1 }, name: "claim_history" }, userTtlIndex],
  audit_log: [{ key: { claimId: 1, createdAt: -1 }, name: "claim_history" }, userTtlIndex],
  usage: [
    { key: { date: 1, type: 1 }, name: "date_type_unique", unique: true },
    { key: { expiresAt: 1 }, name: "usage_expiresAt_ttl", expireAfterSeconds: 0 },
  ],
};

interface MongoState { client: MongoClient; connection: Promise<MongoClient>; }
const globalCache = globalThis as typeof globalThis & { __claimGuardMongo?: MongoState };
const indexPromises = new WeakMap<Db, Promise<void>>();

/** Shared across warm requests and development reloads; never closes per request. */
export async function getMongoClient(): Promise<MongoClient> {
  if (!globalCache.__claimGuardMongo) {
    const { MONGODB_URI } = getMongoEnv();
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 3_000,
      connectTimeoutMS: 3_000,
      timeoutMS: 5_000,
    });
    const state: MongoState = { client, connection: client.connect() };
    globalCache.__claimGuardMongo = state;
    state.connection = state.connection.catch(async (error: unknown) => {
      if (globalCache.__claimGuardMongo === state) delete globalCache.__claimGuardMongo;
      await client.close().catch(() => undefined);
      throw error;
    });
  }
  return globalCache.__claimGuardMongo.connection;
}

/** Idempotent creation; deliberately never drops or rewrites existing indexes. */
export async function ensureIndexes(db: Db): Promise<void> {
  let pending = indexPromises.get(db);
  if (!pending) {
    pending = Promise.all(Object.entries(COLLECTION_INDEXES).map(([collection, indexes]) =>
      db.collection(collection).createIndexes(indexes),
    )).then(() => undefined).catch((error: unknown) => {
      indexPromises.delete(db);
      throw error;
    });
    indexPromises.set(db, pending);
  }
  return pending;
}

const databaseCache = new WeakMap<MongoClient, Map<string, Db>>();
/** Call db:indexes during setup. Normal requests do not spend their budget on DDL. */
export async function getDb(): Promise<Db> {
  const { MONGODB_DB } = getMongoEnv();
  const client = await getMongoClient();
  let databases = databaseCache.get(client);
  if (!databases) { databases = new Map(); databaseCache.set(client, databases); }
  let database = databases.get(MONGODB_DB);
  if (!database) { database = client.db(MONGODB_DB); databases.set(MONGODB_DB, database); }
  return database;
}

export async function getCollections() {
  const db = await getDb();
  return {
    claims: db.collection<CollectionModels["claims"]>("claims"),
    photos: db.collection<CollectionModels["photos"]>("photos"),
    vision_cache: db.collection<CollectionModels["vision_cache"]>("vision_cache"),
    decisions: db.collection<CollectionModels["decisions"]>("decisions"),
    audit_log: db.collection<CollectionModels["audit_log"]>("audit_log"),
    usage: db.collection<CollectionModels["usage"]>("usage"),
  };
}

/** For one-off scripts and test teardown only. */
export async function closeMongoClient(): Promise<void> {
  const state = globalCache.__claimGuardMongo;
  delete globalCache.__claimGuardMongo;
  if (state) {
    await state.connection.catch(() => undefined);
    await state.client.close();
  }
}
