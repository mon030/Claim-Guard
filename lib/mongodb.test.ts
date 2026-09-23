import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { closeMongoClient, COLLECTION_INDEXES, ensureIndexes, getMongoClient } from "./mongodb";
import { retentionFor, USER_DATA_RETENTION_MS } from "./models";

beforeEach(() => {
  vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017");
  vi.spyOn(MongoClient.prototype, "close").mockResolvedValue(undefined);
});
afterEach(async () => { await closeMongoClient(); });

describe("MongoDB connection lifecycle (mocked)", () => {
  it("shares one connect promise across concurrent callers", async () => {
    const connect = vi.spyOn(MongoClient.prototype, "connect").mockImplementation(async function (this: MongoClient) { return this; });
    const [a, b] = await Promise.all([getMongoClient(), getMongoClient()]);
    expect(a).toBe(b);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(a.options).toMatchObject({ maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 3000 });
  });
  it("clears a rejected connection so a later request can recover", async () => {
    const connect = vi.spyOn(MongoClient.prototype, "connect")
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async function (this: MongoClient) { return this; });
    await expect(getMongoClient()).rejects.toThrow("offline");
    await expect(getMongoClient()).resolves.toBeInstanceOf(MongoClient);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe("indexes and retention", () => {
  it("does not enforce unique photo hashes; uniqueness is limited to seed filenames", () => {
    const hashes = COLLECTION_INDEXES.photos.find((index) => index.name === "sha256_lookup");
    expect(hashes?.unique).not.toBe(true);
    expect(COLLECTION_INDEXES.photos.find((index) => index.name === "seed_filename_unique")).toMatchObject({ key: { filename: 1 }, unique: true, partialFilterExpression: { origin: "seed" } });
    expect(COLLECTION_INDEXES.claims[0]).toMatchObject({ key: { claimId: 1 }, unique: true });
    expect(COLLECTION_INDEXES.vision_cache[0]).toMatchObject({ key: { sha256: 1 }, unique: true });
  });
  it("expires user records at an absolute date while retaining seed records", () => {
    for (const indexes of [COLLECTION_INDEXES.claims, COLLECTION_INDEXES.photos, COLLECTION_INDEXES.decisions, COLLECTION_INDEXES.audit_log]) {
      expect(indexes.find((index) => index.name === "user_expiresAt_ttl")).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0, partialFilterExpression: { origin: "user" } });
    }
    expect(COLLECTION_INDEXES.usage[0]).toMatchObject({ key: { date: 1, type: 1 }, unique: true });
    expect(COLLECTION_INDEXES.vision_cache[1].partialFilterExpression).toBeUndefined();
    expect(COLLECTION_INDEXES.usage[1].partialFilterExpression).toBeUndefined();
    const now = new Date("2026-09-21T12:00:00.000Z");
    const user = retentionFor("user", now);
    expect(user.expiresAt.getTime() - user.createdAt.getTime()).toBe(USER_DATA_RETENTION_MS);
    expect(user.expiresAt.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(retentionFor("seed", now)).not.toHaveProperty("expiresAt");
    expect(() => retentionFor("user", new Date("invalid"))).toThrow();
  });
  it("creates the six collections' indexes once per Db instance", async () => {
    const createIndexes = vi.fn().mockResolvedValue([]);
    const collection = vi.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;
    await Promise.all([ensureIndexes(db), ensureIndexes(db)]);
    expect(collection).toHaveBeenCalledTimes(6);
    expect(createIndexes).toHaveBeenCalledTimes(6);
    for (const name of Object.keys(COLLECTION_INDEXES)) expect(collection).toHaveBeenCalledWith(name);
  });
  it("allows an index setup retry after a failure", async () => {
    const createIndexes = vi.fn().mockRejectedValueOnce(new Error("permission denied")).mockResolvedValue([]);
    const db = { collection: () => ({ createIndexes }) } as unknown as Db;
    await expect(ensureIndexes(db)).rejects.toThrow("permission denied");
    await expect(ensureIndexes(db)).resolves.toBeUndefined();
    expect(createIndexes).toHaveBeenCalledTimes(12);
  });
});
