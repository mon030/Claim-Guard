import { describe, expect, it } from "vitest";
import { buildValidationReport, formatValidationReport } from "./validation-report";
import type { LookupReport } from "./lookup";
import { extractVisionResult, toWebCheck } from "./vision";
const photo = (filename: string, sha256: string, dhash: string): LookupReport => ({ filename, sha256, dhash,
  vision: null, webCheck: toWebCheck(null), checkedAt: null, visionError: "Synthetic test failure", warnings: [], unavailableReason: "vision_error", matchedClaimants: {},
  referenceMatches: [], crossClaimMatches: [], referenceCoverage: { total: 0, unmapped: 0, available: false } });
describe("calibration report", () => {
  it("computes all pair distances and byte groups even when Vision is unavailable", () => {
    const report = buildValidationReport([photo("a", "a", "0000000000000000"), photo("b", "a", "0000000000000000"), photo("c", "b", "0000000000000001")]);
    expect(report.byteIdenticalGroups).toEqual([{ sha256: "a", filenames: ["a", "b"] }]);
    expect(report.distanceHistogram.reduce((sum, row) => sum + row.pairs, 0)).toBe(3);
    expect(report.distanceHistogram[0].pairs).toBe(1); expect(report.distanceHistogram[1].pairs).toBe(2);
    expect(report.nearDuplicatePairs).toHaveLength(2);
    expect(formatValidationReport(report)).toContain("UNAVAILABLE | - | -"); expect(report.successfulPhotos).toBe(0);
  });
  it("counts domains by distinct image hashes as well as file names", () => {
    const a = photo("a", "same", "0000000000000000");
    a.vision = extractVisionResult({ responses: [{ webDetection: { fullMatchingImages: [{ url: "https://example.test/a.jpg" }] } }] }); a.webCheck = toWebCheck(a.vision);
    const report = buildValidationReport([a, { ...a, filename: "b" }]);
    expect(report.topDomains).toEqual([{ domain: "example.test", photoCount: 2, uniqueImageCount: 1 }]);
    expect(report.nonStockMatches).toHaveLength(2);
  });
});
