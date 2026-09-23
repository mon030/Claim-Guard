import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { lookupPhoto, findReferenceMatches, type LookupServices } from "./lookup";
import { extractVisionResult, VisionError } from "./vision";
import { guardrailConfig } from "./guardrail.config";
import type { VisionCacheRecord } from "./models";
const empty = () => extractVisionResult({ responses: [{ webDetection: {} }] });
const now = new Date("2026-09-22T00:00:00Z");
function services() {
  const records = new Map<string, VisionCacheRecord>();
  const impl = {
    now: () => now,
    readCache: vi.fn(async (hash: string) => records.get(hash) ?? null),
    saveCache: vi.fn(async (record: VisionCacheRecord) => { records.set(record.sha256, record); }),
    detect: vi.fn(async () => empty()), references: vi.fn(async () => []),
  } satisfies LookupServices;
  return { records, impl };
}
const image = () => sharp({ create: { width: 12, height: 12, channels: 3, background: "white" } }).jpeg().toBuffer();
describe("shared cached lookup", () => {
  it("uses one Vision call for byte-identical files, independent of their filenames", async () => {
    const { impl, records } = services(), buffer = await image();
    const first = await lookupPhoto(buffer, { filename: "first.jpg" }, impl);
    const second = await lookupPhoto(buffer, { filename: "renamed.jpg" }, impl);
    expect(first.webCheck.source).toBe("live"); expect(second.webCheck.source).toBe("cache");
    expect(impl.detect).toHaveBeenCalledTimes(1); expect(records.size).toBe(1);
    expect([...records.values()][0]).not.toHaveProperty("origin");
  });
  it("refreshes expired or allowlist-incompatible evidence", async () => {
    const { impl, records } = services(), buffer = await image();
    const first = await lookupPhoto(buffer, { filename: "a.jpg" }, impl);
    records.get(first.sha256)!.expiresAt = new Date(now.getTime() - 1);
    await lookupPhoto(buffer, { filename: "b.jpg" }, impl);
    records.get(first.sha256)!.stockDomainAllowlist = ["different.example"];
    await lookupPhoto(buffer, { filename: "c.jpg" }, impl);
    expect(impl.detect).toHaveBeenCalledTimes(3);
    expect(records.get(first.sha256)!.stockDomainAllowlist).toEqual(guardrailConfig.STOCK_DOMAIN_ALLOWLIST);
  });
  it("does not cache failed requests or represent quota exhaustion as a clean result", async () => {
    const { impl } = services(); impl.detect.mockRejectedValue(new VisionError("quota", "Daily limit reached."));
    const result = await lookupPhoto(await image(), { filename: "fixture.jpg" }, impl);
    expect(result.vision).toBeNull(); expect(result.webCheck.status).toBe("unavailable"); expect(result.visionError).toContain("Daily limit");
    expect(impl.saveCache).not.toHaveBeenCalled();
    expect(result.unavailableReason).toBe("daily_limit");
  });
  it("keeps raw annotations server-side and can reclassify them without another paid call", async () => {
    const { impl, records } = services();
    const raw = { responses: [{ webDetection: { fullMatchingImages: [{ url: "https://images.pexels.com/test.jpg" }] } }] };
    const detect = vi.fn(async (_buffer: Buffer, onRaw?: (raw: unknown) => void) => { onRaw?.(raw); return extractVisionResult(raw); });
    const first = await lookupPhoto(await image(), { filename: "test.jpg" }, { ...impl, detect });
    const cached = records.get(first.sha256)!; cached.stockDomainAllowlist = ["old-policy.example"];
    cached.result.nonStockFullMatchCount = 1; cached.result.stockDomainMatchCount = 0;
    const second = await lookupPhoto(await image(), { filename: "test.jpg" }, { ...impl, detect });
    expect(cached.raw).toEqual(raw); expect(second.webCheck.nonStockFullMatchCount).toBe(0);
    expect(second.webCheck.source).toBe("cache"); expect(detect).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveProperty("raw");
  });
  it("skips a paid attempt when the API request no longer has a safe live-call budget", async () => {
    const { impl } = services();
    const result = await lookupPhoto(await image(), { filename: "test.jpg", deadlineMs: Date.now() }, impl);
    expect(result.unavailableReason).toBe("vision_timeout"); expect(result.webCheck.status).toBe("unavailable"); expect(impl.detect).not.toHaveBeenCalled();
  });
  it("keeps successful live evidence even when cache persistence or reference comparison fails", async () => {
    const { impl } = services(); impl.saveCache.mockRejectedValue(new Error("offline")); impl.references.mockRejectedValue(new Error("offline"));
    const result = await lookupPhoto(await image(), { filename: "fixture.jpg" }, impl);
    expect(result.webCheck.status).toBe("ok"); expect(result.vision).not.toBeNull();
    expect(result.referenceCoverage.available).toBe(false); expect(result.warnings.join(" ")).toContain("cache storage failed");
  });
});
describe("cross-claim comparison", () => {
  const hashes = { sha256: "a".repeat(64), dhash: "0000000000000000" };
  const reference = { filename: "fixture.jpg", ...hashes, claimId: "OTHER", claimDate: "2026-08-01" };
  it("prioritizes exact matches and never compares to the current claim", () => {
    const result = findReferenceMatches(hashes, [
      { ...reference, filename: "near.jpg", sha256: "b".repeat(64), dhash: "0000000000000001" },
      reference, { ...reference, filename: "own.jpg", claimId: "CURRENT" },
    ], { claimId: "CURRENT" });
    expect(result.crossClaimMatches).toHaveLength(2); expect(result.crossClaimMatches[0].matchType).toBe("exact");
    expect(result.crossClaimMatches[1].distance).toBe(1);
  });
  it("reports unassigned photo matches without inventing claim IDs or dates", () => {
    const result = findReferenceMatches(hashes, [{ ...reference, claimId: null, claimDate: null }]);
    expect(result.referenceMatches).toHaveLength(1); expect(result.crossClaimMatches).toEqual([]);
  });
  it("excludes the actual seed file itself and rejects distant hashes", () => {
    const result = findReferenceMatches(hashes, [reference, { ...reference, filename: "other.jpg", sha256: "b".repeat(64), dhash: "ffffffffffffffff" }], { referenceFilename: reference.filename });
    expect(result.referenceMatches).toEqual([]);
  });
});
