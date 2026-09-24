# ClaimGuard Project Spec

## Latest: Phase 5.5 (supersedes earlier implementation/status notes)

Follow-up UI fix: thumbnail preview cleanup uses an inactive-request guard instead of aborting the fetch, so switching existing claims no longer surfaces Next.js's AbortError; object URLs are still released. The existing-claim picker is one vertical column. The UI uses daisyUI's caramellatte theme with larger radii and a warm green primary, plus a generated shield favicon (`app/favicon.ico`, sourced from `app/icon.svg`).

Follow-up UI fix: thumbnail preview cleanup uses an inactive-request guard instead of aborting the fetch, so switching existing claims no longer surfaces Next.js's AbortError; object URLs are still released. The existing-claim picker is one vertical column. The UI uses daisyUI's caramellatte theme with larger radii and a warm green primary, plus a generated shield favicon (`app/favicon.ico`, sourced from `app/icon.svg`).

Use official @google-cloud/vision 6.1.0 with API-key-only REST fallback, base64 images, eight-second total deadline and one HTTP-5xx retry; p-retry 8.0.1 accounts for every paid attempt. IMG-026's actual failure was a legitimate x-raw-image URL rejected by the old HTTP(S)-only schema, not quota or an empty result. Counts now preserve opaque identifiers while links/domains exclude them; minimal successful annotations and null error fields are valid, true failures log actual detail and remain unavailable. Live IMG-026 succeeded. Do not change team guardrail/config; E4 behavior is tested end-to-end through mocked routes and actual result rendering.

Atlas intermittent 503 root cause was resolved by the user (dynamic university IP vs narrow Atlas allowlist); do not re-investigate it. Add explicit driver read/write retries, typed development-global client cache, production module cache, one MongoClient constructor, bounded transient-operation backoff and clear classified logs. Browser claims/lookup/decide retry retryable database 503 once, then show a manual retry alert. Never replay usage increments or notifications in the DB wrapper.

UI adds Downshift 9.4.0 searchable claims, config-derived collapsed rule explanation, three distinct evidence states, results-only print CSS/PDF action, client-only Start Over (no DB deletion), shared Zod positive amount cap MAX_CLAIM_AMOUNT=250000, and daisyUI queued toasts (max3, 4.5s, manual dismiss, reduced motion, no overlap). Toasts cover outcomes, consolidated unavailable checks, retry recovery, print request and reset—not every step. No PDF/toast package. User approved including /tests in Git. Complete change/verification record: docs/PHASE5.5.md. No secrets/IAM/Atlas changes or Google Form submissions in this phase.

ClaimGuard is a BUAN 3301 (AI in Business) course project for the fictional Meridian Insurance. It must be a working end-user web app, not an admin dashboard, and should mirror the instructor's single-page flow: claim description/input, batch or ZIP photo upload, and a submit/analyze action. It must also let a user choose one of 18 existing claims.

## Required workflow

1. Map each of 18 claims to its correct two photos (36 unordered photos whose filenames contain no useful information). The team will identify mappings by looking at the actual images; the app and implementer must never guess or invent mappings.
2. For the selected/input claim, analyze its two mapped photos with real Google Cloud Vision Web Detection using base64 image content (never public image URLs or an image-hosting workaround) and report whether the photo or a visually similar image appears elsewhere.
3. Apply the supplied deterministic guardrail to produce `Auto-approve`, `Escalate`, or `Blocked` when required photos are missing. LLM assistance is optional; the complete workflow must work with no LLM configured.
4. Pre-fill a Google Form with Claim ID, Claimant Name, lookup findings, and decision. Google Forms "Collect email addresses" must be enabled, but the email field must never be pre-filled. A real signed-in human reviews and clicks Submit; ClaimGuard must never submit the form or fabricate an email.
5. Document the full prompts and provide a small presentation deck. Never invent results, metrics, mappings, or screenshots; missing material remains clearly marked TODO and is requested from the team.

## Fixed implementation choices

- Latest stable Next.js App Router (verified before implementation), strict TypeScript, Tailwind CSS v4 with CSS-based configuration, and daisyUI v5. Prefer daisyUI components throughout the UI.
- Next.js Route Handlers on the Node runtime, with each request doing one small unit of work and `maxDuration` around 10 seconds.
- MongoDB Atlas M0 via the official `mongodb` driver and a cached serverless client.
- `sharp`, `fflate`, browser-only dynamic `mammoth`, `zod`, `vitest`, and `tsx`, all pinned to exact verified stable versions.
- Google Cloud Vision REST Web Detection receives base64 image bytes.
- Optional provider-agnostic LLM client isolated in `lib/llm/client.ts`, using an OpenAI-compatible `POST {baseUrl}/chat/completions` request with bearer authentication, `model`, `messages`, and `response_format`. If a non-compatible provider is chosen later, only this file should change.
- Private GitHub repository deployed to Vercel Hobby with free/near-free services.

## Configuration

Local secrets live in git-ignored `.env`; only `.env.example` is committed. Production uses the same variable names in Vercel Project Settings and requires redeployment after changes. Secrets never use `NEXT_PUBLIC_`. `lib/env.ts` validates lazily with Zod and produces readable missing-variable errors. Data and service scripts run through `tsx --env-file=.env`; the favicon generator uses Node directly because it needs no configuration.

Required variables: `GOOGLE_VISION_API_KEY`, `MONGODB_URI`, `MONGODB_DB` (default `claimguard`), `GOOGLE_FORM_URL`, `GOOGLE_FORM_ENTRY_CLAIM_ID`, `GOOGLE_FORM_ENTRY_CLAIMANT`, `GOOGLE_FORM_ENTRY_LOOKUP`, and `GOOGLE_FORM_ENTRY_DECISION`.

Optional LLM variables (all-or-none): `LLM_API_KEY`, `LLM_API_BASE_URL`, and `LLM_MODEL`.

Other optional variables: `ESCALATION_WEBHOOK_URL`, `DAILY_VISION_LIMIT` (default 200), `DAILY_LLM_LIMIT` (default 200), `DEMO_ACCESS_CODE`, and `FORM_WEBHOOK_SECRET`.

## Delivery rules

Before code is written, verify current APIs and latest stable dependency versions using the installed Next.js/daisyUI skills, Context7 or authoritative package sources; pin exact versions in `package.json` and list them in the README. Preserve the human-in-the-loop boundary, test it, and clearly label all unavailable inputs as TODO.

## Phase 2 and authoritative team files

The user supplied `guardrail.config.ts`, `guardrail.ts`, `guardrail.test.ts`, and `claims.json` from `E:/Downloads`. The three TypeScript files belong directly in `lib/`; claims belong in `data/claims.json` and must not be re-derived. Preserve the supplied evidence/config types and all decision logic. Thresholds remain the team's placeholders until Phase 3 calibration. The user authorized exactly one exception to verbatim copying: add `export` to the existing `hammingDistanceHex` function signature and import/re-export only that helper from `lib/hash.ts`. Record this exception in `docs/PROMPTS.md`; keep all nine supplied tests unchanged.

Phase 2 implements lazy Zod env validation; cached MongoDB client and index setup; original-byte SHA-256 and grayscale 9x8, 64-bit dHash; Vision REST extraction with maxResults 50, an eight-second overall deadline and one HTTP-5xx retry; optional JSON-validated compatible LLM calls for identity extraction, narrative similarity, and explanations only; and deterministic token Jaccard fallback/cross-check. Exact dependency pins and API references are in README/docs. No end-user interface or form submission is implemented in this phase.

`data/mapping.json` must contain exactly the 18 supplied claim IDs, each set to null until the team manually identifies the photos. Required collections: claims (unique claimId), photos (non-unique sha256 and unique filename only for origin=seed), vision_cache (unique sha256), decisions, audit_log, usage. User-origin documents expire 14 days after creation through expiresAt TTL indexes; seed records persist. Photo bytes are modeled in the photo document so TTL removes bytes and metadata together; the earlier GridFS suggestion was tentative and is superseded by this model. The later uploader must enforce MongoDB document-size limits.

The repository also contains the original packet and a `ClaimGuard_Photos_v2/` folder with 36 JPEG filenames; Phase 2 did not re-parse or map these assets. Still needed: human-verified mappings, service credentials, form settings/entry IDs, live integration verification, and Phase 3 threshold calibration. Never fabricate these. Only the human may sign in and submit the Google Form.

## Phase 3

Read the provided env setup notes, instructor packet, and assignment brief for context; supplied claims.json remains authoritative. Copy only the 36 JPGs into data/photos outside public; ignore README.txt. Implement all scripts via tsx --env-file=.env: contact-sheet (offline, tmp/, filenames and images only), check-mapping (18 pairs, all 36 used exactly once), mapping-doc (docs/MAPPING.md from valid manual data), seed (null mappings warn and store mappedPhotos:null, hashes and thumbnails, idempotent seed upserts), validate-vision (cached shared lookup, text/JSON evidence, actual hash groups/distances/histogram), lookup (one-photo CLI evidence), check-prefill (URL only), and reset-user-data. Phase 4 /api/lookup must import lib/lookup.ts instead of reimplementing it.

The user clarified that vision_cache has no origin and is keyed by sha256; usage has no origin/claimId and is keyed by date+type. Both survive demo resets. Reset first captures origin:user claim IDs, deletes decisions/audit_log rows whose claimId is in that list, deletes origin:user photos, then deletes the captured user claims. Seed data and seed-claim decision/audit history are retained. Print deletion counts and "vision_cache and usage were left untouched". Cache and daily counters have their own 14-day expiresAt TTL indexes, without origin filters.

## Phase 4

Implement Node Route Handlers with maxDuration 10: POST /api/lookup (one multipart JPEG/PNG/WebP, claimId, slot 1/2, forceLive; OR JSON seeded photoId/forceLive), GET /api/photos/[id]/thumbnail, POST /api/decide (strict claimId/photoIds only). ZIP and batch extraction is browser-only Phase 5 work: never send a full ZIP/multiple images. Upload cap 4,000,000 bytes; whole multipart cap 4,400,000. Sharp validates real format/full decoding and caps pixels. Only seed originals remain in MongoDB: user uploads store hashes, a 320px JPEG thumbnail, slot, 14-day expiry and server-created lookup state, never full bytes. This supersedes the earlier generic photo-content model.

Reuse shared lib/lookup.ts for API and CLI. Cache by SHA, retain raw+extracted Vision server-side, return cache fetch time without quota, allow forceLive without bypassing daily limits, and label quota exhaustion unavailable/daily_limit. Every HTTP attempt reserves global usage atomically. Preserve the eight-second maximum Vision timeout, shortening within the API budget. Cross-claim matches use other non-null claim IDs and the unchanged threshold. No raw Vision response reaches the browser.

The user explicitly approved /api/lookup's `{ photoId, evidence, lookup, matches }` envelope: evidence is EXACTLY PhotoEvidence, while lookup holds fetch time/reason and matches holds claimant metadata unsupported by the team interfaces. Guardrail types and decide() must remain unchanged.

Decide reloads all records, recomputes cross matches and Vision evidence, and uses existing deterministic narrative similarity to avoid serial LLM calls within 10 seconds. Seed decisions require the actual manual mapped seed pair; user photos must occupy distinct slots. Incomplete reference mapping/comparison is rejected, not treated as no reuse. Fewer than two photos invokes original R0/Blocked with no prefill URL. Two-photo decisions prefill only the four configured entries; lookup summary is per-photo only, single line, <=300 chars with ellipsis truncation; decision is exactly Auto-approve/Escalate. No email is ever prefilled. Persist claim/lookup/guardrail(ruleHits)/prefill activities and a permanently pending human sign-in/Submit step. Optional escalation webhook is bounded, email-free and best effort; failures log without breaking the decision.

All APIs enforce x-demo-access-code only when configured. Lookup adds best-effort per-process/IP limits; global daily counters persist across resets. Thumbnails have private cache headers/noindex; no full-image route exists. Google Forms cannot be a webhook/LLM POST destination; redirects are refused. Vitest scans every source file for the prohibited form submission endpoint and tests handlers against mocked HTTP/in-memory Mongo. docs/PHASE4.md documents setup/contracts/verification and Phase 5 handoff. New indexes must be installed by the user with db:indexes; no live services were used in this phase.

Local .env settings were imported from ignored env_setup.md; optional LLM settings remain incomplete and disabled. The user explicitly chose to handle further live runs themselves. An intended dry-run verification seeded 18 claims/36 photos because npm consumed the flag; disclosed to the user, fixed by honoring npm_config_dry_run, and verified with explicit seed:dry-run/reset-user-data:dry-run aliases. Do not run further live validation without a new user request. No Vision calibration results or photo mappings were invented. Assignment deliverables also include a guardrail justification and requirements/wireframe document.

## Phase 5

Implement one responsive daisyUI end-user page: header, existing/new radio mode switch, description/factual inputs, browser photo upload, bottom Run ClaimGuard check, then timeline/evidence/decision/human form handoff. Existing claims display facts including customer email and only their two manually mapped thumbnails; disable unmapped options with reasons. User explicitly approved adding required incident date/amount, optional location/category/customer email to new claims. IDs are optional, generated server-side as MI-DEMO-####. Description TXT/MD/DOCX import uses dynamic browser Mammoth and appends plain text. Optional LLM suggestions require an explicit apply action and never overwrite typed identity fields.

New claims accept 2–6 photos, superseding Phase 4's two-user-slot restriction; seed claims still require exactly two. Browser fflate ZIP extraction caps 50 entries/30 MB expanded, ignores non-image/junk entries, rejects nested archives and dishonest sizes. Display candidates above six and require the human to remove extras; never silently choose or guess mappings. Preserve original bytes through 3 MB; larger files become max-1600px JPEGs with resized:true. Hash sent bytes; one image/request with concurrency two; wait for every lookup before calling decide. Retain no original user bytes server-side. Guardrail logic and thresholds remain unchanged, including N5's existing first-two-photo scope.

Add protected seed-list/user-create endpoints, an idempotent clientRequestId index, public capability flags without secrets, and optional suggestion/explanation routes using existing LLM helpers and quotas. Form summary still has only per-photo findings, <=300 chars; no email. Results show source/time, web counts/domains/stock flags, cross matches, force-live rechecks, reasons/notes, notification state, and permanently pending human submission. Use accessible labels/live status/focus, noindex metadata, and disallow-all robots. Full implementation and offline/synthetic verification boundaries are in docs/PHASE5.md. No additional live services are run; the user handles live verification and mappings.

## User-authorized mapping and live check — 2026-09-23

The user subsequently requested starting the real dev server, testing connections, and entering their groupmate's explicit 18 mapping pairs. This supersedes the earlier pause on live tests. All pairs are now in data/mapping.json, structurally validated and documented in docs/MAPPING.md; seed successfully updated 18 claims and 36 photos. No mappings were inferred. The user separately approved sending only IMG-010.jpg and IMG-013.jpg to Google Vision for this connection test, including possible normal API charges. Both UI lookups timed out; the safe E4 escalation and pending human Form handoff worked. Atlas authenticated and read/wrote successfully but also showed intermittent timeouts. Form prefill works, but observed email collection/sign-in settings need owner correction to Verified. LLM/webhook remain unconfigured. Full evidence and outstanding issues are in docs/LIVE_CONNECTION_CHECK.md. No Form submission, notification, threshold edit or remaining-photo upload was performed.
