import { describe, expect, it } from "vitest";
import { validateMapping, REFERENCE_FILENAMES } from "./dataset";
// Explicitly synthetic identifiers/pairings; never written to data/mapping.json.
const claims = Array.from({ length: 18 }, (_, i) => ({ claimId: `TEST-${i}` }));
const complete = () => Object.fromEntries(claims.map((claim, i) => [claim.claimId, REFERENCE_FILENAMES.slice(i * 2, i * 2 + 2)]));
describe("mapping validation", () => {
  it("accepts a complete one-use-per-photo mapping", () => {
    expect(validateMapping(claims, complete(), REFERENCE_FILENAMES).errors).toEqual([]);
  });
  it("accepts explicit null mappings for seed, but rejects them for submission", () => {
    const input = Object.fromEntries(claims.map((claim) => [claim.claimId, null]));
    expect(validateMapping(claims, input, REFERENCE_FILENAMES, true)).toMatchObject({ errors: [], warnings: expect.any(Array) });
    expect(validateMapping(claims, input, REFERENCE_FILENAMES, true).warnings).toHaveLength(18);
    expect(validateMapping(claims, input, REFERENCE_FILENAMES).errors).toContain("TEST-0: mapping is null; exactly 2 distinct photo filenames are required.");
  });
  it("rejects missing and unknown claim IDs", () => {
    const mapping = complete(); delete mapping["TEST-0"]; mapping["UNKNOWN"] = [];
    const errors = validateMapping(claims, mapping, REFERENCE_FILENAMES, true).errors.join("\n");
    expect(errors).toContain("Missing mapping entry for TEST-0"); expect(errors).toContain("Unknown claimId");
  });
  it("rejects repeated filenames within a claim and across claims", () => {
    const mapping = complete(); mapping["TEST-0"] = ["IMG-001.jpg", "IMG-001.jpg"]; mapping["TEST-1"] = ["IMG-001.jpg", "IMG-004.jpg"];
    const errors = validateMapping(claims, mapping, REFERENCE_FILENAMES).errors.join("\n");
    expect(errors).toContain("same filename appears twice"); expect(errors).toContain("used 3 times"); expect(errors).toContain("IMG-002.jpg: not assigned");
  });
  it.each([["../secret.jpg", "IMG-002.jpg"], ["IMG-001.jpg"], [1, 2], "IMG-001.jpg"])("rejects invalid photo entries %j", (entry) => {
    expect(validateMapping(claims, { ...complete(), "TEST-0": entry }, REFERENCE_FILENAMES, true).errors.length).toBeGreaterThan(0);
  });
});
