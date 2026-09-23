import type { GuardrailResult, PhotoEvidence, WebCheck } from "../guardrail";
import type { LookupUnavailableReason } from "../models";
import type { EscalationStatus } from "../escalation";

/** Approved response envelope: evidence itself remains the exact team interface. */
export interface LookupResponse {
  photoId: string;
  evidence: PhotoEvidence;
  lookup: {
    status: WebCheck["status"];
    source: WebCheck["source"];
    fetchedAt: string | null;
    reason: LookupUnavailableReason | null;
    message: string | null;
    warnings: string[];
    stockDomains?: string[];
    referenceCoverage: { total: number; unmapped: number; available: boolean };
  };
  matches: { filename: string; claimId: string; claimant: string | null; date: string; matchType: "exact" | "near"; distance: number }[];
}
export interface TimelineEntry {
  sequence: number;
  event: string;
  message: string;
  status: "completed" | "pending" | "unavailable";
  ruleHits: string[];
}
export interface DecideResponse extends GuardrailResult {
  decisionId: string;
  prefillUrl: string | null;
  lookupSummary: string;
  narrativeSimilaritySource: "deterministic";
  escalation: EscalationStatus;
  timeline: TimelineEntry[];
}
