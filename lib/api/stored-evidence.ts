import type { PhotoEvidence } from "../guardrail";
import { findReferenceMatches, usableCachedVision, type ReferencePhoto } from "../lookup";
import { USER_DATA_RETENTION_MS, type PhotoRecord, type VisionCacheRecord } from "../models";
import { toWebCheck } from "../vision";
import { ApiError } from "./http";

/** Never accepts browser evidence and never needs original user-upload bytes. */
export function evidenceFromStoredPhoto(photo: PhotoRecord, cached: VisionCacheRecord | null,
  references: ReferencePhoto[], claimId: string, now = new Date()): PhotoEvidence {
  if (!/^[a-f\d]{64}$/i.test(photo.sha256) || !/^[a-f\d]{16}$/i.test(photo.dhash)) throw new ApiError(409, "invalid_stored_photo", "Stored photo hashes are invalid. Look up this photo again.");
  const lookup = photo.lookup;
  const base = { filename: photo.filename, sha256: photo.sha256, dhash: photo.dhash,
    crossClaimMatches: findReferenceMatches(photo, references, { claimId }).crossClaimMatches };
  // A newer failed forceLive attempt must not silently resurrect an older success.
  if (!lookup || lookup.sha256 !== photo.sha256 || lookup.reason || !lookup.result || !lookup.checkedAt || !lookup.source) return { ...base, webCheck: toWebCheck(null) };
  const cacheResult = cached?.sha256 === photo.sha256 ? usableCachedVision(cached, now) : null;
  if (cacheResult && cached) return { ...base, webCheck: toWebCheck(cacheResult,
    cached.checkedAt.getTime() === lookup.checkedAt.getTime() ? lookup.source : "cache") };
  // Preserve a verified result if cache persistence failed. Enforce the same age/policy limits.
  const snapshot = usableCachedVision({ sha256: photo.sha256, createdAt: lookup.checkedAt, checkedAt: lookup.checkedAt,
    expiresAt: new Date(lookup.checkedAt.getTime() + USER_DATA_RETENTION_MS), result: lookup.result,
    stockDomainAllowlist: lookup.stockDomainAllowlist }, now);
  return { ...base, webCheck: toWebCheck(snapshot, lookup.source) };
}
