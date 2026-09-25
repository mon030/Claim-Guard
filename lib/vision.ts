import { z } from "zod";
import { v1 } from "@google-cloud/vision";
import pRetry from "p-retry";
import { getVisionEnv } from "./env";
import type { WebCheck } from "./guardrail";
import { guardrailConfig } from "./guardrail.config";
import { isMongoFailure, mongoFailureDetails } from "./mongo-retry";

export const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
export const VISION_TIMEOUT_MS = 8_000;

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
// Google also returns opaque x-raw-image identifiers. Count them, never link them.
const webImageSchema = z.object({ url: z.string().nullish() });
const webPageSchema = webImageSchema;
const webDetectionSchema = z.object({
  fullMatchingImages: z.array(webImageSchema).default([]),
  partialMatchingImages: z.array(webImageSchema).default([]),
  visuallySimilarImages: z.array(webImageSchema).default([]),
  pagesWithMatchingImages: z.array(webPageSchema).default([]),
  webEntities: z.array(z.object({
    entityId: z.string().optional(), description: z.string().optional(), score: z.number().optional(),
  })).default([]),
  bestGuessLabels: z.array(z.object({ label: z.string() })).default([]),
});
const responseSchema = z.object({
  responses: z.array(z.object({
    error: z.object({ code: z.number().nullish(), message: z.string().nullish() }).nullish(),
    webDetection: z.unknown().optional(),
  })).length(1),
});

export interface VisionResult {
  fullMatchCount: number;
  partialMatchCount: number;
  similarCount: number;
  pageCount: number;
  pages: { url: string; domain: string }[];
  domains: string[];
  stockDomainMatchCount: number;
  nonStockFullMatchCount: number;
  topWebEntities: { entityId: string | null; description: string | null; score: number | null }[];
  bestGuessLabels: string[];
}

export class VisionError extends Error {
  constructor(
    public readonly code: "http" | "annotation" | "invalid_response" | "timeout" | "network" | "quota",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** Match a DNS label boundary, never a substring such as pexels.com.evil.test. */
export function isStockDomain(domain: string, allowlist: readonly string[] = guardrailConfig.STOCK_DOMAIN_ALLOWLIST): boolean {
  const normalized = domain.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

/**
 * Counts are the corresponding top-level Vision result-array lengths.
 * Stock/non-stock counts partition fullMatchingImages by the image URL's host.
 * Pages (which can contain partial matches) do not inflate full-match counts.
 * No response means unavailable; an explicitly empty webDetection is valid.
 */
export function extractVisionResult(
  response: unknown,
  allowlist: readonly string[] = guardrailConfig.STOCK_DOMAIN_ALLOWLIST,
): VisionResult {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new VisionError("invalid_response", `Invalid Vision response: ${parsed.error.message}`);
  const annotation = parsed.data.responses[0];
  if (annotation.error && (annotation.error.code || annotation.error.message)) {
    throw new VisionError("annotation", `Vision annotation error ${annotation.error.code ?? "unknown"}: ${annotation.error.message ?? "No message supplied"}`, annotation.error.code ?? undefined);
  }
  const validated = webDetectionSchema.safeParse(annotation.webDetection ?? {});
  if (!validated.success) throw new VisionError("invalid_response", `Invalid Web Detection fields: ${validated.error.message}`);
  const web = validated.data;
  const urls = (items: { url?: string | null }[]) => items.flatMap(({ url }) => url && isWebUrl(url) ? [url] : []);
  const fullDomains = urls(web.fullMatchingImages).map(domainOf);
  const stockDomainMatchCount = fullDomains.filter((domain) => isStockDomain(domain, allowlist)).length;
  const pages = urls(web.pagesWithMatchingImages).map((url) => ({ url, domain: domainOf(url) }));
  // Put non-stock full-match hosts first for the unchanged guardrail's explanation.
  const domains = [...new Set([
    ...fullDomains.filter((domain) => !isStockDomain(domain, allowlist)),
    ...fullDomains,
    ...pages.map((page) => page.domain),
    ...urls(web.partialMatchingImages).map(domainOf),
    ...urls(web.visuallySimilarImages).map(domainOf),
  ])];
  return {
    fullMatchCount: web.fullMatchingImages.length,
    partialMatchCount: web.partialMatchingImages.length,
    similarCount: web.visuallySimilarImages.length,
    pageCount: web.pagesWithMatchingImages.length,
    pages: pages.slice(0, 10),
    domains,
    stockDomainMatchCount,
    nonStockFullMatchCount: web.fullMatchingImages.length - stockDomainMatchCount,
    topWebEntities: [...web.webEntities]
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 5)
      .map((entity) => ({ entityId: entity.entityId ?? null, description: entity.description ?? null, score: entity.score ?? null })),
    bestGuessLabels: web.bestGuessLabels.map(({ label }) => label),
  };
}

let visionClient: { key: string; client: v1.ImageAnnotatorClient } | undefined;
function getVisionClient(key: string): v1.ImageAnnotatorClient {
  if (!visionClient || visionClient.key !== key) {
    void visionClient?.client.close().catch(() => undefined);
    // REST fallback supports API-key-only authentication; no service account/ADC.
    visionClient = { key, client: new v1.ImageAnnotatorClient({ apiKey: key, fallback: true }) };
  }
  return visionClient.client;
}

/** One image, one 8-second overall budget, at most one retry for HTTP 5xx. */
export async function detectWeb(buffer: Buffer, options: { beforeAttempt?: () => Promise<boolean>; onRaw?: (raw: unknown) => void; timeoutMs?: number } = {}): Promise<VisionResult> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError("Vision requires non-empty image bytes.");
  const { GOOGLE_VISION_API_KEY } = getVisionEnv();
  const body = {
    requests: [{ image: { content: buffer.toString("base64") }, features: [{ type: "WEB_DETECTION" as const, maxResults: 50 }] }],
  };
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? VISION_TIMEOUT_MS, VISION_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  const timeout = new VisionError("timeout", "Vision Web Detection exceeded its request deadline (at most 8 seconds).");
  let rejectDeadline: (error: Error) => void = () => undefined;
  const deadlineExceeded = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => { controller.abort(timeout); rejectDeadline(timeout); }, timeoutMs);
  try {
    return await Promise.race([deadlineExceeded, pRetry(async () => {
      controller.signal.throwIfAborted();
      const client = getVisionClient(GOOGLE_VISION_API_KEY);
      // Include cold SDK initialization in the same wall-clock budget. GAX's
      // transport timeout begins after initialization, so recalculate it below.
      await client.initialize();
      controller.signal.throwIfAborted();
      if (options.beforeAttempt && !(await options.beforeAttempt())) throw new VisionError("quota", "Daily Vision limit reached; no request was sent for this attempt.");
      controller.signal.throwIfAborted();
      // Disable hidden SDK retries so each paid attempt reserves daily quota.
      // The SDK owns transport/timeouts; p-retry restricts retries to actual HTTP 5xx.
      const pending = client.batchAnnotateImages(body, {
        timeout: Math.max(1, deadline - Date.now()), retry: null,
      });
      const [payload] = await pending;
      controller.signal.throwIfAborted();
      options.onRaw?.(payload);
      return extractVisionResult(payload);
    }, { retries: 1, minTimeout: 100, signal: controller.signal,
      shouldRetry: ({ error }) => {
        const status = (error as { httpStatusCode?: number }).httpStatusCode;
        return typeof status === "number" && status >= 500 && status <= 599;
      },
      onFailedAttempt: ({ error, attemptNumber }) => {
        if (isMongoFailure(error)) return;
        logVisionError(error, attemptNumber, GOOGLE_VISION_API_KEY);
      },
    })]);
  } catch (error) {
    if (isMongoFailure(error)) {
      console.error("ClaimGuard MongoDB failure", JSON.stringify({ ...mongoFailureDetails(error), operation: "vision_quota_reservation" }));
      throw error;
    }
    logVisionError(error, undefined, GOOGLE_VISION_API_KEY);
    if (controller.signal.aborted) throw timeout;
    if (error instanceof VisionError) throw new VisionError(error.code, error.message.replaceAll(GOOGLE_VISION_API_KEY, "[redacted]"), error.status);
    const upstream = error as { httpStatusCode?: number; code?: number };
    if (upstream.httpStatusCode) throw new VisionError("http", `Vision request failed (HTTP ${upstream.httpStatusCode}). See the server log for Google's error.`, upstream.httpStatusCode);
    if (upstream.code === 4) throw timeout;
    throw new VisionError("network", "Vision Web Detection could not reach the service.");
  } finally {
    clearTimeout(timer);
  }
}

/** Structured, credential-redacted error detail, never the SDK request/image object. */
function logVisionError(error: unknown, attempt: number | undefined, key: string): void {
  const value = error as { code?: unknown; status?: unknown; httpStatusCode?: unknown; message?: string; name?: string };
  const message = String(value?.message ?? error).replaceAll(key, "[redacted]")
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[redacted MongoDB URI]").slice(0, 4000);
  console.error("ClaimGuard Vision failure", JSON.stringify({ attempt, type: value?.name,
    code: value?.code, status: value?.httpStatusCode ?? value?.status, message }));
}

/** Adapter to the supplied WebCheck contract; null explicitly means unavailable. */
export function toWebCheck(result: VisionResult | null, source: "live" | "cache" = "live"): WebCheck {
  if (!result) return {
    status: "unavailable", source: null, fullMatchCount: 0, partialMatchCount: 0,
    similarCount: 0, nonStockFullMatchCount: 0, domains: [],
  };
  return {
    status: "ok", source, fullMatchCount: result.fullMatchCount,
    partialMatchCount: result.partialMatchCount, similarCount: result.similarCount,
    nonStockFullMatchCount: result.nonStockFullMatchCount, domains: [...result.domains],
  };
}
