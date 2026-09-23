# Phase 5 — End-user interface

## Run it

1. Complete your ignored `.env` and the Phase 3 preparation steps. Never put keys in client code.
2. Run `npm run db:indexes` to add the new partial unique user-draft request index alongside the existing indexes. This is a real Atlas operation; it was not run during Phase 5 verification.
3. Map all 18 claims by eye, run `npm run check-mapping`, then `npm run seed`. Null mappings are deliberately disabled in the selector. Incomplete reference comparisons also block decisions on newly submitted claims.
4. Run `npm run check`, `npm run build`, then `npm run dev`. Open the local address shown in the terminal.
5. Choose an existing mapped claim, or enter a new claim's name, incident date, amount, and description. Date/amount were explicitly approved by the user as required factual inputs; location, category, customer email, and Claim ID are optional. Blank IDs are generated server-side as `MI-DEMO-####`.
6. For a new claim, choose 2–6 images, then **Run ClaimGuard check**. Inspect each photo and the timeline. Open the prefilled form yourself, sign in with your own Google account, and click Submit manually. Confirm “Collect email addresses” in the actual form's settings separately.

No login or admin view is added. The optional shared demo access code is kept in page memory only; it is sent in a header, including when loading thumbnails. Reloading clears the code, drafts, and original user files. No reference original is served publicly. The page has noindex/nofollow/noarchive metadata; robots.txt disallows all crawling. These are crawler instructions, not access control—set a demo code before exposing the course data if needed.

## Files

```text
app/
  page.tsx                       server entry point
  layout.tsx                     metadata and theme
  globals.css                    Tailwind v4 + daisyUI v5; contrast adjustments
  robots.ts
  api/
    claims/route.ts               list seed claims / create factual user claim
    config/route.ts               capability flags only
    suggest/route.ts              optional explicit identity extraction
    explanation/route.ts          optional explanation of a saved decision
components/
  claim-guard-app.tsx             one-page workflow
  claim-fields.tsx                factual inputs / description import
  photo-uploader.tsx              drag/drop, picker, queue and removal
  photo-preview.tsx               local or protected thumbnail Blob URLs
  evidence-card.tsx               evidence and force-live control
  results.tsx                     timeline, decision and human form handoff
lib/
  api/claim-contracts.ts
  client/
    api.ts                       requests and two-worker pool
    files.ts                     bounded ZIP and text/Word import
    images.ts                    original-byte hashing / large-image resize
    use-claim-guard.ts            workflow state and orchestration
tests/
  client-files.test.ts
  ui-api.test.ts
```

Existing lookup/decision handlers, photo contracts, form summary, models and indexes were extended in place; Phase 2/3 hashing, Vision, cache, quota, cross-claim comparison and LLM helpers are reused. The authoritative guardrail, config, tests, claims and manual mapping remain unchanged in Phase 5.

## Upload behavior

- ZIP extraction happens entirely on the device through a dynamic fflate import. Archives are bounded to 50 entries and 30,000,000 expanded bytes. The central directory is checked before allocation and streaming output is checked against the declared and actual limits. Encrypted, split, ZIP64, unsafe-path, duplicate-name and nested archives are rejected. Directories, platform junk, and non-image files such as README.txt are ignored as images but still count toward archive safety limits.
- Up to 50 candidate images can be displayed, within a combined 30 MB limit. More than six disables the check and asks the human to remove extras; the app does not silently pick a subset or map an archive to claims.
- JPEG/PNG/WebP files up to 3,000,000 bytes are hashed and uploaded unchanged. Larger files are decoded and downscaled to a maximum 1600-pixel long edge, encoded as JPEG, hashed after resizing, and marked `resized: true`. This changes byte identity; dHash remains useful for near-match comparison. The resized flag is metadata, not a new guardrail rule.
- A two-worker pool sends exactly one file per multipart lookup request, never a ZIP or a batch. No request exceeds the server's 4 MB image cap. SHA-256 returned by the server must equal the client hash of the sent bytes.
- The app waits for every started lookup. HTTP/storage failures prevent a decision request. An explicit unavailable Vision result remains evidence for the existing escalation policy, never a fabricated clean result. Force-live rechecks invalidate the previous decision/link and rerun the server decision once all evidence is available.
- Original user files remain in browser memory only. The API stores thumbnails and evidence, not user originals. Rechecking a user photo therefore reuploads its prepared bytes; seeded photos use JSON photo IDs.

TXT/MD/DOCX imports are plain text only, capped at 3 MB input and 10,000 output characters. DOCX containers receive the same archive-safety checks before dynamically importing Mammoth. No imported HTML is rendered. Imported descriptions append to existing text; exceeding the total character limit leaves the original text intact.

## API extensions

All handlers use the Node runtime and a ten-second maximum. Data/operation endpoints honor the existing optional demo-code header. `/api/config` is intentionally public and returns only `{demoAccessRequired, llmConfigured}`.

- `GET /api/claims`: seeded claim facts and mapped thumbnail IDs; missing mapping/seed data produces an explicit unavailable reason. No raw email body or original photo bytes are returned.
- `POST /api/claims`: strict JSON `{clientRequestId, claimId?, claimant, narrative, date, amount, location?, category?, customerEmail?}`. `clientRequestId` is a UUID used for retry idempotency, protected by a partial unique Mongo index. Repeating a request with changed facts is rejected. Existing seed/user IDs are never overwritten. User claims receive 14-day retention.
- `POST /api/lookup`: user slots now allow 1–6 and optional multipart `resized` (`true`/`false`). Seed JSON input remains unchanged. The approved response envelope adds `lookup.stockDomains`; `evidence` still exactly matches the team's `PhotoEvidence`.
- `POST /api/decide`: accepts at most six distinct user photo IDs; seed claims still require their exact two mapped photos. All evidence is rebuilt server-side. Summaries for more than two photos use compact per-photo labels to retain all six within 300 characters. No email is added to the form.
- `POST /api/suggest`: `{text}` only. Explicit button action; suggestion preview must be applied by the user and fills empty identity fields only. It never rewrites entered name/ID, date, amount, or narrative.
- `POST /api/explanation`: `{decisionId}` only. Loads the saved result server-side, never accepts a browser-supplied decision. The explanation cannot replace the deterministic decision. Both optional LLM routes reserve daily quota before a call and fall back deterministically when disabled, exhausted, or unusable. No extra LLM use is introduced.

The supplied guardrail loops over all photos for its web/cross-claim rules. Its existing within-claim N5 note compares only the first two photos. That logic and all thresholds remain untouched, as required; Phase 5 does not silently expand N5 to other pairs. Narrative comparison in `/api/decide` remains deterministic to bound request work.

## Verification and limits

All 176 tests across 21 files pass, together with strict type checking. Automated checks cover all original nine guardrail tests unchanged, original-file integrity, server/mock-Mongo route behavior including six user photos, Unicode narratives, retry idempotency, ZIP bombs/entry limits/nesting, byte preservation/resizing, plain-text import, two-worker concurrency, and optional explanation/quota fallbacks. Tests use no real service credentials.

Browser verification used Chrome through agent-browser 0.38.1 and a real Next.js 16.3.5 Turbopack development server. Next's live inspection endpoint reported no compilation or runtime errors. Service integration was **not live**: the development process used a loopback-only unreachable Mongo URI and zero provider budgets; browser claim/evidence/decision fixtures were explicitly synthetic. No `.env` changes, real Atlas calls, Vision calls, LLM calls, webhook calls, or Form submissions were made for Phase 5.

Verified in the browser: database-down feedback; mapped/unmapped selector behavior; claim details and protected thumbnail loading; new-claim required-field blocking; real browser Mammoth DOCX import preserving existing text; real fflate seven-photo ZIP extraction and manual reduction to six; six sequentially pooled single-image lookups with peak concurrency two; decision only after lookups; cached/live badges; forced recheck and escalation; daily-limit unavailable state; HTTP failure clearing the previous form link; copy summary; and human-only new-tab form-link attributes. The form link was inspected, never opened or submitted.

The 390px viewport has no horizontal overflow. React component-tree inspection confirms the server page/client interaction boundary. Browser accessibility checks found theme contrast issues, which were corrected through daisyUI semantic-color overrides and softer decision banners. Decorative component textures make some automated contrast readings indeterminate; a supplemental audit with those textures temporarily disabled reports 44 passes, zero violations and zero indeterminate checks on the six-photo result view. Browser snapshots under ignored `tmp/phase5-synthetic-*` are labeled offline synthetic UI tests and are not assignment evidence of real claims or Web Detection.

Remaining live checklist belongs to the team: real mapping and re-seeding, updated indexes, real cache/live Vision behavior and calibration, service failure handling against your configured deployment, optional provider compatibility, and manual Google account/Form submission. The slide deck and other later assignment deliverables are outside Phase 5.
