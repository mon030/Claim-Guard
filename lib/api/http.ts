import { MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError, ObjectId } from "mongodb";
import { z } from "zod";
import { EnvironmentError } from "../env";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly headers: Record<string, string> = {}) { super(message); }
}
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "must be a 24-character photo ID");
export const claimIdSchema = z.string().trim().min(1).max(100);
export const activeRecords = (now = new Date()) => ({
  $or: [{ origin: "seed" as const }, { origin: "user" as const, expiresAt: { $gt: now } }],
});
export function photoObjectId(value: string): ObjectId {
  const parsed = objectIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_photo_id", "Photo ID must contain 24 hexadecimal characters.");
  return new ObjectId(parsed.data);
}
export function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...headers } });
}
export function apiErrorResponse(error: unknown, context?: { operation: "lookup"; stage: "load" | "lookup" | "save"; retrySafe: boolean }): Response {
  if (error instanceof ApiError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, error.headers);
  if (error instanceof EnvironmentError) return jsonResponse({ error: { code: "configuration_error", message: error.message } }, 503);
  if (error instanceof z.ZodError) return jsonResponse({ error: { code: "invalid_request", message: "Request fields are missing, invalid, repeated, or unsupported." } }, 400);
  const databaseFailure = error instanceof MongoNetworkError || error instanceof MongoOperationTimeoutError || error instanceof MongoServerSelectionError;
  if (databaseFailure) {
    // Fixed labels only: driver messages/topology can contain connection strings.
    const kind = error instanceof MongoServerSelectionError ? "server_selection" : error instanceof MongoOperationTimeoutError ? "operation_timeout" : "network";
    console.error("ClaimGuard database unavailable", { kind, operation: context?.operation ?? "request", stage: context?.stage ?? "unknown" });
    const retryable = context?.retrySafe === true;
    return jsonResponse({ error: { code: "database_unavailable", message: "The database connection was interrupted or timed out. Please try again.", retryable } }, 503,
      retryable ? { "Retry-After": "1" } : {});
  }
  // Do not log raw driver/provider errors: they can contain credentials or personal data.
  console.error("ClaimGuard request failed; no raw request, credential, or provider response was logged.");
  return jsonResponse({ error: { code: "service_unavailable", message: "Unable to complete this request. Please try again." } }, 503);
}

/** Bound the bytes actually read, even without Content-Length or with a dishonest header. */
export async function readBody(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ApiError(413, "body_too_large", "Request body exceeds the single-image size limit.");
  if (!request.body) throw new ApiError(400, "empty_body", "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, "body_too_large", "Request body exceeds the single-image size limit.");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
export async function readJson(request: Request, limit = 16_384): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "content_type", "Send application/json.");
  const bytes = await readBody(request, limit);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new ApiError(400, "invalid_json", "Request body must be valid JSON."); }
}
