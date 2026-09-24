import { z } from "zod";
import { getCollections } from "../../../lib/mongodb";
import { getLlmEnv } from "../../../lib/env";
import { reserveDailyUsage } from "../../../lib/usage";
import { deterministicExplanation, writeAdjusterExplanation } from "../../../lib/llm/prompts";
import { activeRecords, ApiError, apiErrorResponse, jsonResponse, objectIdSchema, photoObjectId, readJson } from "../../../lib/api/http";
import { requireDemoAccess } from "../../../lib/api/security";
import { withMongoRetry } from "../../../lib/mongo-retry";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function POST(request: Request) {
  try {
    requireDemoAccess(request);
    const { decisionId } = z.strictObject({ decisionId: objectIdSchema }).parse(await readJson(request));
    const { decisions } = await withMongoRetry(getCollections);
    const record = await withMongoRetry(() => decisions.findOne({ _id: photoObjectId(decisionId), ...activeRecords() }, { timeoutMS: 1_000 }));
    if (!record) throw new ApiError(404, "decision_not_found", "Decision not found or expired.");
    if (!getLlmEnv() || !await reserveDailyUsage("llm")) return jsonResponse({ explanation: deterministicExplanation(record.result), source: "deterministic" });
    const result = await writeAdjusterExplanation(record.result);
    return jsonResponse(result);
  } catch (error) { return apiErrorResponse(error); }
}
