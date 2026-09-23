import { describe, it, expect } from "vitest";
import { decide, ClaimEvidence, OtherClaimSummary, PhotoEvidence } from "./guardrail";
import { guardrailConfig } from "./guardrail.config";

function makePhoto(overrides: Partial<PhotoEvidence> = {}): PhotoEvidence {
  return {
    filename: "IMG-001.jpg",
    sha256: "a".repeat(64),
    dhash: "0000000000000000",
    crossClaimMatches: [],
    webCheck: {
      status: "ok",
      source: "cache",
      fullMatchCount: 0,
      partialMatchCount: 0,
      similarCount: 0,
      nonStockFullMatchCount: 0,
      domains: [],
    },
    ...overrides,
  };
}

function makeClaim(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    claimId: "MI-10234",
    claimant: "Sarah Chen",
    customerEmail: "sarah.chen@email.com",
    date: "2026-08-03",
    amount: 3200,
    narrative: "Rear-ended at a red light on Legacy Dr.",
    photos: [
      makePhoto({ filename: "IMG-010.jpg", sha256: "b".repeat(64), dhash: "1111111111111111" }),
      makePhoto({ filename: "IMG-013.jpg", sha256: "c".repeat(64), dhash: "2222222222222222" }),
    ],
    ...overrides,
  };
}

describe("R0 — blocked", () => {
  it("blocks a claim with fewer than 2 mapped photos", () => {
    const result = decide(makeClaim({ photos: [makePhoto()] }), []);
    expect(result.decision).toBe("Blocked");
    expect(result.ruleHits).toEqual(["R0"]);
  });
});

describe("E1 — full reuse", () => {
  it("escalates when both photos match photos from another claim", () => {
    const claim = makeClaim({
      photos: [
        makePhoto({
          filename: "IMG-010.jpg",
          crossClaimMatches: [
            { matchType: "exact", distance: 0, matchedFilename: "IMG-004.jpg", matchedClaimId: "MI-10250", matchedClaimDate: "2026-08-14" },
          ],
        }),
        makePhoto({
          filename: "IMG-013.jpg",
          crossClaimMatches: [
            { matchType: "near", distance: 3, matchedFilename: "IMG-024.jpg", matchedClaimId: "MI-10250", matchedClaimDate: "2026-08-14" },
          ],
        }),
      ],
    });
    const result = decide(claim, []);
    expect(result.decision).toBe("Escalate");
    expect(result.ruleHits).toContain("E1");
    expect(result.reasons).toHaveLength(2);
  });
});

describe("E2 — partial reuse", () => {
  const claimWithOneMatch = () =>
    makeClaim({
      photos: [
        makePhoto({
          filename: "IMG-010.jpg",
          crossClaimMatches: [
            { matchType: "exact", distance: 0, matchedFilename: "IMG-017.jpg", matchedClaimId: "MI-10244", matchedClaimDate: "2026-08-16" },
          ],
        }),
        makePhoto({ filename: "IMG-013.jpg", crossClaimMatches: [] }),
      ],
    });

  it("escalates by default when only one of two photos matches another claim", () => {
    const result = decide(claimWithOneMatch(), []);
    expect(result.decision).toBe("Escalate");
    expect(result.ruleHits).toContain("E2");
  });

  it("approves with a note instead when PARTIAL_MATCH_ACTION is approve_with_note", () => {
    const result = decide(claimWithOneMatch(), [], {
      ...guardrailConfig,
      PARTIAL_MATCH_ACTION: "approve_with_note",
    });
    expect(result.decision).toBe("Auto-approve");
    expect(result.ruleHits).not.toContain("E2");
    expect(result.notes.some((n) => n.includes("IMG-010.jpg"))).toBe(true);
  });
});

describe("E3 — web matches on non-stock domains", () => {
  it("escalates once non-stock full matches reach the threshold", () => {
    const claim = makeClaim({
      photos: [
        makePhoto({
          filename: "IMG-010.jpg",
          webCheck: {
            status: "ok",
            source: "live",
            fullMatchCount: 3,
            partialMatchCount: 0,
            similarCount: 0,
            nonStockFullMatchCount: 3,
            domains: ["some-reseller-site.com", "auction-listing.net", "random-blog.io"],
          },
        }),
        makePhoto({ filename: "IMG-013.jpg" }),
      ],
    });
    const result = decide(claim, []);
    expect(result.decision).toBe("Escalate");
    expect(result.ruleHits).toContain("E3");
  });

  it("does not escalate on matches limited to allow-listed stock domains (note only)", () => {
    const claim = makeClaim({
      photos: [
        makePhoto({
          filename: "IMG-010.jpg",
          webCheck: {
            status: "ok",
            source: "live",
            fullMatchCount: 5,
            partialMatchCount: 0,
            similarCount: 0,
            nonStockFullMatchCount: 0,
            domains: ["pexels.com"],
          },
        }),
        makePhoto({ filename: "IMG-013.jpg" }),
      ],
    });
    const result = decide(claim, []);
    expect(result.decision).toBe("Auto-approve");
    expect(result.notes.some((n) => n.includes("stock-photo source"))).toBe(true);
  });
});

describe("E4 — fail-safe when a web check is unavailable", () => {
  it("escalates by default (fails closed)", () => {
    const claim = makeClaim({
      photos: [
        makePhoto({
          filename: "IMG-010.jpg",
          webCheck: { status: "unavailable", source: null, fullMatchCount: 0, partialMatchCount: 0, similarCount: 0, nonStockFullMatchCount: 0, domains: [] },
        }),
        makePhoto({ filename: "IMG-013.jpg" }),
      ],
    });
    const result = decide(claim, []);
    expect(result.decision).toBe("Escalate");
    expect(result.ruleHits).toContain("E4");
  });
});

describe("N2 — narrative similarity alone never escalates", () => {
  it("adds a note but still auto-approves when only the narrative is similar", () => {
    const claim = makeClaim();
    const others: OtherClaimSummary[] = [
      { claimId: "MI-10250", claimant: "Olivia Bennett", date: "2026-08-14", amount: 2900, narrativeSimilarity: 0.82 },
    ];
    const result = decide(claim, others);
    expect(result.decision).toBe("Auto-approve");
    expect(result.reasons).toHaveLength(0);
    expect(result.notes.some((n) => n.includes("MI-10250"))).toBe(true);
  });
});

describe("clean claim", () => {
  it("auto-approves with no reasons and no notes when everything is clean", () => {
    const result = decide(makeClaim(), []);
    expect(result.decision).toBe("Auto-approve");
    expect(result.reasons).toHaveLength(0);
    expect(result.notes).toHaveLength(0);
  });
});
