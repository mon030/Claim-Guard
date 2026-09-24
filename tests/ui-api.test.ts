import { ObjectId } from "mongodb";
import { beforeEach, expect, it, vi } from "vitest";
import { POST, GET } from "../app/api/claims/route";
import { GET as config } from "../app/api/config/route";
import { POST as suggest } from "../app/api/suggest/route";
import { POST as explain } from "../app/api/explanation/route";
import { getCollections } from "../lib/mongodb";
import { retentionFor } from "../lib/models";
import { memoryCollections } from "./helpers/memory-mongo";
import { MAX_CLAIM_AMOUNT } from "../lib/claim-validation";
vi.mock("../lib/mongodb", () => ({ getCollections: vi.fn() }));
let db: ReturnType<typeof memoryCollections>;
const payload = () => ({ clientRequestId: crypto.randomUUID(), claimId: "", claimant: "Synthetic Person", narrative: "Test narrative", date: "2026-09-01", amount: 200 });
const request = (body: unknown) => new Request("http://localhost/api/claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  db = memoryCollections(); vi.mocked(getCollections).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getCollections>>);
  for (const name of ["DEMO_ACCESS_CODE", "ESCALATION_WEBHOOK_URL", "LLM_API_KEY", "LLM_API_BASE_URL", "LLM_MODEL"]) vi.stubEnv(name, "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No external requests permitted")));
});
it("creates a generated demo ID without inventing an email or other missing claim context", async () => {
  const response = await POST(request(payload())); expect(response.status).toBe(201);
  expect((await response.json()).claimId).toMatch(/^MI-DEMO-\d{4}$/);
  expect(db.claims.documents[0]).toMatchObject({ origin: "user", customerEmail: "", category: "", location: "", amount: 200 });
  expect(db.claims.documents[0].expiresAt).toBeInstanceOf(Date);
});
it("requires factual date and amount and rejects missing or invalid inputs", async () => {
  const input = payload();
  for (const invalid of [{ ...input, date: "" }, { ...input, amount: undefined }, { ...input, amount: -1 }, { ...input, claimant: "" }, { ...input, decision: "Auto-approve" }]) expect((await POST(request(invalid))).status).toBe(400);
  expect(db.claims.documents).toHaveLength(0);
});
it("accepts a valid Unicode narrative up to the documented character limit", async () => {
  const response = await POST(request({ ...payload(), narrative: "水".repeat(10_000) }));
  expect(response.status).toBe(201);
  expect(db.claims.documents[0].narrative).toHaveLength(10_000);
});
it("enforces positive bounded amounts server-side without clamping", async () => {
  for (const amount of [0, -0.01, MAX_CLAIM_AMOUNT + 0.01]) expect((await POST(request({ ...payload(), amount }))).status).toBe(400);
  expect(db.claims.documents).toHaveLength(0);
  expect((await POST(request({ ...payload(), amount: MAX_CLAIM_AMOUNT }))).status).toBe(201);
  expect(db.claims.documents[0].amount).toBe(MAX_CLAIM_AMOUNT);
});
it("reuses an identical request and refuses a changed draft under the same request ID", async () => {
  const input = payload(); const first = await (await POST(request(input))).json();
  const second = await (await POST(request(input))).json(); expect(second).toEqual(first); expect(db.claims.documents).toHaveLength(1);
  expect((await POST(request({ ...input, amount: 999 }))).status).toBe(409);
});
it("lists only seeded claims, explicitly marking missing mappings", async () => {
  await POST(request(payload()));
  await db.claims.insertOne({ ...retentionFor("seed"), claimId: "TEST-SEED", claimant: "Test", date: "2026-09-01", amount: 12, narrative: "Test", customerEmail: "test@example.test", emailBody: "private", emailSubject: "", location: "Test", category: "Test", mappedPhotos: null, _id: new ObjectId() });
  const result = await (await GET(new Request("http://localhost/api/claims"))).json();
  expect(result.claims).toHaveLength(1); expect(result.claims[0].unavailableReason).toContain("not mapped"); expect(result.claims[0]).not.toHaveProperty("emailBody");
});
it("exposes only capability flags, never the configured key or access code", async () => {
  vi.stubEnv("DEMO_ACCESS_CODE", "private-access");
  const response = await config(); expect(await response.json()).toEqual({ demoAccessRequired: true, llmConfigured: false });
  expect((await GET(new Request("http://localhost/api/claims"))).status).toBe(401);
});
it("supports deterministic identity suggestions with zero LLM configured", async () => {
  const response = await suggest(request({ text: "Claim ID: DEMO-TEST\nClaimant: Test Person" }));
  expect(await response.json()).toMatchObject({ claimId: "DEMO-TEST", claimant: "Test Person", source: "deterministic" });
  expect(fetch).not.toHaveBeenCalled();
});
it("falls back without a provider request when the daily LLM quota is zero", async () => {
  vi.stubEnv("LLM_API_KEY", "synthetic-key"); vi.stubEnv("LLM_API_BASE_URL", "https://llm.example/v1"); vi.stubEnv("LLM_MODEL", "synthetic-model"); vi.stubEnv("DAILY_LLM_LIMIT", "0");
  const result = await (await suggest(request({ text: "Claim ID: TEST-1\nClaimant: Synthetic Person" }))).json();
  expect(result.source).toBe("deterministic"); expect(fetch).not.toHaveBeenCalled();
});
it("explains only a server-stored active decision and rejects supplied decision text", async () => {
  const decisionId = new ObjectId();
  const facts = { claimId: "TEST-1", claimant: "Synthetic Person", customerEmail: "", narrative: "Test", date: "2026-09-01", amount: 1, photos: [] };
  await db.decisions.insertOne({ _id: decisionId, ...retentionFor("user"), claimId: facts.claimId, evidence: facts,
    result: { decision: "Blocked", ruleHits: ["R0"], reasons: ["Required photos are missing."], notes: [], ruleVersion: "test-only" }, explanation: "", explanationSource: "deterministic" });
  const response = await explain(request({ decisionId: decisionId.toHexString() }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ source: "deterministic", explanation: expect.stringContaining("Required photos are missing.") });
  expect((await explain(request({ decisionId: decisionId.toHexString(), decision: "Auto-approve" }))).status).toBe(400);
  expect((await explain(request({ decisionId: new ObjectId().toHexString() }))).status).toBe(404);
  Object.assign(db.decisions.documents[0], { expiresAt: new Date(0) });
  expect((await explain(request({ decisionId: decisionId.toHexString() }))).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
