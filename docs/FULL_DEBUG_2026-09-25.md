# ClaimGuard full local debug — 2026-09-25

This report records observations from the local development app and the configured Google Cloud Vision API. It is not a claim of fraud or an insurer decision. No Google Form was submitted, no guardrail threshold was changed, and no user-origin records were reset.

## Verification completed

- Manual mapping: 18 claims, two distinct files per claim, all 36 reference JPGs used exactly once.
- Seed preparation: 18 claims and 36 JPGs/hashes/thumbnails passed the dry run. An idempotent live seed check reported zero inserts and zero updates.
- Vision validation: the first pass had 34 available results, one Atlas usage-counter timeout and one Vision deadline timeout. The second pass had 36/36 available results, using the SHA-256 cache where present and making live requests for misses. See `vision-validation.txt` and `vision-validation.json` for per-photo evidence.
- Vision data: 31 distinct byte hashes; five byte-identical file pairs. No different-byte pair has dHash distance <= the current threshold of 6. Nine photo files have at least one non-stock full web match. IMG-026 is a valid zero-full-match result, not an unavailable lookup.
- Local API: `/api/claims` returned all 18 seeded claims ready; all 36 thumbnails returned JPEG with `X-Robots-Tag: noindex`; all 36 photo lookups returned usable evidence when run in six-claim batches under the 12-per-minute per-IP limit; all 18 corresponding decisions completed with pre-fill URLs.
- Browser: the Devon Price claim loaded both thumbnails, completed both cached lookups, showed the agent timeline and Auto-approve banner, and generated a link with the four configured pre-fill entries but no email entry. A rate-limit response displayed a clear retry action, and the next attempt succeeded after the rate window expired. No browser console errors were observed.
- Code: strict type check, 208 tests across 24 files, and production build passed. The nine original guardrail tests remain unchanged and pass.

## Decision sweep after successful lookups

| Claim | Outcome | Triggered rules |
| --- | --- | --- |
| MI-10234 | Escalate | E3 |
| MI-10235 | Auto-approve | — |
| MI-10236 | Escalate | E1 |
| MI-10237 | Auto-approve | — |
| MI-10239 | Auto-approve | — |
| MI-10240 | Escalate | E1 |
| MI-10242 | Auto-approve | — |
| MI-10243 | Auto-approve | — |
| MI-10244 | Escalate | E2, E3 |
| MI-10245 | Auto-approve | — |
| MI-10246 | Auto-approve | — |
| MI-10247 | Auto-approve | — |
| MI-10248 | Escalate | E1 |
| MI-10249 | Auto-approve | — |
| MI-10250 | Escalate | E1 |
| MI-10251 | Escalate | E3 |
| MI-10252 | Escalate | E2, E3 |
| MI-10253 | Auto-approve | — |

Totals: 10 Auto-approve, 8 Escalate, 0 Blocked. These are the current configured rule outputs, not verified ground-truth labels.

## Bugs and changes

1. For IMG-031, one non-stock full match was below the escalation threshold, but the supplied guardrail emitted a misleading “stock-photo source only” note. With user approval, the note now requires zero non-stock full matches. Decision thresholds and outcomes were not changed. A new regression test protects both the below-threshold non-stock case and the genuine stock-only case; source-integrity checks now allow exactly the two user-approved edits to `guardrail.ts`.
2. An Atlas timeout while reserving a paid Vision usage slot was being logged and returned as a Vision network failure. This now propagates as a retryable database 503 with a distinct server log category. Usage-counter operation timeouts were increased from 1.0 to 1.5 seconds without retrying the potentially ambiguous paid-slot increment. Regression tests cover both layers.

## Remaining limits and user checks

- Two `/api/claims` reads briefly returned retryable database 503 responses during this local run; immediate retries succeeded. The browser's single automatic retry path is covered by tests. This was not a repeatable image-specific failure. No Atlas access or security settings were changed.
- The Google-hosted form could not be inspected: browser safety review denied access to the broader `docs.google.com` origin while attempting to open the exact pre-filled link. The local URL-builder and human-only submission boundary are tested, but the live Form's current “Collect email addresses” setting and entry-ID alignment were not independently confirmed. A human should open the pre-filled link, check those fields and the email sign-in prompt, and submit only if desired.
- This Windows environment's Node `os.userInfo()` returns `uv_os_get_passwd`/`ENOMEM`, causing the pinned `tsx` CLI to fail before project scripts start. For this debug run, the same TypeScript script sources were bundled with the installed esbuild package and run with the same `.env` values. The npm script definitions were left as specified; this appears to be a local OS/runtime issue, not a TypeScript script failure.
- The current Vision key was used for this run. The teammate's replacement key has not been tested or added to `.env`.
- The current threshold values remain placeholders. Review the full-match cases and exact-pair mappings against the instructor's intended demo labels before deciding whether to tune them; do not infer fraud from web presence alone.
