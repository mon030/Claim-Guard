import { createHash, timingSafeEqual } from "node:crypto";
import { getOptionalEnv } from "../env";
import { ApiError } from "./http";

export const DEMO_HEADER = "x-demo-access-code";
export const LOOKUP_RATE_LIMIT = 12;
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, { count: number; expiresAt: number }>();

export function requireDemoAccess(request: Request): void {
  const { DEMO_ACCESS_CODE } = getOptionalEnv();
  if (!DEMO_ACCESS_CODE) return;
  const supplied = request.headers.get(DEMO_HEADER) ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(supplied), hash(DEMO_ACCESS_CODE))) throw new ApiError(401, "demo_access_required", `A valid ${DEMO_HEADER} header is required.`);
}

/** Best effort per warm process, not a global/authenticated abuse-prevention service. */
export function limitLookupByIp(request: Request, now = Date.now()): void {
  const forwarded = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") : request.headers.get("x-forwarded-for");
  const ip = (forwarded?.split(",")[0].trim() || "unknown").slice(0, 128);
  // Store a hash, not the visitor's address; never persist it in MongoDB or logs.
  const key = createHash("sha256").update(ip).digest("hex");
  for (const [id, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(id);
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) throw new ApiError(429, "rate_limit", "Too many lookup requests. Please wait a minute.", { "Retry-After": "60" });
    bucket = { count: 0, expiresAt: now + WINDOW_MS }; buckets.set(key, bucket);
  }
  if (bucket.count >= LOOKUP_RATE_LIMIT) throw new ApiError(429, "rate_limit", "Too many lookup requests. Please wait before trying again.", { "Retry-After": String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))) });
  bucket.count++;
}
