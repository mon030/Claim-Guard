import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestStructuredJson, LLM_TIMEOUT_MS } from "./client";
import { extractClaimIdentity, scoreNarrativeSimilarity, writeAdjusterExplanation } from "./prompts";
import { narrativeSimilarity } from "../narrative-similarity";

const request = { purpose: "narrative_similarity" as const, messages: [{ role: "user" as const, content: "Return JSON." }], schema: z.strictObject({ score: z.number().min(0).max(1) }) };
function configure() {
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_API_BASE_URL", "https://provider.example/v1/");
  vi.stubEnv("LLM_MODEL", "test-model");
}
function completion(value: unknown, finish_reason = "stop") {
  return Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });
}
beforeEach(() => {
  vi.stubEnv("LLM_API_KEY", ""); vi.stubEnv("LLM_API_BASE_URL", ""); vi.stubEnv("LLM_MODEL", "");
});
afterEach(() => vi.useRealTimers());

describe("optional provider client", () => {
  it("does not access the network when unconfigured", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await requestStructuredJson(request)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports incomplete configuration instead of silently treating it as absent", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    await expect(requestStructuredJson(request)).rejects.toThrow("LLM_API_BASE_URL");
  });
  it("uses the compatible chat-completions schema and validates JSON", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(completion({ score: 0.7 })); vi.stubGlobal("fetch", fetchMock);
    expect(await requestStructuredJson(request)).toEqual({ score: 0.7 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(options.body)).toEqual({ model: "test-model", messages: request.messages, response_format: { type: "json_object" } });
  });
  it.each([{ score: 2 }, { score: "0.5" }, { score: 0.5, decision: "Auto-approve" }])("rejects invalid structured output %j", async (output) => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(output)));
    expect(await requestStructuredJson(request)).toBeNull();
  });
  it("falls back for truncated output, refusal, malformed JSON, and HTTP failure", async () => {
    configure();
    const responses = [
      completion({ score: 0.7 }, "length"),
      Response.json({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "refused" } }] }),
      Response.json({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }),
      new Response("error", { status: 429 }),
    ];
    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      expect(await requestStructuredJson(request)).toBeNull();
    }
  });
  it("falls back after its deadline", async () => {
    configure(); vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = requestStructuredJson(request);
    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the three permitted LLM uses", () => {
  it("extracts explicitly labeled fields without an LLM", async () => {
    expect(await extractClaimIdentity("Claim ID: MI-10234\nClaimant: Test Person")).toEqual({ claimId: "MI-10234", claimant: "Test Person", source: "deterministic" });
    expect(await extractClaimIdentity("person@example.test")).toMatchObject({ claimant: null, claimId: null });
  });
  it("rejects invented identities", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion({ claimId: "MI-99999", claimant: "Invented Person" })));
    expect(await extractClaimIdentity("Claim ID: MI-10234")).toMatchObject({ claimId: "MI-10234", claimant: null, source: "deterministic" });
  });
  it("uses deterministic similarity with no provider, retaining a cross-check with a provider", async () => {
    const a = "car door dent", b = "car bumper dent";
    expect(await scoreNarrativeSimilarity(a, b)).toMatchObject({ score: narrativeSimilarity(a, b), source: "deterministic", llmScore: null });
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion({ score: 0.8 })));
    expect(await scoreNarrativeSimilarity(a, b)).toMatchObject({ score: 0.8, deterministicScore: 0.5, llmScore: 0.8, source: "llm" });
  });
  it("produces a deterministic explanation without changing the decision", async () => {
    const result = { decision: "Escalate" as const, reasons: ["Web lookup unavailable."], notes: [], ruleHits: ["E4"], ruleVersion: "1.0.0" };
    const output = await writeAdjusterExplanation(result);
    expect(output).toMatchObject({ decision: "Escalate", source: "deterministic" });
    expect(output.explanation).toContain("Web lookup unavailable.");
    expect(result.decision).toBe("Escalate");
  });
});
