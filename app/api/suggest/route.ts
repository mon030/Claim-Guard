import { z } from "zod";
import { extractClaimIdentity, extractClaimIdentityDeterministically } from "../../../lib/llm/prompts";
import { getLlmEnv } from "../../../lib/env";
import { reserveDailyUsage } from "../../../lib/usage";
import { apiErrorResponse, jsonResponse, readJson } from "../../../lib/api/http";
import { requireDemoAccess } from "../../../lib/api/security";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function POST(request: Request) {
  try {
    requireDemoAccess(request);
    const { text } = z.strictObject({ text: z.string().trim().min(1).max(10_000) }).parse(await readJson(request, 65_536));
    if (!getLlmEnv() || !await reserveDailyUsage("llm")) return jsonResponse({ ...extractClaimIdentityDeterministically(text), source: "deterministic" });
    return jsonResponse(await extractClaimIdentity(text));
  } catch (error) { return apiErrorResponse(error); }
}
