# Phase 5.5 — diagnosis, changes and verification

## IMG-026: actual diagnosis

The official-client diagnostic returned a **successful** annotation, not a per-image error and not an empty result. Its second visually similar image used:

`x-raw-image:///416329f14da0de3147d392506f605f2df15b995be82a07da9e8bf86b107cb395`

The old parser required every image/page URL to be HTTP(S). That legitimate opaque identifier failed the nested URL schema, rejecting the entire response with our generic “invalid annotation response” message. The old code already checked per-image errors but hid their actual messages; that was not IMG-026's cause. The SDK also normalizes absent errors to null, which the old schema did not accept.

The diagnostic printed the complete raw annotation to the console, without credentials or image bytes. It contained **0 full matches, 1 partial match, 20 similar images, 15 matching pages**. These are observations, not calibration thresholds. After migration the actual `/api/lookup` request returned HTTP 200, status ok, source live, with the same image-match counts at **2026-09-24T03:04:57.136Z**. That request took **1,056 ms**. Raw annotations remain server-only.

A first API attempt timed out under the old route's reduced allowance (roughly 5.6 seconds). The post-Vision reservation is now 1.5 seconds rather than 3.5, retaining the ~10-second route and absolute eight-second Vision budgets. SDK initialization counts inside the deadline; transport timeout is recalculated after initialization. This is separate from the deterministic parser bug. True timeouts still produce unavailable, never zero-match success.

## Dependencies and implementation choices

- **@google-cloud/vision 6.1.0**: official `v1.ImageAnnotatorClient({apiKey, fallback: true})` and `batchAnnotateImages`; base64, one image, WEB_DETECTION, maxResults 50. No service account/ADC or new env variable.
- **p-retry 8.0.1**: bounded Mongo backoff and explicit Vision HTTP-5xx retry. SDK retries are disabled so every paid attempt reserves quota. No retry on 4xx, annotation, parser or network failures.
- **downshift 9.4.0**: headless `useCombobox` supplies keyboard/ARIA/disabled-option behavior; daisyUI supplies presentation. Avoids hand-maintaining accessibility even for 18 items.
- PDF uses `window.print()` and CSS. A small React FIFO queue uses existing daisyUI alerts; no new styling system or notification package is warranted for three visible toasts. No PDF dependency.

Stable versions were checked with npm. APIs were checked through Context7, official Google documentation, installed package types/source and the Next.js/daisyUI skills. Exact pins and lockfile are complete.

## Changes from Phase 5

| Files | Change |
| --- | --- |
| `lib/vision.ts`, `lib/vision.test.ts` | SDK migration; count opaque identifiers without linking; accept minimal successes/null errors; propagate per-image errors; log true code/status/message; deadline/quota/retry regressions. |
| `lib/mongodb.ts`, `lib/mongo-retry.ts`, their tests | Single client construction site; typed dev global and production module caching; explicit retryReads/retryWrites; failed-connect recovery; at most two retries with 100/200ms delays and budget checks. |
| `lib/lookup.ts` | Shared CLI/API path retained; bounded cache/reference database recovery; revised route time reservation. |
| API claims/lookup/decide/thumbnail/explanation routes; `lib/api/http.ts` | Retry safe database operations, classified Mongo logs, database 503 with `{error: "database_unavailable", retryable: true}`. |
| `lib/client/api.ts` | One automatic 600ms retry on retryable database 503 for claims/lookup/decide; recovery notification; force-live replay permits cache reuse. |
| `app/api/decide/route.ts` | Browser auto-retry retains an Idempotency-Key header. Deterministic IDs/upserts prevent duplicate decision/activity records after ambiguous acknowledgements; webhook remains outside DB retries. JSON input remains claimId/photoIds only. |
| `lib/claim-validation.ts`, claims API, fields/hook | Shared Zod amount >0 and <=MAX_CLAIM_AMOUNT (250000), inline errors, no clamping. |
| `components/claim-picker.tsx`, `components/how-it-works.tsx` | Search by ID/name, click-only dropdown, disabled unmapped entries; collapsed config-derived plain-language rules. |
| Evidence/result components | Distinct matches/zero/unavailable states; no reassurance on failed checks; claim context in print; PDF and client-only Start Over actions. |
| App component, client hook, toast hook/component | Manual Try again; full screen-state reset; queued, dismissible outcome/recovery toasts. |
| `app/globals.css` | Results-only printing, legible theme colors, reduced-motion support, dedicated bottom-right toast row that never overlays actions. |
| `components/photo-preview.tsx` | Manual thumbnail retry; the thumbnail route now retries transient DB failures too. |
| `tests/*`, `.gitignore`, README/spec/API notes | Regression coverage; user-approved removal of /tests ignore rule so tests can ship. Other pre-existing ignore edits preserved. |

Team guardrail logic/config/nine tests, claim data and manual mappings are unchanged. No database records were deleted. No Form submitted. No Atlas/IAM settings or secrets changed.

## Recovery safety

Driver defaults for retryReads/retryWrites are true in the installed MongoDB driver, now explicit in code. Application retries target transient categories/codes; auth/permission, explicit access rejection, duplicate-key and validation errors are not blindly retried. A timeout is not guessed to be IP rejection. Logs contain type/code/category, not credentials/topology/claim contents.

Usage increments retain driver retryable-write protection, without extra application replay of `$inc`. Resets retain usage/cache. A client replay can reuse the prior paid cache result. If cache persistence itself failed, a later lookup can spend another quota slot, still subject to the daily limit. No whole Vision/webhook workflow is wrapped in database backoff.

## Toast events

- Decision finished: approve, human review or blocked—the outcome matters.
- Unavailable photos: one consolidated warning, not one per sub-step.
- Successful automatic retry: tells the user the connection recovered.
- Print requested: directs the user to Save as PDF, never claims a file was saved.
- Start Over: confirms screen-only reset and unchanged database records.

Regular steps remain in the timeline. Maximum three visible messages, distinct overflow queued, identical pending notices coalesced. Each timer starts when visible and expires after 4.5 seconds; × dismisses early. A separate layout row shrinks the scrolling area rather than covering controls. Reduced-motion preferences remove notification/collapse animation.

## Verification and limits

Strict TypeScript and production build passed. All **204 tests across 23 files** passed. Tests cover SDK parsing/minimal responses/per-image errors, timeouts/retries/quota, Mongo recovery/hot reload, amount bounds, client replay, ambiguous audit writes and human-only submission. The nine original guardrail tests pass unchanged, enforced by byte-integrity tests.

The E4 regression sends a synthetic per-image failure through the real lookup handler, with mocked SDK/in-memory Mongo and no cache for that photo, plus a successful second lookup. The real decide handler returns Escalate/E4. Rendering the actual Results/EvidenceCard components verifies the red banner, unavailable warning and absence of reassuring copy on the failed card. No real API key was broken for testing.

Real browser checks: claims load; name filtering and ArrowDown/Enter selection; all 18 click-accessible options; mapped thumbnails; cached MI-10234 timeline/Escalate/pending human handoff; inline error at 250001; PDF action handler; Start Over clearing selection/results/draft; toast auto-dismissal. No browser warnings/errors were reported in that check. Live IMG-026 results are above. A generated PDF file and mobile print pagination were not independently inspected; check your browser's print preview before submission. All 36 photos were not re-run and thresholds were not calibrated in this phase.

## Handoff

Run `npm ci`, `npm run check`, `npm run build`, then `npm run dev`. No new credentials, indexes or mapping edits. Commit the tests and redeploy for production. Save as PDF uses the browser print dialog, not a one-click file download. Instructor originals remain outside public.
