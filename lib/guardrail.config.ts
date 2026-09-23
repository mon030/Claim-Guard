// guardrail.config.ts
//
// All tunable thresholds live here, versioned in code (not in env vars),
// so a change to a threshold is a reviewable code change, not a silent
// runtime config edit. Every value below is a PLACEHOLDER: set the real
// values only after running `validate-vision` on the actual 36-photo
// packet and reading docs/vision-validation.txt.

export const RULE_VERSION = "1.0.0";

export const guardrailConfig = {
  /**
   * Perceptual-hash (dHash) Hamming distance at or below which two photos
   * count as "near duplicates" of each other. 0 = identical hash, 64 = max
   * distance for a 64-bit hash. Start conservative; widen only if
   * validate-vision shows real near-duplicates being missed at this value.
   */
  DHASH_MAX_DISTANCE: 6,

  /**
   * Number of *non-stock-domain* full matches on the public web before a
   * photo is treated as suspicious. Photos legitimately sourced from stock
   * sites will almost always show matches there — those don't count
   * toward this threshold, only matches elsewhere do.
   */
  WEB_FULL_MATCH_THRESHOLD: 3,

  /**
   * Domains where a full match is expected and NOT suspicious (the
   * photo's known original source).
   */
  STOCK_DOMAIN_ALLOWLIST: ["pexels.com", "pixabay.com", "unsplash.com"] as string[],

  /**
   * What to do when exactly one of a claim's photos (not all of them)
   * matches a photo from a different claim.
   *   "escalate"           -> always send to a human (default: a false
   *                           approval costs more than a false escalation)
   *   "approve_with_note"  -> auto-approve, but flag it for the adjuster
   */
  PARTIAL_MATCH_ACTION: "escalate" as "escalate" | "approve_with_note",

  /**
   * What to do if a web check could not be completed (quota hit, network
   * error, timeout) and there is no cached result to fall back on.
   *   "escalate" -> fail closed: an unverifiable claim goes to a human
   *   "approve"  -> fail open (not recommended)
   */
  ON_WEB_CHECK_UNAVAILABLE: "escalate" as "escalate" | "approve",

  /**
   * Narrative-similarity score (0–1) at or above which we add a note that
   * this claim's story resembles another claim's story. This NEVER
   * escalates by itself — only paired with an actual photo match does
   * reuse become actionable (see rule E1/E2 vs. note N2).
   */
  NARRATIVE_SIMILARITY_NOTE_THRESHOLD: 0.6,

  /**
   * Window, in days, within which the same claimant filing another claim
   * is surfaced as a note (not an escalation).
   */
  CONTEXT_WINDOW_DAYS: 30,
};

export type GuardrailConfig = typeof guardrailConfig;
