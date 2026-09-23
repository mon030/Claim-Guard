import { randomInt } from "node:crypto";
import { z } from "zod";
import { getCollections } from "../../../lib/mongodb";
import { retentionFor, type ClaimRecord } from "../../../lib/models";
import { ApiError, apiErrorResponse, jsonResponse, readJson } from "../../../lib/api/http";
import { requireDemoAccess } from "../../../lib/api/security";
import type { ClaimOption } from "../../../lib/api/claim-contracts";
export const runtime = "nodejs";
export const maxDuration = 10;
const schema = z.strictObject({
  clientRequestId: z.uuid(), claimId: z.string().trim().max(80).regex(/^[\p{L}\p{N}_-]*$/u).optional(),
  claimant: z.string().trim().min(1).max(200), narrative: z.string().trim().min(1).max(10_000),
  date: z.iso.date(), amount: z.number().finite().nonnegative().max(1_000_000_000),
  location: z.string().trim().max(200).default(""), category: z.string().trim().max(100).default(""),
  customerEmail: z.union([z.email(), z.literal("")]).default(""),
});
function existingDraft(existing: ClaimRecord, input: z.infer<typeof schema>) {
  if (existing.origin !== "user" || existing.expiresAt <= new Date()) throw new ApiError(409, "claim_expired", "This draft expired. Start a new claim.");
  const same = ["claimant", "narrative", "date", "amount", "location", "category", "customerEmail"] as const;
  if (same.some((key) => existing[key] !== input[key]) || (input.claimId && input.claimId !== existing.claimId)) throw new ApiError(409, "draft_changed", "This request belongs to a different draft. Start a new claim.");
  return jsonResponse({ claimId: existing.claimId });
}
export async function GET(request: Request) {
  try {
    requireDemoAccess(request);
    const { claims, photos } = await getCollections();
    const [rows, images] = await Promise.all([
      claims.find({ origin: "seed" }, { projection: { emailBody: 0, emailSubject: 0 }, timeoutMS: 1_000 }).toArray(),
      photos.find({ origin: "seed" }, { projection: { filename: 1, claimId: 1 }, timeoutMS: 1_000 }).toArray(),
    ]);
    const result: ClaimOption[] = rows.map((claim) => {
      const mapped = (claim.mappedPhotos ?? []).flatMap((filename) => {
        const photo = images.find((image) => image.filename === filename && image.claimId === claim.claimId);
        return photo ? [{ photoId: photo._id.toHexString(), filename }] : [];
      });
      return { claimId: claim.claimId, claimant: claim.claimant, date: claim.date, amount: claim.amount,
        location: claim.location, category: claim.category, narrative: claim.narrative, customerEmail: claim.customerEmail,
        photos: mapped, unavailableReason: mapped.length === 2 ? null : "The team has not mapped and seeded both photos for this claim." };
    }).sort((a, b) => a.claimId.localeCompare(b.claimId));
    return jsonResponse({ claims: result });
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireDemoAccess(request);
    const input = schema.parse(await readJson(request, 65_536));
    const { claims } = await getCollections();
    const existing = await claims.findOne({ origin: "user", clientRequestId: input.clientRequestId }, { timeoutMS: 1_000 });
    if (existing) return existingDraft(existing, input);
    for (let attempt = 0; attempt < 5; attempt++) {
      const claimId = input.claimId || `MI-DEMO-${String(randomInt(10_000)).padStart(4, "0")}`;
      try {
        await claims.insertOne({ ...input, claimId, ...retentionFor("user"), emailBody: "", emailSubject: "", mappedPhotos: null }, { timeoutMS: 1_000 });
        return jsonResponse({ claimId }, 201);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
        const raced = await claims.findOne({ origin: "user", clientRequestId: input.clientRequestId }, { timeoutMS: 1_000 });
        if (raced) return existingDraft(raced, input);
        if (input.claimId) throw new ApiError(409, "claim_id_exists", "That Claim ID already exists. Choose another or leave it blank.");
      }
    }
    throw new ApiError(503, "id_unavailable", "Could not allocate a demo Claim ID. Please retry.");
  } catch (error) { return apiErrorResponse(error); }
}
