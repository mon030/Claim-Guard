import { z } from "zod";
import { getVisionEnv } from "./env";
import type { WebCheck } from "./guardrail";
import { guardrailConfig } from "./guardrail.config";

export const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
export const VISION_TIMEOUT_MS = 8_000;

const webUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "Expected an HTTP(S) result URL");
const webImageSchema = z.object({ url: webUrlSchema });
const webPageSchema = z.object({ url: webUrlSchema });
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
    error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
    webDetection: webDetectionSchema.optional(),
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
  if (!parsed.success) throw new VisionError("invalid_response", "Vision returned an invalid annotation response.");
  const annotation = parsed.data.responses[0];
  if (annotation.error && (annotation.error.code || annotation.error.message)) {
    throw new VisionError("annotation", "Vision could not complete Web Detection.", annotation.error.code);
  }
  const web = annotation.webDetection;
  if (!web) throw new VisionError("invalid_response", "Vision response has no Web Detection result.");
  const fullDomains = web.fullMatchingImages.map((match) => domainOf(match.url));
  const stockDomainMatchCount = fullDomains.filter((domain) => isStockDomain(domain, allowlist)).length;
  const pages = web.pagesWithMatchingImages.map(({ url }) => ({ url, domain: domainOf(url) }));
  // Put non-stock full-match hosts first for the unchanged guardrail's explanation.
  const domains = [...new Set([
    ...fullDomains.filter((domain) => !isStockDomain(domain, allowlist)),
    ...fullDomains,
    ...pages.map((page) => page.domain),
    ...web.partialMatchingImages.map((match) => domainOf(match.url)),
    ...web.visuallySimilarImages.map((match) => domainOf(match.url)),
  ])];
  return {
    fullMatchCount: web.fullMatchingImages.length,
    partialMatchCount: web.partialMatchingImages.length,
    similarCount: web.visuallySimilarImages.length,
    pageCount: pages.length,
    pages: pages.slice(0, 10),
    domains,
    stockDomainMatchCount,
    nonStockFullMatchCount: fullDomains.length - stockDomainMatchCount,
    topWebEntities: [...web.webEntities]
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 5)
      .map((entity) => ({ entityId: entity.entityId ?? null, description: entity.description ?? null, score: entity.score ?? null })),
    bestGuessLabels: web.bestGuessLabels.map(({ label }) => label),
  };
}

/** One image, one 8-second overall budget, at most one retry for HTTP 5xx. */
export async function detectWeb(buffer: Buffer, options: { beforeAttempt?: () => Promise<boolean>; onRaw?: (raw: unknown) => void; timeoutMs?: number } = {}): Promise<VisionResult> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError("Vision requires non-empty image bytes.");
  const { GOOGLE_VISION_API_KEY } = getVisionEnv();
  const body = JSON.stringify({
    requests: [{ image: { content: buffer.toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 50 }] }],
  });
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? VISION_TIMEOUT_MS, VISION_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      controller.signal.throwIfAborted();
      if (options.beforeAttempt && !(await options.beforeAttempt())) throw new VisionError("quota", "Daily Vision limit reached; no request was sent for this attempt.");
      controller.signal.throwIfAborted();
      const response = await fetch(VISION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_VISION_API_KEY },
        body,
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (response.status >= 500 && response.status <= 599 && attempt === 0) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new VisionError("http", `Vision request failed (HTTP ${response.status}).`, response.status);
      }
      let payload: unknown;
      try { payload = await response.json(); }
      catch {
        controller.signal.throwIfAborted();
        throw new VisionError("invalid_response", "Vision returned invalid JSON.");
      }
      controller.signal.throwIfAborted();
      const result = extractVisionResult(payload);
      options.onRaw?.(payload);
      return result;
    }
    throw new VisionError("http", "Vision retry exhausted.");
  } catch (error) {
    if (controller.signal.aborted) throw new VisionError("timeout", "Vision Web Detection exceeded its request deadline (at most 8 seconds).");
    if (error instanceof VisionError) throw error;
    // Do not expose request URLs, response bodies, credentials, or image bytes.
    throw new VisionError("network", "Vision Web Detection could not reach the service.");
  } finally {
    clearTimeout(timer);
  }
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
