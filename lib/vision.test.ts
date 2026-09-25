import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoOperationTimeoutError } from "mongodb";
import { detectWeb, extractVisionResult, isStockDomain, toWebCheck, VISION_ENDPOINT, VISION_TIMEOUT_MS } from "./vision";
import { MockImageAnnotatorClient } from "../tests/helpers/vision-sdk-mock";
vi.mock("@google-cloud/vision", async () => ({ v1: { ImageAnnotatorClient: (await import("../tests/helpers/vision-sdk-mock")).MockImageAnnotatorClient } }));

// Synthetic API fixtures, never represented as a real photo lookup.
const emptyResponse = () => ({ responses: [{ webDetection: {} }] });
const fixture = () => ({ responses: [{ webDetection: {
  fullMatchingImages: [
    { url: "https://images.pexels.com/one.jpg" },
    { url: "https://www.pixabay.com/two.jpg" },
    { url: "https://auction.example/three.jpg" },
    { url: "https://pexels.com.evil.example/four.jpg" },
  ],
  partialMatchingImages: [{ url: "https://partial.example/crop.jpg" }],
  visuallySimilarImages: [{ url: "https://similar.example/a.jpg" }, { url: "https://similar.example/b.jpg" }],
  pagesWithMatchingImages: Array.from({ length: 12 }, (_, index) => ({ url: `https://page${index}.example/post` })),
  webEntities: Array.from({ length: 7 }, (_, index) => ({ entityId: `/m/${index}`, description: `Synthetic entity ${index}`, score: index / 2 })),
  bestGuessLabels: [{ label: "synthetic vehicle" }],
} }] });

beforeEach(() => { vi.stubEnv("GOOGLE_VISION_API_KEY", "unit-test-key"); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.useRealTimers());

describe("Vision extraction through mocked HTTP", () => {
  it("sends base64-only Web Detection and extracts the requested fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture()));
    vi.stubGlobal("fetch", fetchMock);
    const result = await detectWeb(Buffer.from("synthetic image bytes"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(VISION_ENDPOINT);
    expect(url).not.toContain("unit-test-key");
    expect(MockImageAnnotatorClient.lastOptions).toEqual({ apiKey: "unit-test-key", fallback: true });
    expect(MockImageAnnotatorClient.lastCallOptions.retry).toBeNull();
    expect(MockImageAnnotatorClient.lastCallOptions.timeout).toBeLessThanOrEqual(8_000);
    expect(JSON.parse(options?.body as string)).toEqual({ requests: [{
      image: { content: Buffer.from("synthetic image bytes").toString("base64") },
      features: [{ type: "WEB_DETECTION", maxResults: 50 }],
    }] });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ fullMatchCount: 4, partialMatchCount: 1, similarCount: 2, pageCount: 12, stockDomainMatchCount: 2, nonStockFullMatchCount: 2, bestGuessLabels: ["synthetic vehicle"] });
    expect(result.pages).toHaveLength(10);
    expect(result.pages[0]).toEqual({ url: "https://page0.example/post", domain: "page0.example" });
    expect(result.domains).toContain("page11.example");
    expect(result.domains.filter((domain) => domain === "similar.example")).toHaveLength(1);
    expect(result.domains[0]).toBe("auction.example");
    expect(result.topWebEntities).toHaveLength(5);
    expect(result.topWebEntities[0]).toEqual({ entityId: "/m/6", description: "Synthetic entity 6", score: 3 });
  });
  it("allows an explicitly empty completed result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(emptyResponse())));
    expect(await detectWeb(Buffer.from("fixture"))).toEqual({ fullMatchCount: 0, partialMatchCount: 0, similarCount: 0, pageCount: 0, pages: [], domains: [], stockDomainMatchCount: 0, nonStockFullMatchCount: 0, topWebEntities: [], bestGuessLabels: [] });
  });
  it("does not turn partial-match pages into non-stock full matches", () => {
    const result = extractVisionResult({ responses: [{ webDetection: { pagesWithMatchingImages: [{ url: "https://example.com/post", partialMatchingImages: [{ url: "https://example.com/crop" }] }] } }] });
    expect(result.pageCount).toBe(1);
    expect(result.nonStockFullMatchCount).toBe(0);
  });
  it("reads the allowlist with proper DNS boundaries", () => {
    expect(isStockDomain("images.pexels.com")).toBe(true);
    expect(isStockDomain("UNSPLASH.COM.")).toBe(true);
    expect(isStockDomain("fakepexels.com")).toBe(false);
    expect(isStockDomain("pexels.com.attacker.example")).toBe(false);
    expect(isStockDomain("images.example.com", ["example.com"])).toBe(true);
  });
  it("keeps unknown entity fields null rather than inventing values", () => {
    expect(extractVisionResult({ responses: [{ webDetection: { webEntities: [{}] } }] }).topWebEntities).toEqual([{ entityId: null, description: null, score: null }]);
  });
  it.each([
    {}, { responses: [] }, { responses: [{ webDetection: { fullMatchingImages: "invalid" } }] },
  ])("rejects missing or malformed evidence instead of creating a clean result: %j", (response) => {
    expect(() => extractVisionResult(response)).toThrow();
  });
  it("rejects per-image API errors even when HTTP status is 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ responses: [{ error: { code: 8, message: "quota" } }] })));
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "annotation", status: 8, message: "Vision annotation error 8: quota" });
  });
  it("rejects invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "network" });
  });
  it.each([{}, { webDetection: {} }, { webDetection: null, error: null }])("accepts successful minimal annotations: %j", (annotation) => {
    expect(extractVisionResult({ responses: [annotation] })).toMatchObject({ fullMatchCount: 0, similarCount: 0, pageCount: 0 });
  });
  it("regression: opaque x-raw-image URL does not reject the IMG-026-shaped successful result", () => {
    // Synthetic fixture mirrors the actual response shape, not invented lookup evidence.
    const raw = { responses: [{ error: null, webDetection: {
      visuallySimilarImages: [{ url: "https://example.test/photo.jpg" }, { url: "x-raw-image:///fixture" }],
      pagesWithMatchingImages: [{ url: "javascript:alert(1)" }, { url: "https://example.test/page" }],
    } }] };
    expect(extractVisionResult(raw)).toMatchObject({ similarCount: 2, pageCount: 2, domains: ["example.test"], pages: [{ url: "https://example.test/page", domain: "example.test" }] });
  });
  it("checks per-image errors before malformed web fields and logs the real code/message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ responses: [{ error: { code: 3, message: "Invalid image fixture" }, webDetection: "bad" }] })));
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toThrow("Invalid image fixture");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("Invalid image fixture");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("annotation");
  });
});

describe("Vision failures and deadlines", () => {
  it("includes SDK cold initialization in the deadline and sends nothing after it expires", async () => {
    vi.useFakeTimers();
    vi.spyOn(MockImageAnnotatorClient.prototype, "initialize").mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 9_000)));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const pending = expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8_000); await pending;
    await vi.advanceTimersByTimeAsync(1_000); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("redacts the configured key in both server logging and returned annotation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ responses: [{ error: { code: 3, message: "Problem with unit-test-key" } }] })));
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toThrow("Problem with [redacted]");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("unit-test-key");
  });
  it("reserves quota per attempt, including retries", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(Response.json(emptyResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const beforeAttempt = vi.fn().mockResolvedValue(true);
    await detectWeb(Buffer.from("fixture"), { beforeAttempt });
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
  });
  it("does not send a retry if the daily budget is exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const beforeAttempt = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(detectWeb(Buffer.from("fixture"), { beforeAttempt })).rejects.toMatchObject({ code: "quota" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("surfaces a database quota-counter timeout as a database failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const failure = new MongoOperationTimeoutError("synthetic counter timeout");
    await expect(detectWeb(Buffer.from("fixture"), { beforeAttempt: async () => { throw failure; } })).rejects.toBe(failure);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("vision_quota_reservation");
  });
  it("retries a 5xx exactly once", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(Response.json(emptyResponse()));
    vi.stubGlobal("fetch", fetchMock);
    await detectWeb(Buffer.from("fixture"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("stops after the second 5xx", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("error", { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "http", status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 429])("does not retry HTTP %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("error", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "http", status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not retry network errors or leak upstream error content", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("secret network details"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(detectWeb(Buffer.from("fixture"))).rejects.toThrow("could not reach the service");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts at eight seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("supports a shorter API budget without extending the maximum eight-second timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const assertion = expect(detectWeb(Buffer.from("fixture"), { timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(500); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares the eight-second deadline with its retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(new Response("error", { status: 503 })), 6_000)))
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(detectWeb(Buffer.from("fixture"))).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects an empty input without sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(detectWeb(Buffer.alloc(0))).rejects.toThrow("non-empty image bytes");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("adapts successful and unavailable lookups to the unchanged guardrail contract", () => {
    expect(toWebCheck(null)).toMatchObject({ status: "unavailable", source: null });
    expect(toWebCheck(extractVisionResult(emptyResponse()), "cache")).toMatchObject({ status: "ok", source: "cache", fullMatchCount: 0 });
  });
});
