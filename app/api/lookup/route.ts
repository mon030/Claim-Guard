import { Binary, ObjectId } from "mongodb";
import type { PhotoEvidence } from "../../../lib/guardrail";
import { guardrailConfig } from "../../../lib/guardrail.config";
import { lookupPhoto } from "../../../lib/lookup";
import { getCollections } from "../../../lib/mongodb";
import { retentionFor, type StoredPhotoLookup } from "../../../lib/models";
import { thumbnail } from "../../../lib/photos";
import { activeRecords, ApiError, apiErrorResponse, jsonResponse, photoObjectId } from "../../../lib/api/http";
import { limitLookupByIp, requireDemoAccess } from "../../../lib/api/security";
import { readLookupInput, validateImage } from "../../../lib/api/upload";
import type { LookupResponse } from "../../../lib/api/contracts";
import { isStockDomain } from "../../../lib/vision";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  const deadlineMs = Date.now() + 9_500;
  let stage: "load" | "lookup" | "save" = "load";
  let liveAttempted = false;
  try {
    requireDemoAccess(request);
    limitLookupByIp(request);
    const input = await readLookupInput(request);
    const { photos, claims } = await getCollections();
    const now = new Date();
    const seed = input.kind === "seed" ? await photos.findOne({ _id: photoObjectId(input.photoId), origin: "seed" }, { timeoutMS: 1_000 }) : null;
    if (input.kind === "seed" && (!seed || !seed.content)) throw new ApiError(404, "photo_not_found", "Seeded photo not found.");
    const claimId = input.kind === "upload" ? input.claimId : seed!.claimId;
    if (input.kind === "upload" && !await claims.findOne({ claimId: input.claimId, ...activeRecords(now) }, { projection: { _id: 1 }, timeoutMS: 1_000 })) throw new ApiError(404, "claim_not_found", "Create or select an existing, unexpired claim before uploading.");
    const bytes = input.kind === "upload" ? input.bytes : Buffer.from(seed!.content!.value());
    const contentType = await validateImage(bytes);
    // Finish full decoding before a paid lookup; headers alone cannot prove valid image data.
    let preview: Buffer;
    try { preview = await thumbnail(bytes, { width: 320, height: 320 }); }
    catch { throw new ApiError(415, "invalid_image", "The image could not be decoded. Please choose another JPEG, PNG, or WebP."); }
    const filename = input.kind === "upload" ? input.filename : seed!.filename;
    stage = "lookup";
    const report = await lookupPhoto(bytes, { filename, claimId: claimId ?? undefined,
      referenceFilename: seed?.filename, forceLive: input.forceLive, deadlineMs,
      onLiveAttempt: () => { liveAttempted = true; } });
    const evidence: PhotoEvidence = { filename, sha256: report.sha256, dhash: report.dhash,
      crossClaimMatches: report.crossClaimMatches, webCheck: report.webCheck };
    const lookup: StoredPhotoLookup = { sha256: report.sha256, attemptedAt: new Date(),
      checkedAt: report.checkedAt ? new Date(report.checkedAt) : null, source: report.webCheck.source,
      reason: report.unavailableReason, result: report.vision, stockDomainAllowlist: [...guardrailConfig.STOCK_DOMAIN_ALLOWLIST] };
    let photoId: ObjectId;
    stage = "save";
    if (input.kind === "seed") {
      photoId = seed!._id;
      const updated = await photos.updateOne({ _id: photoId, origin: "seed", sha256: report.sha256 }, { $set: { lookup } }, { timeoutMS: 1_000 });
      if (!updated.matchedCount) throw new ApiError(409, "photo_changed", "Seed photo changed during lookup. Re-seed or reload before trying again.");
    } else {
      const filter = { origin: "user" as const, claimId: input.claimId, slot: input.slot };
      const update = { $set: { ...retentionFor("user", now), filename, claimId: input.claimId, slot: input.slot,
        sha256: report.sha256, dhash: report.dhash, contentType, byteLength: bytes.length, resized: input.resized,
        thumbnail: new Binary(preview), thumbnailContentType: "image/jpeg" as const, lookup }, $unset: { content: "" as const } };
      // The partial unique claim/slot index makes concurrent uploads idempotent.
      let saved;
      try { saved = await photos.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after", includeResultMetadata: false, timeoutMS: 1_000 }); }
      catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
        saved = await photos.findOneAndUpdate(filter, update, { returnDocument: "after", includeResultMetadata: false, timeoutMS: 1_000 });
      }
      if (!saved) throw new ApiError(503, "photo_not_saved", "Could not save the photo evidence. Please try again.");
      photoId = saved._id;
    }
    const response: LookupResponse = { photoId: photoId.toHexString(), evidence,
      lookup: { status: report.webCheck.status, source: report.webCheck.source, fetchedAt: report.checkedAt,
        reason: report.unavailableReason, message: report.visionError, warnings: report.warnings, referenceCoverage: report.referenceCoverage,
        stockDomains: report.webCheck.domains.filter((domain) => isStockDomain(domain)) },
      matches: report.crossClaimMatches.map((match) => ({ filename: match.matchedFilename, claimId: match.matchedClaimId,
        claimant: report.matchedClaimants[match.matchedClaimId] ?? null, date: match.matchedClaimDate,
        matchType: match.matchType, distance: match.distance })) };
    return jsonResponse(response);
  } catch (error) { return apiErrorResponse(error, { operation: "lookup", stage, retrySafe: !liveAttempted }); }
}
