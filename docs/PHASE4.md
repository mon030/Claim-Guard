# Phase 4: API contracts and verification

All three Route Handlers export `runtime = "nodejs"` and `maxDuration = 10`. The installed Next.js skill informed async route parameters and request/response handling. No new dependency or guardrail/config change was needed. Full original tests and source-integrity checks remain in place.

## Before live use

1. Run `npm run check` and `npm run build` (offline integration fixtures, no paid calls).
2. You run `npm run db:indexes` against your Atlas instance. This also creates the new partial unique `user_claim_slot_unique` index on `(claimId, slot)` for user-origin photos with a slot. Existing seed filename uniqueness and non-unique SHA indexes stay unchanged. No index is silently dropped; conflicts require inspecting the existing records/indexes.
3. Finish the team-authored mapping, then run `check-mapping`, `mapping-doc`, and `seed` as described in PHASE3.md. Lookup still works without a completed mapping, but decision requests reject incomplete reference comparisons. No mapping is inferred here.
4. Confirm Google Forms collects email addresses and the four configured entry IDs correspond to the intended fields. Run `check-prefill` and test the URL manually. The human signs in and submits, never the agent.
5. Run `npm run dev`, or `npm run build` then `npm start`. The home-page UI and claim creation/list endpoints are not part of this phase. API uploads require an existing unexpired claim; seed photo IDs come from the seeded records and will be exposed by the Phase 5 claim-selection flow.

The implementation did not perform any live MongoDB, Vision, LLM, webhook, or Forms requests during Phase 4. Live verification is left to the user as previously requested. A production build and mocked handler requests do not prove Atlas access or a provider key works.

## Access and common errors

If `DEMO_ACCESS_CODE` is configured, send `x-demo-access-code` on **every** API request, including thumbnail requests. Otherwise no gate is applied. Phase 5 should ask once and keep the code in memory. For gated thumbnails, fetch with that header and render a local Blob URL; do not put the access code in query strings or public environment variables.

Lookup allows 12 attempts per IP per 60 seconds, per warm server process, with a bounded in-memory map. On Vercel the key comes from the platform's `x-vercel-forwarded-for`; local development uses `x-forwarded-for`. Missing IPs share a bucket. IP hashes are never stored in the database. This is intentionally best effort: process restarts, multiple instances, and untrusted local proxy headers make it unsuitable as production authentication or a global rate limit. The MongoDB daily Vision counter is separate and atomic.

JSON errors use `{ error: { code, message } }`. Statuses: 400 malformed/unsupported fields; 401 demo code; 404 missing/expired claim or photo; 409 wrong claim, invalid slots, changed seed, or incomplete mapping/references; 413 size limit; 415 unsupported/invalid image or media type; 429 per-IP limit (with `Retry-After`); 503 storage/configuration failure. Provider failures and daily Vision exhaustion are valid lookup responses with unavailable evidence, not fabricated clean results. No raw provider/driver errors or secrets are returned.

## POST /api/lookup

Two mutually exclusive input shapes:

| Mode | Fields |
| --- | --- |
| Multipart upload | `file`: exactly one image; `claimId`: existing claim; `slot`: string `"1"` or `"2"`; optional `forceLive`: string `"true"` or `"false"` (default false) |
| JSON seed lookup | `{ photoId: string, forceLive?: boolean }`; photoId is a 24-character MongoDB ObjectId referring to an origin=seed photo |

No additional/repeated fields, multiple files, ZIPs, or image URLs are accepted. Each image is limited to **4,000,000 bytes**; the entire multipart stream is limited to **4,400,000 bytes**, including fields and boundaries. Both actual bytes and Content-Length are checked. This leaves room below Vercel's 4.5MB request ceiling. Phase 5 extracts ZIPs and processes batches in the browser, then sends one image at a time.

Sharp inspects the actual bytes and fully decodes a thumbnail before a paid lookup. Only single-frame JPEG/PNG/WebP up to 40 megapixels pass. MIME labels and extensions cannot override detection. The original received bytes produce SHA-256 and dHash through the Phase 2 modules. Thumbnails are orientation-corrected, metadata-stripped JPEGs fitting inside 320×320 without enlargement.

Uploaded photos are upserted by user origin, claimId and slot, with 14-day retention starting at upload/replacement. Re-uploading a slot preserves its photo ID, replaces its evidence, and removes any legacy `content` field. Reads do not extend retention. Seed lookups use stored original bytes but return none of them. Seed records retain their origin and have no user TTL. JSON lookup of a user photo is rejected because original uploads are deliberately not retained; re-upload to retry that photo.

The API calls the same `lib/lookup.ts` service as `lookup` and `validate-vision`. A valid cached SHA entry returns `source: "cache"` plus its original fetch time without quota use. `forceLive` reserves quota and makes a live request even if cached. Every HTTP attempt—including a 5xx retry—counts. `reason: "daily_limit"` means no further attempt was sent. Failures use `vision_timeout` or `vision_error`. Live raw plus extracted annotations remain in `vision_cache`; only compact evidence reaches the browser. Legacy cache entries without raw annotations remain usable with a matching allowlist; an allowlist change requires a fresh lookup for those entries.

Vision retains its eight-second maximum overall deadline and one 5xx retry. The API shortens that deadline to its remaining request budget, reserving 3.5 seconds for storage and reference comparison. An exhausted time budget becomes unavailable evidence. Storage operations have short individual deadlines; a hosting timeout/cold-start failure still needs a client retry, never invented success.

The user approved this response envelope because the supplied `PhotoEvidence` interface has no metadata fields. Its exact exported TypeScript contract is in `lib/api/contracts.ts`:

- `photoId`: saved photo ID for the decision request and thumbnail URL.
- `evidence`: **exactly** `PhotoEvidence`, containing filename, sha256, dhash, crossClaimMatches and webCheck. No extra members are added to the guardrail types.
- `lookup`: status, source, fetchedAt (ISO timestamp or null), reason, sanitized message, warnings and referenceCoverage.
- `matches`: filename, claimId, claimant (null only if unavailable in stored records), date, matchType and distance. Only other non-null claims appear; no guessed identities/dates. These metadata are separate from the exact `CrossClaimMatch` contract.

Raw Vision JSON, full images, customer emails, best-guess labels and web-entity payloads are not returned. Exact matches precede near matches; near comparisons use the unchanged configured dHash threshold.

## GET /api/photos/[id]/thumbnail

Returns only the stored JPEG thumbnail. No endpoint exposes full-size seed photos. Headers include `Content-Type: image/jpeg`, private caching for at most 300 seconds (shortened for imminent user-data expiry), `Vary: x-demo-access-code`, `X-Robots-Tag: noindex`, and `X-Content-Type-Options: nosniff`. Expired user photos are rejected even while awaiting MongoDB TTL deletion. Existing Phase 3 seed thumbnails may be 480×360; new uploaded thumbnails fit 320×320.

## POST /api/decide

Accepts strictly `{ claimId: string, photoIds: string[] }`. Up to two distinct IDs are allowed. Zero or one otherwise-valid photo invokes the team's existing R0 rule, returns `Blocked` and `prefillUrl: null`, and does not start a human-submit step or webhook. More than two, duplicates, extra browser evidence, wrong-claim photos and expired/missing records are rejected.

User photos must occupy distinct slots 1/2. Seed claims must use the team's manually mapped **seed** photos, not substitute user uploads or guesses. The evidence array is ordered by slot or the manual mapping, independent of request array order. Complete decisions require valid, assigned reference records; unavailable comparisons never silently become an empty match set.

The server reloads the claim, photos, latest cache and other claims. It recomputes cross-claim matches, re-extracts raw Vision under the current allowlist where possible, and computes token Jaccard narrative similarity through the existing deterministic module. No LLM calls are made in this route, even if configured; this keeps the two-photo request within its runtime budget and the app fully functional without an LLM. Stored snapshot fallback preserves a successful check if cache persistence previously failed, but enforces the same age and allowlist validation. A newer failed forced lookup overrides an older cache success for that photo. No prior successful lookup means unavailable, not zero matches.

Only `decide()` in the unchanged team file chooses Auto-approve/Escalate/Blocked. A decision record stores its server evidence, photo IDs, rule result and deterministic explanation. Seed-claim decision/audit history stays seed-origin; user-claim records expire after 14 days. The existing reset scope is unchanged.

The response contains the original rule result plus decisionId, prefillUrl, lookupSummary, narrativeSimilaritySource, escalation status and timeline. Form URLs contain only `usp=pp_url` and the four configured entries, encoded with URLSearchParams. Lookup summaries give **per-photo findings only**, preserve both photos, collapse whitespace to one line, and ellipsis-truncate at 300 characters. Decisions are exactly `Auto-approve` or `Escalate`; there is no invented Form option for `Blocked`. No email entry or emailAddress is included, including any such query values originally present in the configured URL.

The core activity timeline is persisted before returning a link: claim loaded; each stored photo lookup recovered (unavailable checks labelled accordingly); guardrail applied with ruleHits; prefill generated; **Waiting for a human to sign in and click Submit**, status **pending**. No route completes this step or detects a submission. Decision/audit writes are not a multi-document transaction: a partial database failure returns 503 without a success URL; a retry may leave a separate prior partial decision history, linked by decisionId for inspection.

Escalations optionally POST a short, email-free adjuster notification to ESCALATION_WEBHOOK_URL. One-second timeout, no retry, no redirects. Google Forms hosts are forbidden for webhook and LLM endpoints. Notification failure is safely logged, returned as `escalation: "failed"`, and recorded best-effort as an extra audit event; it never invalidates the already-persisted decision or human workflow. Repeating a decision request can send another notification; this endpoint does not claim idempotent webhook delivery.

## Verification

The suite exercises actual exported handlers with synthetic JPEG/PNG/WebP images, mocked Vision HTTP, and in-memory implementations of the MongoDB operations. It covers upload limits, format spoofing, single-image enforcement, caching/forced refresh, raw-server-only storage, quota/retry accounting, cross-claim metadata, thumbnails/expiry, access/rate limits, server-side evidence, incomplete mappings, unchanged guardrails, webhooks, audit persistence, URL encoding/length/decision strings/no-email, and readable env errors.

The source scanner traverses application, library, script, config and test source files, excluding dependencies/generated artifacts, and fails if the prohibited Google Forms submission-endpoint string appears. The test assembles its own search string from fragments so it does not introduce the forbidden string. Outbound destination tests also enforce that the app cannot use an LLM or webhook URL to POST to Google Forms.

Interactive browser verification is not claimed: the `next-dev-loop` skill requires `agent-browser`, which is not installed in this environment. No weaker browser substitute was used. The Phase 5 browser flow, deployment, live services and manually completed Google Form remain unverified.
