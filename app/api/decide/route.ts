import { ObjectId } from "mongodb";
import { z } from "zod";
import { decide, type ClaimEvidence, type OtherClaimSummary } from "../../../lib/guardrail";
import { getCollections } from "../../../lib/mongodb";
import { retentionFor, type AuditLogRecord } from "../../../lib/models";
import { mongoLookupServices } from "../../../lib/lookup";
import { narrativeSimilarity } from "../../../lib/narrative-similarity";
import { buildPrefillUrl, summarizePhotoLookups } from "../../../lib/google-form";
import { notifyEscalation } from "../../../lib/escalation";
import { evidenceFromStoredPhoto } from "../../../lib/api/stored-evidence";
import { activeRecords, ApiError, apiErrorResponse, claimIdSchema, jsonResponse, objectIdSchema, photoObjectId, readJson } from "../../../lib/api/http";
import { requireDemoAccess } from "../../../lib/api/security";
import type { DecideResponse, TimelineEntry } from "../../../lib/api/contracts";

export const runtime = "nodejs";
export const maxDuration = 10;
const inputSchema = z.strictObject({ claimId: claimIdSchema,
  photoIds: z.array(objectIdSchema).max(6).refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length) });

export async function POST(request: Request): Promise<Response> {
  try {
    requireDemoAccess(request);
    const input = inputSchema.parse(await readJson(request));
    const collections = await getCollections();
    const now = new Date();
    const photoIds = input.photoIds.map(photoObjectId);
    const [claim, storedPhotos, otherClaims, references] = await Promise.all([
      collections.claims.findOne({ claimId: input.claimId, ...activeRecords(now) }, { timeoutMS: 1_000 }),
      collections.photos.find({ _id: { $in: photoIds }, ...activeRecords(now) }, { projection: { content: 0, thumbnail: 0 }, timeoutMS: 1_000 }).toArray(),
      collections.claims.find({ claimId: { $ne: input.claimId }, ...activeRecords(now) }, {
        projection: { claimId: 1, claimant: 1, date: 1, amount: 1, narrative: 1 }, timeoutMS: 1_000,
      }).toArray(),
      mongoLookupServices.references(),
    ]);
    if (!claim) throw new ApiError(404, "claim_not_found", "Claim not found or expired.");
    if (claim.origin === "seed" && photoIds.length > 2) throw new ApiError(400, "seed_photo_count", "Reference claims use exactly two mapped photos.");
    if (storedPhotos.length !== photoIds.length) throw new ApiError(404, "photo_not_found", "One or more photos are missing or expired. Look them up again.");
    if (storedPhotos.some((photo) => photo.claimId !== claim.claimId)) throw new ApiError(409, "photo_claim_mismatch", "Every photo must belong to the selected claim.");
    // Seed claims must use the team's manual mapping, never a substituted upload or guessed pair.
    if (storedPhotos.length && claim.origin === "seed" && (!claim.mappedPhotos || storedPhotos.some((photo) => photo.origin !== "seed" || !claim.mappedPhotos!.includes(photo.filename)))) throw new ApiError(409, "mapping_required", "Complete the team's manual mapping and re-seed before deciding this reference claim.");
    if (claim.origin === "user" && storedPhotos.some((photo) => photo.origin !== "user" || ![1, 2, 3, 4, 5, 6].includes(photo.slot ?? 0))) throw new ApiError(409, "invalid_slots", "User claim photos must occupy slots 1 through 6.");
    if (claim.origin === "user" && new Set(storedPhotos.map((photo) => photo.slot)).size !== storedPhotos.length) throw new ApiError(409, "invalid_slots", "Choose one photo per slot.");
    if (storedPhotos.length >= 2 && (!references.length || references.some((photo) => !photo.claimId || !photo.claimDate || !/^[a-f\d]{64}$/i.test(photo.sha256) || !/^[a-f\d]{16}$/i.test(photo.dhash)))) throw new ApiError(409, "references_incomplete", "Reference comparisons are incomplete. Finish manual mapping and re-seed before deciding.");
    const orderedPhotos = [...storedPhotos].sort((a, b) => claim.origin === "seed"
      ? claim.mappedPhotos!.indexOf(a.filename) - claim.mappedPhotos!.indexOf(b.filename)
      : (a.slot ?? 0) - (b.slot ?? 0));
    const photos = await Promise.all(orderedPhotos.map(async (photo) => {
      const cached = await collections.vision_cache.findOne({ sha256: photo.sha256 }, { timeoutMS: 1_000 });
      return evidenceFromStoredPhoto(photo, cached, references, claim.claimId, now);
    }));
    const evidence: ClaimEvidence = { claimId: claim.claimId, claimant: claim.claimant, customerEmail: claim.customerEmail,
      date: claim.date, amount: claim.amount, narrative: claim.narrative, photos };
    // Deterministic Phase 2 fallback keeps the route bounded and works with zero LLM configuration.
    const summaries: OtherClaimSummary[] = otherClaims.map((other) => ({ claimId: other.claimId, claimant: other.claimant,
      date: other.date, amount: other.amount, narrativeSimilarity: narrativeSimilarity(claim.narrative, other.narrative) }));
    const result = decide(evidence, summaries);
    const lookupSummary = summarizePhotoLookups(photos);
    const prefillUrl = result.decision === "Blocked" ? null : buildPrefillUrl({ claimId: claim.claimId, claimant: claim.claimant,
      lookup: lookupSummary, decision: result.decision });
    const decisionId = new ObjectId();
    const retention = retentionFor(claim.origin, now);
    const timeline: (AuditLogRecord & TimelineEntry)[] = [];
    function activity(event: AuditLogRecord["event"], message: string, status: NonNullable<AuditLogRecord["status"]> = "completed", photoId?: ObjectId) {
      timeline.push({ ...retention, claimId: claim!.claimId, event, message, status, sequence: timeline.length + 1,
        ruleVersion: result.ruleVersion, ruleHits: event === "decision" ? result.ruleHits : [],
        outcome: status === "unavailable" ? "unavailable" : result.decision === "Blocked" ? "blocked" : "ok",
        relatedId: decisionId, ...(photoId ? { photoId } : {}) });
    }
    activity("claim_loaded", "Claim loaded from server records.");
    photos.forEach((photo, index) => activity("photo_lookup", `Photo ${index + 1} looked up: ${photo.filename}; ${photo.webCheck.status === "ok" ? photo.webCheck.source : "web check unavailable"}.`,
      photo.webCheck.status === "ok" ? "completed" : "unavailable", orderedPhotos[index]._id));
    activity("decision", `Guardrail applied: ${result.decision}; ruleHits: ${result.ruleHits.join(", ") || "none"}.`);
    if (prefillUrl) {
      activity("form_prefill", "Pre-fill link generated without an email field.");
      activity("form_human_submission", "Waiting for a human to sign in and click Submit.", "pending");
    }
    await collections.decisions.insertOne({ _id: decisionId, ...retention, claimId: claim.claimId,
      photoIds: orderedPhotos.map((photo) => photo._id), evidence, result,
      explanation: [...result.reasons, ...result.notes].join(" ") || "No escalation rule was triggered by the recorded evidence.",
      explanationSource: "deterministic" }, { timeoutMS: 1_000 });
    await collections.audit_log.insertMany(timeline, { ordered: true, timeoutMS: 1_000 });
    // Persist the core decision/timeline before a best-effort external notification.
    const escalation = await notifyEscalation(evidence, result);
    if (escalation === "sent" || escalation === "failed") {
      activity("escalation", escalation === "sent" ? "Escalation notification sent." : "Escalation notification failed; human review remains available.", escalation === "failed" ? "unavailable" : "completed");
      try { await collections.audit_log.insertOne(timeline[timeline.length - 1], { timeoutMS: 1_000 }); }
      catch { console.warn("Could not persist the escalation notification status; the core decision timeline was already saved."); }
    }
    const response: DecideResponse = { ...result, decisionId: decisionId.toHexString(), prefillUrl, lookupSummary,
      narrativeSimilaritySource: "deterministic", escalation,
      timeline: timeline.map(({ sequence, event, message, status, ruleHits }) => ({ sequence, event, message, status, ruleHits })) };
    return jsonResponse(response);
  } catch (error) { return apiErrorResponse(error); }
}
