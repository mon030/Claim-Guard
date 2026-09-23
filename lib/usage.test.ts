import { describe, expect, it, vi } from "vitest";
import type { Collection } from "mongodb";
import { reserveUsage } from "./usage";
import type { UsageRecord } from "./models";
describe("global daily quotas", () => {
  it("uses an atomic conditional increment and a UTC date/type key without origin", async () => {
    let count = 0;
    const updateOne = vi.fn().mockResolvedValue({});
    const findOneAndUpdate = vi.fn().mockImplementation(async (filter) => count < filter.count.$lt ? { count: ++count } : null);
    const collection = { updateOne, findOneAndUpdate } as unknown as Collection<UsageRecord>;
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveUsage(collection, "vision", 3, new Date("2026-09-22T00:00:00Z"))));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(updateOne.mock.calls[0][0]).toEqual({ date: "2026-09-22", type: "vision" });
    expect(updateOne.mock.calls[0][1].$setOnInsert).not.toHaveProperty("origin");
    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { count: 1 } });
  });
  it("treats zero as disabled without touching the database", async () => {
    const updateOne = vi.fn();
    expect(await reserveUsage({ updateOne } as unknown as Collection<UsageRecord>, "vision", 0)).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
  it("recovers from competing first upserts but fails closed on other database errors", async () => {
    const updateOne = vi.fn().mockRejectedValueOnce({ code: 11000 }).mockRejectedValueOnce(new Error("offline"));
    const findOneAndUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const collection = { updateOne, findOneAndUpdate } as unknown as Collection<UsageRecord>;
    expect(await reserveUsage(collection, "vision", 2)).toBe(true);
    await expect(reserveUsage(collection, "vision", 2)).rejects.toThrow("offline");
  });
});
