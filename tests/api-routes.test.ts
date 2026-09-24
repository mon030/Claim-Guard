import { Binary, MongoNetworkError, MongoOperationTimeoutError, ObjectId } from "mongodb";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as lookupRoute } from "../app/api/lookup/route";
import { POST as decideRoute } from "../app/api/decide/route";
import { GET as thumbnailRoute } from "../app/api/photos/[id]/thumbnail/route";
import { getCollections } from "../lib/mongodb";
import { retentionFor, USER_DATA_RETENTION_MS, type ClaimRecord, type PhotoRecord } from "../lib/models";
import { fingerprintPhoto, thumbnail } from "../lib/photos";
import { extractVisionResult, VISION_ENDPOINT } from "../lib/vision";
import { LOOKUP_RATE_LIMIT } from "../lib/api/security";
import { memoryCollections } from "./helpers/memory-mongo";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Results } from "../components/results";
import { EvidenceCard } from "../components/evidence-card";
import type { LookupResponse, DecideResponse } from "../lib/api/contracts";

vi.mock("../lib/mongodb", () => ({ getCollections: vi.fn() }));
vi.mock("@google-cloud/vision", async () => ({ v1: { ImageAnnotatorClient: (await import("./helpers/vision-sdk-mock")).MockImageAnnotatorClient } }));
let db: ReturnType<typeof memoryCollections>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let ip = 0;
let testIp: string;
const emptyAnnotation = () => ({ responses: [{ webDetection: {} }] });
const image = (format: "jpeg" | "png" | "webp" = "jpeg", background = "red") => sharp({ create: { width: 640, height: 480, channels: 3, background } }).toFormat(format).toBuffer();
function json(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": testIp, ...headers }, body: JSON.stringify(body) });
}
function upload(bytes: Buffer, fields: Record<string, string> = {}, filename = "uploaded.jpg", extra?: (form: FormData) => void) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), filename);
  form.set("claimId", "TEST-USER"); form.set("slot", "1");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  extra?.(form);
  return new Request("http://localhost/api/lookup", { method: "POST", headers: { "x-forwarded-for": testIp }, body: form });
}
async function claim(claimId = "TEST-USER", origin: "seed" | "user" = "user") {
  const record: ClaimRecord = { ...retentionFor(origin), claimId, claimant: `Synthetic ${claimId}`, customerEmail: "synthetic@example.test",
    date: "2026-09-01", amount: 1234, narrative: "Synthetic storm damaged the roof.", emailBody: "", emailSubject: "", category: "test", location: "test", mappedPhotos: null };
  await db.claims.insertOne(record);
  return db.claims.documents.at(-1)!;
}
async function seedPhoto(bytes: Buffer, claimId: string | null = "TEST-SEED", filename = "reference.jpg") {
  const now = new Date();
  const photo: PhotoRecord = { ...retentionFor("seed", now), claimId, filename, ...await fingerprintPhoto(bytes),
    byteLength: bytes.length, contentType: "image/jpeg", content: new Binary(bytes), thumbnail: new Binary(await thumbnail(bytes)), thumbnailContentType: "image/jpeg" };
  await db.photos.insertOne(photo);
  return db.photos.documents.at(-1)!;
}
async function lookedUpPair(nonStock = false) {
  const owner = await claim();
  if (nonStock) fetchMock.mockImplementation(async () => Response.json({ responses: [{ webDetection: {
    fullMatchingImages: Array.from({ length: 3 }, (_, n) => ({ url: `https://synthetic.example/${n}.jpg` })),
  } }] }));
  const first = await lookupRoute(upload(await image(), { slot: "1" }));
  const second = await lookupRoute(upload(await image("jpeg", "blue"), { slot: "2" }));
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  const photoIds = [(await first.json()).photoId, (await second.json()).photoId] as string[];
  return { owner, photoIds };
}

beforeEach(() => {
  db = memoryCollections();
  vi.mocked(getCollections).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getCollections>>);
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (url !== VISION_ENDPOINT) throw new Error("Unexpected external request in offline test");
    return Response.json(emptyAnnotation());
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const [key, value] of Object.entries({ GOOGLE_VISION_API_KEY: "synthetic-key", DAILY_VISION_LIMIT: "200", DAILY_LLM_LIMIT: "200",
    DEMO_ACCESS_CODE: "", ESCALATION_WEBHOOK_URL: "", FORM_WEBHOOK_SECRET: "", VERCEL: "",
    LLM_API_KEY: "", LLM_API_BASE_URL: "", LLM_MODEL: "", GOOGLE_FORM_URL: "https://docs.google.com/forms/d/e/synthetic/viewform",
    GOOGLE_FORM_ENTRY_CLAIM_ID: "1", GOOGLE_FORM_ENTRY_CLAIMANT: "2", GOOGLE_FORM_ENTRY_LOOKUP: "3", GOOGLE_FORM_ENTRY_DECISION: "4" })) vi.stubEnv(key, value);
  testIp = `test-${++ip}`;
});

describe("POST /api/lookup (real shared lookup, mocked HTTP and MongoDB)", () => {
  it("allows a safe retry after a database connection failure before any Vision request", async () => {
    await claim(); const bytes = await image();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getCollections).mockRejectedValueOnce(new MongoNetworkError("mongodb://secret-password")).mockRejectedValueOnce(new MongoNetworkError("synthetic")).mockRejectedValueOnce(new MongoNetworkError("synthetic"));
    const failed = await lookupRoute(upload(bytes));
    expect(failed.status).toBe(503); expect(failed.headers.get("Retry-After")).toBe("1");
    expect(await failed.json()).toMatchObject({ error: "database_unavailable", retryable: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-password");
    const recovered = await lookupRoute(upload(bytes));
    expect(recovered.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("allows a retry after cache-read timeout without bypassing cache or spending quota", async () => {
    await claim(); const bytes = await image();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db.vision_cache, "findOne").mockRejectedValue(new MongoOperationTimeoutError("synthetic timeout"));
    const failed = await lookupRoute(upload(bytes));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: "database_unavailable", retryable: true });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.usage.documents).toHaveLength(0);
  });
  it("returns retryable after exhausted photo-write retries, preserving the paid cache result", async () => {
    await claim(); const bytes = await image();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db.photos, "findOneAndUpdate").mockRejectedValue(new MongoOperationTimeoutError("synthetic timeout"));
    const failed = await lookupRoute(upload(bytes, { forceLive: "true" }));
    expect(failed.status).toBe(503); expect(failed.headers.get("Retry-After")).toBe("1");
    expect(await failed.json()).toMatchObject({ error: "database_unavailable", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(db.usage.documents[0].count).toBe(1);
    expect(db.vision_cache.documents).toHaveLength(1);
  });
  it.each(["jpeg", "png", "webp"] as const)("validates %s bytes, stores a 320px thumbnail, no original, and exactly PhotoEvidence", async (format) => {
    await claim(); const bytes = await image(format);
    const response = await lookupRoute(upload(bytes, {}, "misleading.extension"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["evidence", "lookup", "matches", "photoId"]);
    expect(Object.keys(body.evidence).sort()).toEqual(["crossClaimMatches", "dhash", "filename", "sha256", "webCheck"]);
    expect(Object.keys(body.evidence.webCheck).sort()).toEqual(["domains", "fullMatchCount", "nonStockFullMatchCount", "partialMatchCount", "similarCount", "source", "status"]);
    expect(body.lookup).toMatchObject({ source: "live", status: "ok", reason: null });
    expect(body.lookup.fetchedAt).toEqual(expect.any(String));
    const saved = db.photos.documents[0];
    expect(saved).toMatchObject({ origin: "user", claimId: "TEST-USER", slot: 1, contentType: `image/${format}` });
    expect(saved).not.toHaveProperty("content");
    expect(saved.expiresAt!.getTime() - saved.createdAt.getTime()).toBe(USER_DATA_RETENTION_MS);
    expect((await sharp(Buffer.from(saved.thumbnail.value())).metadata()).width).toBe(320);
    expect(db.vision_cache.documents[0].raw).toEqual(emptyAnnotation());
    expect(body).not.toHaveProperty("raw"); expect(JSON.stringify(body)).not.toContain("responses");
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(sent.requests[0].image).toEqual({ content: bytes.toString("base64") });
  });
  it("reuses SHA cache without quota, upserts slots, and forceLive performs a new paid lookup", async () => {
    await claim(); const bytes = await image();
    const first = await (await lookupRoute(upload(bytes))).json();
    const second = await (await lookupRoute(upload(bytes))).json();
    expect(second.photoId).toBe(first.photoId); expect(db.photos.documents).toHaveLength(1);
    expect(second.lookup).toMatchObject({ source: "cache", fetchedAt: first.lookup.fetchedAt });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(db.usage.documents[0].count).toBe(1);
    const forced = await (await lookupRoute(upload(bytes, { forceLive: "true" }))).json();
    expect(forced.lookup.source).toBe("live"); expect(fetchMock).toHaveBeenCalledTimes(2); expect(db.usage.documents[0].count).toBe(2);
  });
  it("still serves cached evidence when the daily limit is exhausted", async () => {
    await claim(); const bytes = await image();
    await lookupRoute(upload(bytes)); vi.stubEnv("DAILY_VISION_LIMIT", "0");
    const cached = await (await lookupRoute(upload(bytes))).json();
    expect(cached.evidence.webCheck.status).toBe("ok"); expect(cached.lookup.source).toBe("cache");
    const forced = await (await lookupRoute(upload(bytes, { forceLive: "true" }))).json();
    expect(forced.evidence.webCheck).toMatchObject({ status: "unavailable", source: null });
    expect(forced.lookup.reason).toBe("daily_limit"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("returns unavailable for failed Vision, caches no fabricated clean response, counts each retry", async () => {
    await claim(); fetchMock.mockImplementation(async () => new Response("synthetic error", { status: 503 }));
    const body = await (await lookupRoute(upload(await image()))).json();
    expect(body.evidence.webCheck.status).toBe("unavailable"); expect(body.lookup.reason).toBe("vision_error");
    expect(db.vision_cache.documents).toHaveLength(0); expect(db.usage.documents[0].count).toBe(2); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("reports exact and near other-claim matches and excludes current/null claims", async () => {
    await claim(); await claim("OTHER", "seed"); const bytes = await image();
    await seedPhoto(bytes, "OTHER", "exact.jpg");
    const near = await seedPhoto(await image("jpeg", "blue"), "OTHER", "near.jpg");
    near.dhash = "0000000000000001";
    await seedPhoto(bytes, null, "unmapped.jpg");
    const body = await (await lookupRoute(upload(bytes))).json();
    expect(body.matches).toEqual([
      { filename: "exact.jpg", claimId: "OTHER", claimant: "Synthetic OTHER", date: "2026-09-01", matchType: "exact", distance: 0 },
      { filename: "near.jpg", claimId: "OTHER", claimant: "Synthetic OTHER", date: "2026-09-01", matchType: "near", distance: 1 },
    ]);
    expect(body.evidence.crossClaimMatches[0]).not.toHaveProperty("claimant");
    expect(body.lookup.referenceCoverage.unmapped).toBe(1);
  });
  it("looks up a seeded image by ID without exposing its bytes", async () => {
    await claim("TEST-SEED", "seed"); const photo = await seedPhoto(await image());
    const body = await (await lookupRoute(json("lookup", { photoId: photo._id.toHexString() }))).json();
    expect(body.photoId).toBe(photo._id.toHexString()); expect(body.evidence.crossClaimMatches).toEqual([]);
    expect(db.photos.documents).toHaveLength(1); expect(db.photos.documents[0].origin).toBe("seed"); expect(body).not.toHaveProperty("content");
  });
  it("rejects JSON IDs for user uploads rather than attempting a live request without original bytes", async () => {
    await claim(); const body = await (await lookupRoute(upload(await image()))).json();
    const result = await lookupRoute(json("lookup", { photoId: body.photoId }));
    expect(result.status).toBe(404); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')],
    ["ZIP", Buffer.from("PK\x03\x04not-an-image")], ["corrupt", Buffer.from("not-an-image")],
  ])("rejects %s disguised as JPEG before calling Vision", async (_label, bytes) => {
    await claim(); expect((await lookupRoute(upload(bytes))).status).toBe(415); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects over-4MB files, multiple files, repeated fields, missing claims and invalid slots", async () => {
    await claim();
    expect((await lookupRoute(upload(Buffer.alloc(4_000_001)))).status).toBe(413);
    const bytes = await image();
    expect((await lookupRoute(upload(bytes, {}, "a.jpg", (form) => form.append("file", new Blob([new Uint8Array(bytes)]), "b.jpg")))).status).toBe(400);
    expect((await lookupRoute(upload(bytes, {}, "a.jpg", (form) => form.append("slot", "2")))).status).toBe(400);
    expect((await lookupRoute(upload(bytes, { slot: "0" }))).status).toBe(400);
    expect((await lookupRoute(upload(bytes, { claimId: "MISSING" }))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects oversized actual request bodies and unexpected JSON fields", async () => {
    const request = new Request("http://localhost/api/lookup", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test", "x-forwarded-for": testIp }, body: new Uint8Array(4_400_001) });
    expect((await lookupRoute(request)).status).toBe(413);
    expect((await lookupRoute(json("lookup", { photoId: new ObjectId().toHexString(), evidence: {} }))).status).toBe(400);
  });
  it("enforces the optional demo header before database access", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "synthetic-code"); vi.mocked(getCollections).mockClear();
    expect((await lookupRoute(json("lookup", {}))).status).toBe(401); expect(getCollections).not.toHaveBeenCalled();
    expect((await lookupRoute(json("lookup", { photoId: new ObjectId().toHexString() }, { "x-demo-access-code": "synthetic-code" }))).status).toBe(404);
  });
  it("best-effort IP limiting returns Retry-After and does not block a different IP", async () => {
    for (let index = 0; index < LOOKUP_RATE_LIMIT; index++) expect((await lookupRoute(json("lookup", {}))).status).toBe(400);
    const limited = await lookupRoute(json("lookup", {}));
    expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    testIp = `test-${++ip}`; expect((await lookupRoute(json("lookup", {}))).status).toBe(400);
  });
});

describe("GET /api/photos/[id]/thumbnail", () => {
  it("serves only JPEG thumbnail bytes with private caching and noindex", async () => {
    const photo = await seedPhoto(await image());
    const response = await thumbnailRoute(new Request("http://localhost"), { params: Promise.resolve({ id: photo._id.toHexString() }) });
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private"); expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(photo.thumbnail.value()));
    expect(Buffer.from(photo.thumbnail.value())).not.toEqual(Buffer.from(photo.content!.value())); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs, expired photos, and unauthenticated demo access", async () => {
    expect((await thumbnailRoute(new Request("http://localhost"), { params: Promise.resolve({ id: "bad" }) })).status).toBe(400);
    await lookedUpPair(); const photo = db.photos.documents[0]; Object.assign(photo, { expiresAt: new Date(0) });
    expect((await thumbnailRoute(new Request("http://localhost"), { params: Promise.resolve({ id: photo._id.toHexString() }) })).status).toBe(404);
    vi.stubEnv("DEMO_ACCESS_CODE", "synthetic-code");
    expect((await thumbnailRoute(new Request("http://localhost"), { params: Promise.resolve({ id: photo._id.toHexString() }) })).status).toBe(401);
  });
  it("does not cache a user thumbnail beyond its remaining lifetime", async () => {
    await lookedUpPair(); const photo = db.photos.documents[0];
    Object.assign(photo, { expiresAt: new Date(Date.now() + 20_000) });
    const response = await thumbnailRoute(new Request("http://localhost"), { params: Promise.resolve({ id: photo._id.toHexString() }) });
    const age = Number(response.headers.get("cache-control")!.match(/max-age=(\d+)/)![1]);
    expect(age).toBeGreaterThanOrEqual(0); expect(age).toBeLessThanOrEqual(20);
  });
});

describe("POST /api/decide", () => {
  it("true per-image failure with no cache reaches E4 and the red decision banner, never reassurance", async () => {
    await claim();
    fetchMock.mockResolvedValueOnce(Response.json({ responses: [{ error: { code: 3, message: "Synthetic invalid image" } }] }));
    const results: LookupResponse[] = [];
    for (const slot of [1, 2]) results.push(await (await lookupRoute(upload(await image("jpeg", slot === 1 ? "red" : "blue"), { slot: String(slot) }))).json());
    expect(db.vision_cache.documents).toHaveLength(1);
    expect(results[0].evidence.webCheck.status).toBe("unavailable");
    expect(results[1].evidence.webCheck.status).toBe("ok");
    expect(db.vision_cache.documents.some((entry) => entry.sha256 === results[0].evidence.sha256)).toBe(false);
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds: results.map((result) => result.photoId) }));
    const decision = await response.json() as DecideResponse;
    expect(response.status).toBe(200); expect(decision.decision).toBe("Escalate"); expect(decision.ruleHits).toContain("E4");
    const html = renderToStaticMarkup(createElement(Results, { decision,
      photos: results.map((result) => ({ key: result.photoId, filename: result.evidence.filename, status: "error" as const, result })),
      code: "", busy: false, llmConfigured: false, explanation: null, rerun: async () => {}, copy: async () => {}, explain: async () => {},
    }));
    expect(html).toContain("Escalate"); expect(html).toContain("border-error");
    expect(html).toContain("This photo could not be verified against the web.");
    const failedCard = renderToStaticMarkup(createElement(EvidenceCard, { photo: { key: "failed", filename: "failed.jpg", status: "error", result: results[0] }, code: "", disabled: false, rerun: async () => {} }));
    expect(failedCard).not.toContain("A similar image is not proof of reuse");
    expect(html).toContain("Save as PDF"); expect(html).toContain("Start Over");
  });
  it("recovers an ambiguous audit write without duplicate decisions or activities", async () => {
    const { photoIds } = await lookedUpPair();
    const original = db.audit_log.updateOne.bind(db.audit_log);
    vi.spyOn(db.audit_log, "updateOne").mockImplementationOnce(async (...args) => {
      await original(...args); throw new MongoOperationTimeoutError("Synthetic acknowledgement lost");
    });
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }, { "Idempotency-Key": crypto.randomUUID() }));
    expect(response.status).toBe(200); expect(db.decisions.documents).toHaveLength(1); expect(db.audit_log.documents).toHaveLength(6);
  });
  it("handles six individually uploaded user photos, preserves resize metadata, and summarizes all six", async () => {
    await claim();
    const photoIds: string[] = [];
    for (let slot = 1; slot <= 6; slot++) {
      const response = await lookupRoute(upload(await image("jpeg", `rgb(${slot * 30},20,60)`), { slot: String(slot), resized: String(slot === 6) }));
      expect(response.status).toBe(200);
      photoIds.push((await response.json()).photoId);
    }
    expect(db.photos.documents.find((photo) => photo.slot === 6)?.resized).toBe(true);
    expect((await lookupRoute(upload(await image(), { slot: "7" }))).status).toBe(400);
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.decision).toBe("Auto-approve");
    expect(result.timeline.filter((item: { event: string }) => item.event === "photo_lookup")).toHaveLength(6);
    expect(db.decisions.documents[0].evidence.photos).toHaveLength(6);
    const summary = new URL(result.prefillUrl).searchParams.get("entry.3")!;
    expect(summary.length).toBeLessThanOrEqual(300);
    expect(summary).toContain("P6:");
  });
  it("requires the optional demo header on decisions too", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "test-secret"); vi.mocked(getCollections).mockClear();
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds: [] }));
    expect(response.status).toBe(401); expect(getCollections).not.toHaveBeenCalled();
  });
  it("recomputes server evidence, applies unchanged rules, and persists a pending human timeline", async () => {
    const { photoIds } = await lookedUpPair(); fetchMock.mockClear();
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds: [...photoIds].reverse() }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.decision).toBe("Auto-approve"); expect(result.narrativeSimilaritySource).toBe("deterministic");
    const url = new URL(result.prefillUrl); expect(url.searchParams.get("entry.4")).toBe("Auto-approve");
    expect([...url.searchParams.keys()]).toHaveLength(5); expect(url.searchParams.get("entry.3")!.length).toBeLessThanOrEqual(300);
    expect(result.timeline.map((item: { event: string }) => item.event)).toEqual(["claim_loaded", "photo_lookup", "photo_lookup", "decision", "form_prefill", "form_human_submission"]);
    expect(result.timeline.at(-1)).toMatchObject({ status: "pending", message: "Waiting for a human to sign in and click Submit." });
    expect(db.decisions.documents).toHaveLength(1); expect(db.audit_log.documents).toHaveLength(6);
    expect(db.audit_log.documents.at(-1)!.status).toBe("pending"); expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("synthetic@example.test");
  });
  it("rejects client-injected evidence, duplicate IDs, extra photos, and wrong-claim photos", async () => {
    const { photoIds } = await lookedUpPair();
    for (const body of [
      { claimId: "TEST-USER", photoIds, evidence: { webCheck: {} } },
      { claimId: "TEST-USER", photoIds: [photoIds[0], photoIds[0]] },
      { claimId: "TEST-USER", photoIds: Array.from({ length: 7 }, () => new ObjectId().toHexString()) },
    ]) expect((await decideRoute(json("decide", body))).status).toBe(400);
    await claim("OTHER"); db.photos.documents[0].claimId = "OTHER";
    expect((await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).status).toBe(409); expect(db.decisions.documents).toHaveLength(0);
  });
  it("calls R0 for a missing second photo and never builds a Blocked form value", async () => {
    const { photoIds } = await lookedUpPair();
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds: photoIds.slice(0, 1) }))).json();
    expect(result).toMatchObject({ decision: "Blocked", ruleHits: ["R0"], prefillUrl: null });
    expect(result.timeline.some((item: { event: string }) => item.event === "form_human_submission")).toBe(false);
  });
  it("uses current cross-claim records, not cross-claim results previously returned to the browser", async () => {
    const { photoIds } = await lookedUpPair(); await claim("OTHER", "seed");
    await seedPhoto(await image(), "OTHER", "later.jpg");
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result.decision).toBe("Escalate"); expect(result.ruleHits).toContain("E1");
    expect(db.decisions.documents[0].evidence.photos[0].crossClaimMatches[0].matchedClaimId).toBe("OTHER");
  });
  it("retains unavailable status after failed forceLive even with a good older cache", async () => {
    const { photoIds } = await lookedUpPair(); vi.stubEnv("DAILY_VISION_LIMIT", "0");
    await lookupRoute(upload(await image(), { forceLive: "true" }));
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result.ruleHits).toContain("E4"); expect(result.decision).toBe("Escalate"); expect(db.vision_cache.documents.length).toBeGreaterThan(0);
  });
  it("marks expired cache and snapshot unavailable even before asynchronous TTL deletion", async () => {
    const { photoIds } = await lookedUpPair();
    for (const photo of db.photos.documents) photo.lookup!.checkedAt = new Date(0);
    for (const cache of db.vision_cache.documents) cache.expiresAt = new Date(0);
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result.ruleHits).toContain("E4"); expect(result.decision).toBe("Escalate");
  });
  it("refuses incomplete mappings and invalid reference hashes rather than auto-approving", async () => {
    const { photoIds } = await lookedUpPair(); await seedPhoto(await image(), null);
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }));
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe("references_incomplete");
  });
  it("requires the real mapped seed pair and supports it once the team has mapped it", async () => {
    const owner = await claim("TEST-SEED", "seed");
    const photos = [await seedPhoto(await image(), owner.claimId, "one.jpg"), await seedPhoto(await image("jpeg", "blue"), owner.claimId, "two.jpg")];
    const photoIds = photos.map((photo) => photo._id.toHexString());
    for (const photoId of photoIds) expect((await lookupRoute(json("lookup", { photoId }))).status).toBe(200);
    expect((await decideRoute(json("decide", { claimId: owner.claimId, photoIds }))).status).toBe(409);
    owner.mappedPhotos = ["one.jpg", "two.jpg"];
    const result = await (await decideRoute(json("decide", { claimId: owner.claimId, photoIds }))).json();
    expect(result.decision).toBe("Auto-approve"); expect(db.decisions.documents[0].origin).toBe("seed");
  });
  it("re-extracts server-only raw Vision instead of trusting cached extracted counters", async () => {
    const { photoIds } = await lookedUpPair(true);
    for (const cache of db.vision_cache.documents) cache.result = extractVisionResult(emptyAnnotation());
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result.decision).toBe("Escalate"); expect(result.ruleHits).toContain("E3");
  });
  it("does not break decisions when the escalation webhook fails; logs a safe status", async () => {
    const { photoIds } = await lookedUpPair(true); vi.stubEnv("ESCALATION_WEBHOOK_URL", "https://adjuster.example/hook");
    fetchMock.mockRejectedValue(new Error("secret upstream detail")); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result).toMatchObject({ decision: "Escalate", escalation: "failed" }); expect(result.prefillUrl).toContain("viewform");
    expect(db.audit_log.documents.at(-1)).toMatchObject({ event: "escalation", status: "unavailable" });
    expect(warning).toHaveBeenCalled(); expect(JSON.stringify(warning.mock.calls)).not.toContain("secret upstream detail");
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: "POST", redirect: "error" });
  });
  it("sends only a short adjuster notification and never marks human submission completed", async () => {
    const { photoIds } = await lookedUpPair(true); vi.stubEnv("ESCALATION_WEBHOOK_URL", "https://adjuster.example/hook");
    fetchMock.mockClear(); fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await (await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }))).json();
    expect(result.escalation).toBe("sent"); expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]; expect(url).toBe("https://adjuster.example/hook");
    expect(JSON.parse(options!.body as string)).toMatchObject({ claimId: "TEST-USER", claimant: "Synthetic TEST-USER", amount: 1234, reasons: expect.any(Array) });
    expect(db.audit_log.documents.find((event) => event.event === "form_human_submission")!.status).toBe("pending");
  });
  it("returns readable env errors and generic database failures without secrets", async () => {
    const { photoIds } = await lookedUpPair(); vi.stubEnv("GOOGLE_FORM_ENTRY_DECISION", "");
    const missing = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }));
    expect(missing.status).toBe(503); expect((await missing.json()).error.message).toContain("GOOGLE_FORM_ENTRY_DECISION: is required");
    vi.mocked(getCollections).mockRejectedValue(new Error("mongodb://secret-password")); vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }));
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret-password");
  });
  it("does not return a success/link when core audit persistence fails", async () => {
    const { photoIds } = await lookedUpPair();
    vi.spyOn(db.audit_log, "updateOne").mockRejectedValue(new Error("synthetic storage failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await decideRoute(json("decide", { claimId: "TEST-USER", photoIds }));
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("prefillUrl");
  });
});
