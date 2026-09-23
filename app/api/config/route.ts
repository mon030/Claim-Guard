import { getLlmEnv, getOptionalEnv } from "../../../lib/env";
import { apiErrorResponse, jsonResponse } from "../../../lib/api/http";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function GET() {
  try { return jsonResponse({ demoAccessRequired: Boolean(getOptionalEnv().DEMO_ACCESS_CODE), llmConfigured: Boolean(getLlmEnv()) }); }
  catch (error) { return apiErrorResponse(error); }
}
