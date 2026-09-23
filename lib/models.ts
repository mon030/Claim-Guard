import type { Binary, ObjectId } from "mongodb";
import type { ClaimEvidence, GuardrailResult, PhotoEvidence } from "./guardrail";
import type { VisionResult } from "./vision";

export const USER_DATA_RETENTION_DAYS = 14;
export const USER_DATA_RETENTION_MS = USER_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export type Origin = "seed" | "user";
export type Retention =
  | { origin: "seed"; createdAt: Date; expiresAt?: never }
  | { origin: "user"; createdAt: Date; expiresAt: Date };

export function retentionFor(origin: "seed", now?: Date): Extract<Retention, { origin: "seed" }>;
export function retentionFor(origin: "user", now?: Date): Extract<Retention, { origin: "user" }>;
export function retentionFor(origin: Origin, now?: Date): Retention;
export function retentionFor(origin: Origin, now: Date = new Date()): Retention {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Retention requires a valid date.");
  const createdAt = new Date(now.getTime());
  return origin === "seed" ? { origin, createdAt } : {
    origin, createdAt, expiresAt: new Date(createdAt.getTime() + USER_DATA_RETENTION_MS),
  };
}

/** Optional ID lets the driver assign ObjectIds during inserts. */
type Stored = { _id?: ObjectId };
export type ClaimRecord = Stored & Retention & Omit<ClaimEvidence, "photos"> & {
  emailSubject: string;
  emailBody: string;
  location: string;
  category: string;
  mappedPhotos: [string, string] | null;
  clientRequestId?: string;
};
export type PhotoRecord = Stored & Retention & Pick<PhotoEvidence, "filename" | "sha256" | "dhash"> & {
  claimId: string | null;
  contentType: string;
  byteLength: number;
  // Only seeds retain original bytes. API uploads persist thumbnails and evidence only.
  content?: Binary;
  slot?: number;
  resized?: boolean;
  lookup?: StoredPhotoLookup;
  thumbnail: Binary;
  thumbnailContentType: "image/jpeg";
};
export type LookupUnavailableReason = "daily_limit" | "vision_timeout" | "vision_error";
export interface StoredPhotoLookup {
  sha256: string;
  attemptedAt: Date;
  checkedAt: Date | null;
  source: "live" | "cache" | null;
  reason: LookupUnavailableReason | null;
  result: VisionResult | null;
  stockDomainAllowlist: string[];
}
export type VisionCacheRecord = Stored & {
  createdAt: Date;
  expiresAt: Date;
  sha256: string;
  checkedAt: Date;
  result: VisionResult;
  /** Server-only original annotation. Legacy Phase 3 cache entries may lack it. */
  raw?: unknown;
  // Needed to invalidate policy-derived counts when the allowlist changes.
  stockDomainAllowlist: string[];
};
export type DecisionRecord = Stored & Retention & {
  claimId: string;
  evidence: ClaimEvidence;
  result: GuardrailResult;
  explanation: string;
  explanationSource: "llm" | "deterministic";
  photoIds?: ObjectId[];
};
export type AuditLogRecord = Stored & Retention & {
  claimId: string | null;
  event: "claim_loaded" | "photo_lookup" | "decision" | "form_prefill" | "form_human_submission" | "escalation";
  status?: "completed" | "pending" | "unavailable";
  message?: string;
  sequence?: number;
  photoId?: ObjectId;
  ruleVersion: string | null;
  ruleHits: string[];
  // Explicit fields avoid accidentally logging secrets or raw request bodies.
  outcome: "ok" | "unavailable" | "blocked";
  relatedId: ObjectId | null;
};
export type UsageRecord = Stored & {
  createdAt: Date;
  expiresAt: Date;
  type: "vision" | "llm";
  date: string; // UTC YYYY-MM-DD, one global counter per type per day.
  count: number;
};

export interface CollectionModels {
  claims: ClaimRecord;
  photos: PhotoRecord;
  vision_cache: VisionCacheRecord;
  decisions: DecisionRecord;
  audit_log: AuditLogRecord;
  usage: UsageRecord;
}
