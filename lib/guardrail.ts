// guardrail.ts
//
// This is the ONLY place a decision gets made. It is a pure function:
// no network calls, no database reads, no randomness, no calls to an LLM.
// Everything it needs — hashes, Vision results, narrative-similarity
// scores — was already computed upstream by /api/lookup and /api/decide
// and is passed in as `evidence`. Given the same evidence, this function
// always returns the same decision, which is what makes it unit-testable
// and defensible in the guardrail justification writeup.

import {
  guardrailConfig as defaultConfig,
  RULE_VERSION,
  GuardrailConfig,
} from "./guardrail.config";

export type MatchType = "exact" | "near";

export interface CrossClaimMatch {
  matchType: MatchType;
  distance: number; // 0 for exact (sha256) matches
  matchedFilename: string;
  matchedClaimId: string;
  matchedClaimDate: string; // ISO date, e.g. "2026-08-14"
}

export interface WebCheck {
  status: "ok" | "unavailable";
  source: "live" | "cache" | null;
  fullMatchCount: number;
  partialMatchCount: number;
  similarCount: number;
  nonStockFullMatchCount: number;
  domains: string[];
}

export interface PhotoEvidence {
  filename: string;
  sha256: string;
  dhash: string; // 16 hex chars = 64 bits
  crossClaimMatches: CrossClaimMatch[]; // matches against OTHER claims only
  webCheck: WebCheck;
}

export interface ClaimEvidence {
  claimId: string;
  claimant: string;
  customerEmail: string;
  date: string; // ISO date
  amount: number;
  narrative: string;
  photos: PhotoEvidence[]; // exactly 2 in the happy path
}

export interface OtherClaimSummary {
  claimId: string;
  claimant: string;
  date: string;
  amount: number;
  narrativeSimilarity: number; // 0–1, precomputed by the caller
}

export type Decision = "Auto-approve" | "Escalate" | "Blocked";

export interface GuardrailResult {
  decision: Decision;
  reasons: string[]; // things that justify Escalate; empty => Auto-approve
  notes: string[]; // context for the adjuster; never changes the decision
  ruleHits: string[]; // which rule IDs fired, for audit_log
  ruleVersion: string;
}

export function hammingDistanceHex(a: string, b: string): number {
  let xor = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

function daysBetween(isoA: string, isoB: string): number {
  const ms = Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime());
  return ms / (1000 * 60 * 60 * 24);
}

export function decide(
  claim: ClaimEvidence,
  otherClaims: OtherClaimSummary[],
  config: GuardrailConfig = defaultConfig
): GuardrailResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const ruleHits: string[] = [];

  // R0 — Blocked: the claim doesn't have the two mapped photos it needs.
  if (claim.photos.length < 2) {
    return {
      decision: "Blocked",
      reasons: [
        `Only ${claim.photos.length} photo(s) mapped; 2 are required before a decision can be made.`,
      ],
      notes: [],
      ruleHits: ["R0"],
      ruleVersion: RULE_VERSION,
    };
  }

  const photosWithMatches = claim.photos.filter((p) => p.crossClaimMatches.length > 0);

  // E1 — Full reuse: every one of this claim's photos matches another claim.
  if (photosWithMatches.length === claim.photos.length) {
    ruleHits.push("E1");
    for (const p of photosWithMatches) {
      const m = p.crossClaimMatches[0];
      reasons.push(
        `${p.filename} is a ${m.matchType} match (distance ${m.distance}) of ${m.matchedFilename} ` +
          `from claim ${m.matchedClaimId} (${m.matchedClaimDate}).`
      );
    }
  }
  // E2 — Partial reuse: some, but not all, photos matched another claim.
  else if (photosWithMatches.length > 0) {
    const partialReasons = photosWithMatches.map((p) => {
      const m = p.crossClaimMatches[0];
      return (
        `${p.filename} is a ${m.matchType} match (distance ${m.distance}) of ${m.matchedFilename} ` +
        `from claim ${m.matchedClaimId} (${m.matchedClaimDate}); the claim's other photo is unique.`
      );
    });
    if (config.PARTIAL_MATCH_ACTION === "approve_with_note") {
      // A deliberate policy choice, not a bug: still visible to the
      // adjuster, but does not by itself send the claim to a human.
      notes.push(...partialReasons);
    } else {
      ruleHits.push("E2");
      reasons.push(...partialReasons);
    }
  }

  // E3 — Web Detection: too many full matches on non-stock domains.
  // N1 — full matches exist, but only on allow-listed stock domains (note only).
  for (const p of claim.photos) {
    if (p.webCheck.status !== "ok") continue;
    if (p.webCheck.nonStockFullMatchCount >= config.WEB_FULL_MATCH_THRESHOLD) {
      ruleHits.push("E3");
      const shown = p.webCheck.domains.slice(0, 3).join(", ");
      const more = p.webCheck.domains.length > 3 ? ", …" : "";
      reasons.push(
        `${p.filename} has ${p.webCheck.nonStockFullMatchCount} full match(es) on non-stock sites (domains: ${shown}${more}).`
      );
    } else if (p.webCheck.fullMatchCount > 0) {
      notes.push(`${p.filename} matches a known stock-photo source only; not treated as reuse.`);
    }
  }

  // E4 — Fail-safe: a web check couldn't be completed and there's no cache to fall back on.
  for (const p of claim.photos) {
    if (p.webCheck.status !== "unavailable") continue;
    if (config.ON_WEB_CHECK_UNAVAILABLE === "escalate") {
      ruleHits.push("E4");
      reasons.push(`${p.filename} could not be checked against the web (service unavailable); escalating to be safe.`);
    } else {
      notes.push(`${p.filename} could not be checked against the web; approved without this check.`);
    }
  }

  // N2 — Narrative similarity WITHOUT a matching photo. Note only, by design:
  // a similar story alone is not evidence of reuse, only a prompt to look closer.
  for (const other of otherClaims) {
    const alreadyLinkedByPhoto = claim.photos.some((p) =>
      p.crossClaimMatches.some((m) => m.matchedClaimId === other.claimId)
    );
    if (other.narrativeSimilarity >= config.NARRATIVE_SIMILARITY_NOTE_THRESHOLD && !alreadyLinkedByPhoto) {
      notes.push(
        `Narrative resembles claim ${other.claimId} (similarity ${other.narrativeSimilarity.toFixed(2)}); photos are unique.`
      );
    }
  }

  // N3 — Same claimant filed another claim within the context window.
  for (const other of otherClaims) {
    if (other.claimant !== claim.claimant || other.claimId === claim.claimId) continue;
    const gap = daysBetween(claim.date, other.date);
    if (gap <= config.CONTEXT_WINDOW_DAYS) {
      notes.push(`${claim.claimant} also filed claim ${other.claimId} ${Math.round(gap)} day(s) apart.`);
    }
  }

  // N4 — Same amount + near-identical narrative to another claim.
  for (const other of otherClaims) {
    if (other.amount === claim.amount && other.narrativeSimilarity >= config.NARRATIVE_SIMILARITY_NOTE_THRESHOLD) {
      notes.push(`Claim ${other.claimId} has the same amount ($${claim.amount}) and a similar narrative.`);
    }
  }

  // N5 — This claim's own two photos are identical (or near-identical) to each other.
  const [p1, p2] = claim.photos;
  if (p1 && p2) {
    if (p1.sha256 === p2.sha256) {
      notes.push(`${p1.filename} and ${p2.filename} are byte-identical to each other.`);
    } else if (hammingDistanceHex(p1.dhash, p2.dhash) <= config.DHASH_MAX_DISTANCE) {
      notes.push(`${p1.filename} and ${p2.filename} are visually near-identical to each other.`);
    }
  }

  return {
    decision: reasons.length > 0 ? "Escalate" : "Auto-approve",
    reasons,
    notes,
    ruleHits,
    ruleVersion: RULE_VERSION,
  };
}
