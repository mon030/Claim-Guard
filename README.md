# ClaimGuard — Phases 2–5

BUAN 3301, AI in Business. Fictional company: Meridian Insurance.

Phase 2 supplies the server-side libraries, typed MongoDB records, optional LLM helpers, and tests. Phase 3 adds the offline contact sheet, mapping validation/documentation, idempotent photo seeding, cached Vision calibration and single-photo lookup, Form prefill checking, and scoped demo reset. Phase 4 adds the lookup, thumbnail, and decision APIs. Phase 5 adds the responsive, single-page end-user app, protected claim creation/listing, browser-side ZIP/Word imports, and optional explicitly requested LLM assistance. Start with `npm run contact-sheet`; the before/after mapping sequence is in [docs/PHASE3.md](docs/PHASE3.md). API contracts are in [docs/PHASE4.md](docs/PHASE4.md); the UI, its contract extensions, and verification details are in [docs/PHASE5.md](docs/PHASE5.md). No mappings or live Vision results are fabricated.

## Run

Use Node.js 22.12.0 or newer (verified locally on 22.12.0), then:

```sh
npm ci
npm run check
npm run build
```

The check generates Next route types, runs strict TypeScript validation and the complete Vitest suite, including the supplied `lib/guardrail.test.ts`. Tests use synthetic image/API fixtures and mocked network/database calls; they need no credentials and incur no API charges. Next's generated `next-env.d.ts` and `.next/` stay git-ignored. The build compiles the page and all seven API endpoints; it does not call the real services. `npm run dev` starts the end-user app at the address printed in the terminal. Its real API calls require your local configuration and seeded database.

For real services, copy `.env.example` to `.env`, enter your own values, and run:

```sh
npm run db:indexes
```

This script uses `tsx --env-file=.env`. It creates the six collections' indexes, is repeatable, and never drops existing indexes. An incompatible existing index is reported as a failure requiring inspection. Normal requests reuse the MongoDB connection and do not build indexes. In Vercel, set the same variables in Project Settings → Environment Variables, and redeploy after changes. Never prefix secrets with `NEXT_PUBLIC_`.

## Exact dependency pins

Resolved from the npm registry's stable `latest` tags on 2026-09-21 and all 18 pins reconfirmed on 2026-09-22; no version changes were needed. Every direct dependency is exact in `package.json`; `package-lock.json` locks transitive packages. Phase 5 uses the existing pins, including browser-only dynamic imports of fflate and Mammoth. It introduces no additional project dependencies.

| Package | Version |
| --- | --- |
| next | 16.3.5 |
| react | 19.3.0 |
| react-dom | 19.3.0 |
| mongodb | 7.6.0 |
| sharp | 0.35.4 |
| fflate | 0.8.3 |
| mammoth | 1.12.3 |
| zod | 4.6.5 |
| typescript | 7.0.2 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| daisyui | 5.7.43 |
| vitest | 5.0.1 |
| vite | 8.3.0 |
| tsx | 4.23.15 |
| @types/node | 26.6.2 |
| @types/react | 19.3.0 |
| @types/react-dom | 19.3.0 |

The installed Next.js and daisyUI skills informed the App Router structure, component markup, and Tailwind v4 CSS-based setup. Context7 verified sharp resize/raw output, MongoDB client/index options, Zod validation, compatible chat completions, Vitest mocking, fflate streaming decompression, and Mammoth browser text extraction APIs. Primary references are in [docs/API_NOTES.md](docs/API_NOTES.md).

## Modules and contracts

- `lib/guardrail.ts` remains the sole decision authority. The only authorized edit is exporting its existing Hamming-distance helper. Its implementation and `decide()` are unchanged. The supplied config and nine tests are unchanged.
- `data/claims.json` is the exact supplied file. On 2026-09-23 the user supplied the group's manual mapping; `data/mapping.json` now contains two filenames for each of the 18 claims, with all 36 photos used once. The associations were re-seeded successfully and documented in `docs/MAPPING.md`. No module inferred them from filenames, narratives, or an LLM.
- `lib/env.ts` reads configuration only when called. `getEnv()` validates everything; integration-specific getters validate only that integration. Error messages identify variables without printing their values. Blank optional values count as absent. A partial LLM group throws a readable error.
- `lib/hash.ts` exposes `sha256(buffer)`, `dhash(buffer)`, and the original `hammingDistanceHex(a,b)` helper. SHA-256 uses original bytes. dHash normalizes EXIF orientation, flattens alpha on white, converts to grayscale, resizes the full image to 9×8 with `fit: "fill"` and `lanczos3`, and compares adjacent horizontal pixels. Left greater than right is 1; row-major, most-significant bit first; always 16 lowercase hex characters. The original Hamming helper is intentionally unchanged; callers must supply validated hexadecimal hashes.
- `lib/vision.ts` exposes `detectWeb(buffer)`, `extractVisionResult(response)`, and `toWebCheck(result, source)`. It sends only base64 content to Google Vision `images:annotate`, requesting `WEB_DETECTION` with `maxResults: 50`. The key is in a header, not a URL. The initial attempt and one HTTP-5xx retry share an eight-second AbortController deadline, including body reading. HTTP 4xx, quota errors, annotation errors, malformed results, and network errors are not retried. A missing Web Detection object fails; an explicit empty object is a valid completed lookup. Errors never become successful zero-match results. The caller may use cached evidence or explicitly pass `null` to `toWebCheck` to invoke the supplied unavailable-check policy.
- `lib/llm/client.ts` is the only provider boundary. It sends `{model, messages, response_format: {type: "json_object"}}` to the configured base plus `/chat/completions`. Runtime Zod validation enforces the output contract. Disabled LLM, timeout, refusal, truncation, invalid JSON/schema, or HTTP failures return `null`. No SDK, provider-specific model, or tool calling is assumed.
- `lib/llm/prompts.ts` provides exactly three uses: identity extraction, narrative similarity, and adjuster explanation, each with a deterministic fallback. Every similarity result includes the deterministic Jaccard score; LLM prose is separate from the fixed guardrail decision. Full prompts and the authorized export note are in [docs/PROMPTS.md](docs/PROMPTS.md).
- `lib/narrative-similarity.ts` implements deterministic token-set Jaccard with Unicode normalization, lowercase words, a fixed stopword list, and retained negations/numbers. Empty or stopword-only text returns 0. Its score is similarity, not fraud probability.
- `lib/models.ts` builds its record types from the supplied evidence/result types. `lib/mongodb.ts` provides a globally cached client, small serverless pool, typed collections, and index setup. Failed connections are cleared so later requests can retry.

## Vision counting convention

`fullMatchCount`, `partialMatchCount`, `similarCount`, and `pageCount` are the respective top-level Google result-array lengths. They are returned matches, not an exhaustive census of the web. A visually similar image is not automatically a duplicate.

`stockDomainMatchCount` counts full-match **image URL hosts** matching `STOCK_DOMAIN_ALLOWLIST`, including true subdomains. `nonStockFullMatchCount` is the remaining full-match count. Neither page matches nor visually similar matches are added to that count. The current list is used verbatim; no CDN aliases are silently added. Hosts such as `images.pexels.com` match `pexels.com`; `pexels.com.evil.example` does not. A page hosting a hotlinked stock image can have a different host from the image URL; these counts classify the image host only, and page domains remain visible for review. This is an explicit extraction convention to assess with the real photo set in Phase 3.

`pages` preserves Google's ordering and includes the first 10 URL/domain pairs, while `pageCount` counts the whole array. `domains` deduplicates hosts from all full, partial, similar, and page results, with non-stock full-match hosts first. Entities are sorted by Google's supplied score and capped at five; absent entity fields are `null`, never fabricated. Web entity scores are not restricted to 0–1. `bestGuessLabels` contains Google's label strings.

## MongoDB collections and retention

| Collection | Indexes beyond `_id` |
| --- | --- |
| claims | Unique `claimId`; partial unique user `clientRequestId`; user TTL |
| photos | Non-unique `sha256`; unique seed `filename`; unique user `claimId, slot` where slot exists; `claimId`; user TTL |
| vision_cache | Unique `sha256`; unconditional expiry TTL; no origin |
| decisions | `claimId, createdAt descending`; user TTL |
| audit_log | `claimId, createdAt descending`; user TTL |
| usage | Unique UTC `date, type`; unconditional expiry TTL; no origin |

User-origin claims, photos, decisions, and audits are stamped with `retentionFor("user")`: a BSON `Date` `expiresAt` exactly 14 days after `createdAt`. Their TTL indexes filter `origin="user"`; seed records omit `expiresAt`. Cache and global usage records have no origin and use unconditional expiresAt TTL indexes with a 14-day lifetime. All TTL indexes use `expireAfterSeconds: 0`. TTL deletion is asynchronous, so lookup reads exclude expired evidence. Do not extend retention on every read.

Seed photo bytes and thumbnails are MongoDB `Binary` fields; the CLI fingerprint limit remains 8 MiB. API uploads are capped at 4,000,000 bytes and retain only a JPEG thumbnail (maximum 320 pixels per edge), hashes, metadata, and server-created lookup evidence—never full uploaded bytes. No image-hosting service is used. Claims store the manually supplied `mappedPhotos` pair or null. Both API and CLI call `lib/lookup.ts`: cache by SHA-256, retain raw and extracted Vision server-side, re-extract raw evidence under an updated allowlist, or refresh legacy entries that cannot be reclassified. Every paid HTTP attempt atomically reserves global daily quota. Cache hits are free; `forceLive` bypasses them but never bypasses quota. `reset-user-data` never touches cache or usage; its exact scope is documented in the Phase 3 guide.

## Configuration

Required for the complete app: `GOOGLE_VISION_API_KEY`, `MONGODB_URI`, `GOOGLE_FORM_URL`, `GOOGLE_FORM_ENTRY_CLAIM_ID`, `GOOGLE_FORM_ENTRY_CLAIMANT`, `GOOGLE_FORM_ENTRY_LOOKUP`, and `GOOGLE_FORM_ENTRY_DECISION`. `MONGODB_DB` defaults to `claimguard`. Restrict the Google key to Cloud Vision API. Form URLs must be the full `https://docs.google.com/forms/.../viewform` URL; entry IDs accept numeric values or `entry.NUMBER`.

Optional together: `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL`. Use your selected provider's supported model; none is preselected. Verified bases:

- OpenAI: `https://api.openai.com/v1`
- Gemini compatible API: `https://generativelanguage.googleapis.com/v1beta/openai`
- An HTTP(S) base for an OpenAI-compatible local gateway also works.

Other optional settings: `ESCALATION_WEBHOOK_URL`, `DAILY_VISION_LIMIT` (200), `DAILY_LLM_LIMIT` (200), `DEMO_ACCESS_CODE`, `FORM_WEBHOOK_SECRET`. Limits accept zero to disable future paid calls. Webhook URLs must be HTTPS without credentials. Webhook and LLM endpoints cannot target Google Forms, and neither follows redirects. Data/operation API routes require `x-demo-access-code` when configured; public `/api/config` returns only the two booleans needed to show the code input and optional LLM controls. Values never appear in validation errors.

## Verification boundaries and remaining inputs

The suite checks supplied-file integrity, the export-only exception, mapping structure, original guardrail behavior, image hashes, Vision parsing/retry/deadline behavior, LLM fallbacks, environment validation, database connection recovery, index definitions, retention, shared cache/quotas, reset scope, and report arithmetic. Mapping tests now allow manually filled valid pairs or null entries, so completing the mapping does not require editing a test. Intentional future config tuning requires updating the recorded config integrity baseline alongside the reviewed change.

The repository contains the original packet, assignment brief, and `ClaimGuard_Photos_v2/`. They were read for Phase 3 context. The 36 JPEGs were copied intact into `data/photos/`; claims.json remains the supplied authoritative source and mapping.json remains human-authored. The generated contact sheet uses the daisyUI card markup and bundled styles without external requests or mapping hints.

Supplied Vision/MongoDB/Form settings were imported into the ignored .env. An initial Atlas login failed; a later intended dry-run invocation seeded the 18 claims and 36 photos after npm consumed the flag. That argument-forwarding issue is fixed and documented in the Phase 3 guide. Further live runs were left to the user, as requested. Remaining work: human-verified mappings, live Vision calibration, manual confirmation of Form email collection, optional provider selection, live end-to-end verification, and later assignment documentation/deck. Phase 5 UI checks used explicitly synthetic browser fixtures and mocked service tests. No live Vision/LLM results are claimed.

The form prefill includes exactly the four configured entries and prefill mode. Its lookup summary is single-line, at most 300 characters, and contains only per-photo findings. The human-submission audit step remains pending; the app has no completion action or form-submission path. Source scanning and route tests enforce that boundary.
