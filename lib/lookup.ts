import { z } from "zod";
import type { CrossClaimMatch, WebCheck } from "./guardrail";
import { guardrailConfig } from "./guardrail.config";
import { hammingDistanceHex } from "./hash";
import { fingerprintPhoto } from "./photos";
import { getCollections } from "./mongodb";
import { USER_DATA_RETENTION_MS, type VisionCacheRecord, type LookupUnavailableReason } from "./models";
import { detectWeb, extractVisionResult, VisionError, toWebCheck, type VisionResult } from "./vision";
import { reserveDailyUsage } from "./usage";
import { safeError } from "./errors";
import { isMongoFailure, withMongoRetry } from "./mongo-retry";

export interface ReferencePhoto {
  filename: string; sha256: string; dhash: string; claimId: string | null; claimDate: string | null;
  claimant?: string;
}
export interface ReferenceMatch {
  matchType: "exact" | "near"; distance: number; matchedFilename: string;
  matchedClaimId: string | null; matchedClaimDate: string | null;
}
export interface LookupServices {
  now(): Date;
  readCache(sha256: string): Promise<VisionCacheRecord | null>;
  saveCache(record: VisionCacheRecord): Promise<void>;
  detect(buffer: Buffer, onRaw?: (raw: unknown) => void, timeoutMs?: number): Promise<VisionResult>;
  references(): Promise<ReferencePhoto[]>;
}
const count = z.number().int().nonnegative();
const cachedResultSchema = z.object({
  fullMatchCount: count, partialMatchCount: count, similarCount: count, pageCount: count,
  pages: z.array(z.object({ url: z.string(), domain: z.string() })), domains: z.array(z.string()),
  stockDomainMatchCount: count, nonStockFullMatchCount: count,
  topWebEntities: z.array(z.object({ entityId: z.string().nullable(), description: z.string().nullable(), score: z.number().nullable() })),
  bestGuessLabels: z.array(z.string()),
}).refine((result) => result.stockDomainMatchCount + result.nonStockFullMatchCount === result.fullMatchCount);
const sameAllowlist = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Reclassify raw annotations under the current allowlist; reject stale/malformed evidence. */
export function usableCachedVision(cached: VisionCacheRecord | null, now = new Date()): VisionResult | null {
  if (!cached || !(cached.expiresAt instanceof Date) || cached.expiresAt <= now ||
      !(cached.checkedAt instanceof Date) || !Number.isFinite(cached.checkedAt.getTime())) return null;
  if (cached.raw !== undefined) {
    try { return extractVisionResult(cached.raw); } catch { return null; }
  }
  const validated = cachedResultSchema.safeParse(cached.result);
  return Array.isArray(cached.stockDomainAllowlist) && sameAllowlist(cached.stockDomainAllowlist, guardrailConfig.STOCK_DOMAIN_ALLOWLIST) && validated.success ? validated.data : null;
}

export function createMongoLookupServices(deadline?: number): LookupServices {
 const db = <T>(work: () => Promise<T>) => withMongoRetry(work, deadline);
 return {
  now: () => new Date(),
  async readCache(sha256) {
    const { vision_cache } = await db(getCollections);
    return db(() => vision_cache.findOne({ sha256 }, { timeoutMS: 1_000 }));
  },
  async saveCache(record) {
    const { vision_cache } = await db(getCollections);
    const { createdAt, ...fields } = record;
    try {
      await db(() => vision_cache.updateOne({ sha256: record.sha256 }, { $set: fields, $setOnInsert: { createdAt } }, { upsert: true, timeoutMS: 1_000 }));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      await db(() => vision_cache.updateOne({ sha256: record.sha256 }, { $set: fields }, { timeoutMS: 1_000 }));
    }
  },
  detect: (buffer, onRaw, timeoutMs) => detectWeb(buffer, { beforeAttempt: () => reserveDailyUsage("vision"), onRaw, timeoutMs }),
  async references() {
    const { photos, claims } = await db(getCollections);
    const now = new Date();
    const active = { $or: [{ origin: "seed" as const }, { origin: "user" as const, expiresAt: { $gt: now } }] };
    const [photoRows, claimRows] = await db(() => Promise.all([
      photos.find(active, { projection: { filename: 1, sha256: 1, dhash: 1, claimId: 1 }, timeoutMS: 1_000 }).toArray(),
      claims.find(active, { projection: { claimId: 1, date: 1, claimant: 1 }, timeoutMS: 1_000 }).toArray(),
    ]));
    const dates = new Map(claimRows.map((claim) => [claim.claimId, claim.date]));
    const claimants = new Map(claimRows.map((claim) => [claim.claimId, claim.claimant]));
    return photoRows.map((photo) => ({ filename: photo.filename, sha256: photo.sha256, dhash: photo.dhash,
      claimId: photo.claimId && dates.has(photo.claimId) ? photo.claimId : null,
      claimDate: photo.claimId ? dates.get(photo.claimId) ?? null : null,
      claimant: photo.claimId ? claimants.get(photo.claimId) : undefined }));
  },
 };
}
export const mongoLookupServices = createMongoLookupServices();

export function findReferenceMatches(hashes: { sha256: string; dhash: string }, references: readonly ReferencePhoto[], options: { claimId?: string; referenceFilename?: string } = {}) {
  const referenceMatches: ReferenceMatch[] = [];
  for (const photo of references) {
    if (options.claimId && photo.claimId === options.claimId) continue;
    if (options.referenceFilename === photo.filename && photo.sha256 === hashes.sha256) continue;
    if (!/^[a-f\d]{16}$/i.test(photo.dhash) || !/^[a-f\d]{64}$/i.test(photo.sha256)) continue;
    const exact = hashes.sha256 === photo.sha256;
    const distance = exact ? 0 : hammingDistanceHex(hashes.dhash, photo.dhash);
    if (!exact && distance > guardrailConfig.DHASH_MAX_DISTANCE) continue;
    referenceMatches.push({ matchType: exact ? "exact" : "near", distance,
      matchedFilename: photo.filename, matchedClaimId: photo.claimId, matchedClaimDate: photo.claimDate });
  }
  referenceMatches.sort((a, b) => (a.matchType === "exact" ? 0 : 1) - (b.matchType === "exact" ? 0 : 1) || a.distance - b.distance || a.matchedFilename.localeCompare(b.matchedFilename));
  const crossClaimMatches: CrossClaimMatch[] = referenceMatches.flatMap((match) =>
    match.matchedClaimId && match.matchedClaimDate ? [{ ...match, matchedClaimId: match.matchedClaimId, matchedClaimDate: match.matchedClaimDate }] : []);
  return { referenceMatches, crossClaimMatches };
}

export interface LookupReport {
  filename: string; sha256: string; dhash: string;
  vision: VisionResult | null; webCheck: WebCheck; checkedAt: string | null;
  visionError: string | null; warnings: string[];
  unavailableReason: LookupUnavailableReason | null;
  matchedClaimants: Record<string, string>;
  referenceMatches: ReferenceMatch[]; crossClaimMatches: CrossClaimMatch[];
  referenceCoverage: { total: number; unmapped: number; available: boolean };
}

/** Shared CLI / Phase 4 API entry point. No mapping file or seed step is required for Web Detection. */
export async function lookupPhoto(buffer: Buffer, options: { filename: string; claimId?: string; referenceFilename?: string; forceLive?: boolean; deadlineMs?: number; onLiveAttempt?: () => void }, services: LookupServices = mongoLookupServices): Promise<LookupReport> {
  const hashes = await fingerprintPhoto(buffer);
  const now = services.now();
  const warnings: string[] = [];
  let vision: VisionResult | null = null, source: "cache" | "live" = "live", checkedAt: string | null = null, visionError: string | null = null;
  const cached = await services.readCache(hashes.sha256);
  let unavailableReason: LookupUnavailableReason | null = null;
  const validated = usableCachedVision(cached, now);
  if (!options.forceLive && cached && validated) {
    vision = validated; source = "cache"; checkedAt = cached.checkedAt.toISOString();
  } else {
    try {
      let raw: unknown;
      // Reserve time for cache, comparison and photo persistence under the API's 10s cap.
      const timeoutMs = options.deadlineMs === undefined ? undefined : options.deadlineMs - Date.now() - 1_500;
      if (timeoutMs !== undefined && timeoutMs <= 0) throw new VisionError("timeout", "No time remains for a live lookup in this request.");
      // After this boundary a request replay could spend quota, even if persistence fails.
      options.onLiveAttempt?.();
      vision = await services.detect(buffer, (payload) => { raw = payload; }, timeoutMs);
      const finished = services.now(); checkedAt = finished.toISOString();
      try {
        await services.saveCache({ sha256: hashes.sha256, createdAt: finished, checkedAt: finished,
          expiresAt: new Date(finished.getTime() + USER_DATA_RETENTION_MS), result: vision, ...(raw === undefined ? {} : { raw }),
          stockDomainAllowlist: [...guardrailConfig.STOCK_DOMAIN_ALLOWLIST] });
      } catch { warnings.push("Live Vision result received, but cache storage failed; the next lookup may require another API call."); }
    } catch (error) {
      if (isMongoFailure(error)) throw error;
      visionError = safeError(error);
      unavailableReason = error instanceof VisionError && error.code === "quota" ? "daily_limit" :
        error instanceof VisionError && error.code === "timeout" ? "vision_timeout" : "vision_error";
    }
  }
  let references: ReferencePhoto[] = [], referenceAvailable = true;
  try { references = await services.references(); }
  catch { referenceAvailable = false; warnings.push("Reference comparison failed. Do not make a claim decision from these incomplete checks."); }
  if (!references.length) warnings.push("No reference photos were available for comparison; run seed before using cross-claim results.");
  if (references.some((photo) => !photo.claimId || !photo.claimDate)) warnings.push("Some reference photos are unmapped. Cross-claim results are incomplete until mapping and re-seeding are complete.");
  return { filename: options.filename, ...hashes, vision, webCheck: toWebCheck(vision, source), checkedAt, visionError, warnings, unavailableReason,
    matchedClaimants: Object.fromEntries(references.flatMap((photo) => photo.claimId && photo.claimant ? [[photo.claimId, photo.claimant]] : [])),
    ...findReferenceMatches(hashes, references, options),
    referenceCoverage: { total: references.length, unmapped: references.filter((photo) => !photo.claimId || !photo.claimDate).length, available: referenceAvailable && references.length > 0 } };
}
