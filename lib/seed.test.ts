import { describe, expect, it, vi } from "vitest";
import { Binary, type Db } from "mongodb";
import { seedDatabase, type prepareSeed } from "./seed";
describe("idempotent seed operations", () => {
  it("keys updates by seed identity rather than content hash and preserves creation dates", async () => {
    const writes = { claims: vi.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }), photos: vi.fn().mockResolvedValue({ upsertedCount: 2, modifiedCount: 0 }) };
    const collection = vi.fn((name: string) => ({ createIndexes: vi.fn().mockResolvedValue([]), bulkWrite: writes[name as keyof typeof writes] }));
    const db = { collection } as unknown as Db;
    const sameBytes = { sha256: "a".repeat(64), dhash: "0".repeat(16), claimId: null, contentType: "image/jpeg", byteLength: 1,
      content: new Binary(Buffer.from([1])), thumbnail: new Binary(Buffer.from([2])), thumbnailContentType: "image/jpeg" as const };
    const prepared = { claims: [{ claimId: "TEST-ONLY", claimant: "Test", customerEmail: "test@example.test", emailSubject: "", emailBody: "", date: "2026-09-22", location: "", category: "", amount: 1, narrative: "Test only" }],
      mapping: { "TEST-ONLY": null }, filenames: ["a.jpg", "b.jpg"], errors: [], warnings: [],
      photos: [{ ...sameBytes, filename: "a.jpg" }, { ...sameBytes, filename: "b.jpg" }] } satisfies Awaited<ReturnType<typeof prepareSeed>>;
    await seedDatabase(db, prepared, new Date("2026-09-22T00:00:00Z"));
    await seedDatabase(db, prepared, new Date("2026-09-23T00:00:00Z"));
    const firstPhotoOperations = writes.photos.mock.calls[0][0];
    expect(firstPhotoOperations.map((op: { updateOne: { filter: unknown } }) => op.updateOne.filter)).toEqual([{ filename: "a.jpg", origin: "seed" }, { filename: "b.jpg", origin: "seed" }]);
    expect(writes.photos.mock.calls[1][0].map((op: { updateOne: { filter: unknown } }) => op.updateOne.filter)).toEqual(firstPhotoOperations.map((op: { updateOne: { filter: unknown } }) => op.updateOne.filter));
    expect(firstPhotoOperations[0].updateOne.upsert).toBe(true);
    expect(firstPhotoOperations[0].updateOne.update.$set).not.toHaveProperty("createdAt");
    expect(writes.claims.mock.calls[0][0][0].updateOne.update.$set.mappedPhotos).toBeNull();
  });
});
