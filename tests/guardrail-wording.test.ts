import { describe, expect, it } from "vitest";
import { decide, type ClaimEvidence, type PhotoEvidence } from "../lib/guardrail";

function photo(filename: string, full: number, nonStock: number): PhotoEvidence {
  return {
    filename,
    sha256: filename === "IMG-031.jpg" ? "a".repeat(64) : "b".repeat(64),
    dhash: filename === "IMG-031.jpg" ? "0".repeat(16) : "f".repeat(16),
    crossClaimMatches: [],
    webCheck: {
      status: "ok",
      source: "cache",
      fullMatchCount: full,
      nonStockFullMatchCount: nonStock,
      partialMatchCount: 0,
      similarCount: 0,
      domains: ["example.org"],
    },
  };
}

describe("stock-only note", () => {
  const base: ClaimEvidence = {
    claimId: "MI-10237",
    claimant: "Devon Price",
    customerEmail: "devon.price@email.com",
    date: "2026-08-07",
    amount: 2450,
    narrative: "Hail damage to hood and roof during the Aug 6 storm system.",
    photos: [photo("IMG-031.jpg", 1, 1), photo("IMG-026.jpg", 0, 0)],
  };

  it("does not call a below-threshold non-stock match stock-only", () => {
    const result = decide(base, []);
    expect(result.decision).toBe("Auto-approve");
    expect(result.notes.join(" ")).not.toContain("stock-photo source only");
  });

  it("retains the stock-only note when every full match is stock-domain", () => {
    const result = decide({ ...base, photos: [photo("IMG-031.jpg", 1, 0), base.photos[1]] }, []);
    expect(result.notes.join(" ")).toContain("stock-photo source only");
  });
});
