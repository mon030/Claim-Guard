import { z } from "zod";
import { EnvironmentError, getFormEnv } from "./env";
import type { PhotoEvidence } from "./guardrail";

export const LOOKUP_SUMMARY_LIMIT = 300;
export function singleLineSummary(value: string, limit = LOOKUP_SUMMARY_LIMIT): string {
  const line = value.replace(/[\s\p{C}]+/gu, " ").trim();
  if (line.length <= limit) return line;
  // Avoid leaving a broken Unicode surrogate at the truncation boundary.
  return line.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd() + "…";
}
/** Photo findings only: no narrative, claimant email, LLM prose, or decision reasons. */
export function summarizePhotoLookups(photos: readonly PhotoEvidence[]): string {
  if (!photos.length) return "No photos checked.";
  const perPhotoLimit = Math.floor((LOOKUP_SUMMARY_LIMIT - (photos.length - 1) * 3) / photos.length);
  return photos.map((photo, index) => {
    const web = photo.webCheck;
    if (photos.length > 2) return singleLineSummary(web.status === "ok"
      ? `P${index + 1}: full ${web.fullMatchCount}, nonstock ${web.nonStockFullMatchCount}, reuse ${photo.crossClaimMatches.length}`
      : `P${index + 1}: web unavailable; reuse ${photo.crossClaimMatches.length}`, perPhotoLimit);
    const name = singleLineSummary(photo.filename, 38);
    const findings = web.status === "ok" ? `full ${web.fullMatchCount}, non-stock ${web.nonStockFullMatchCount}, partial ${web.partialMatchCount}, similar ${web.similarCount}` : "web unavailable";
    return singleLineSummary(`Photo ${index + 1} (${name}): ${findings}; other-claim matches ${photo.crossClaimMatches.length}.`, perPhotoLimit);
  }).join(" | ");
}

const prefillSchema = z.strictObject({
  claimId: z.string().min(1), claimant: z.string().min(1), lookup: z.string().min(1),
  decision: z.enum(["Auto-approve", "Escalate"]),
});
export type PrefillFields = z.infer<typeof prefillSchema>;
/** Pure URL builder: never sends a request or includes a submitter email. */
export function buildPrefillUrl(input: PrefillFields, env = getFormEnv()): string {
  const fields = prefillSchema.parse(input);
  const url = new URL(env.GOOGLE_FORM_URL);
  // Discard pre-existing emailAddress, entries, and other query values.
  url.search = ""; url.hash = "";
  url.searchParams.set("usp", "pp_url");
  const entries = [
    [env.GOOGLE_FORM_ENTRY_CLAIM_ID, fields.claimId], [env.GOOGLE_FORM_ENTRY_CLAIMANT, fields.claimant],
    [env.GOOGLE_FORM_ENTRY_LOOKUP, singleLineSummary(fields.lookup)], [env.GOOGLE_FORM_ENTRY_DECISION, fields.decision],
  ];
  const ids = entries.map(([id]) => id.replace(/^entry\./, ""));
  if (new Set(ids).size !== 4) throw new EnvironmentError([{ code: "custom", path: ["GOOGLE_FORM_ENTRY_*"], message: "must contain four distinct entry IDs" }]);
  for (const [id, value] of entries) url.searchParams.set(`entry.${id.replace(/^entry\./, "")}`, value);
  return url.toString();
}
