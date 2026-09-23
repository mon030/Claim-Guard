# Live connection check — 2026-09-23

## Mapping applied

The user supplied the group's 18 claim/photo pairs. They were transcribed into `data/mapping.json` with `.jpg` extensions, without inferring any pair. `check-mapping` passed: two distinct photos per claim and all 36 files used exactly once. `mapping-doc` generated `docs/MAPPING.md`.

After an initial connection failure, the idempotent seed retry succeeded: 18 existing claims updated, 36 existing photos updated, no new claims/photos inserted. Index setup completed as part of successful seeding. The browser displayed all 18 claims as selectable, and MI-10234 loaded IMG-010.jpg and IMG-013.jpg as its mapped thumbnails.

## Connection results

| Boundary | Result | Evidence |
| --- | --- | --- |
| Local environment | Valid | Required integration configuration passed the app's validator; no values exposed. |
| Dev server | Running | `http://127.0.0.1:3000`, Next.js 16.3.5/Turbopack, real `.env`, no synthetic browser fixtures. |
| Atlas credentials/read/write | Working but intermittent | Ping and reads succeeded; seed updates succeeded; other attempts encountered server-selection/operation failures. This is not evidence of a wrong password. |
| App → claims/thumbnails | Passed | Claims and both selected thumbnail routes returned HTTP 200; images visibly loaded. |
| Google Vision Web Detection | Not verified successfully | User explicitly approved uploading IMG-010.jpg and IMG-013.jpg. Both UI lookups returned unavailable due to request deadlines. No successful web-match counts were returned. |
| Vision host reachability | Passed only at HTTP level | A separate unauthenticated GET received HTTP 404 in 104 ms. It sent no key/image and does not verify authentication or annotation performance. |
| CLI diagnostic retry | Blocked | One retry for approved IMG-010.jpg stopped with a database/setup operation failure before producing a lookup report. |
| Guardrail/decision/audit flow | Passed for unavailable evidence | `/api/decide` returned HTTP 200 and Escalate with E4 for each unavailable photo; persisted timeline includes pending human submission. This is not a finding of fraud or photo reuse. |
| Google Form prefill | Passed | HTTP 200; all four configured IDs present. Browser sample populated Claim ID, Claimant Name, lookup text and Escalate. No email parameter. |
| Google Form email collection | Needs owner action | Form page showed optional “Sign in to Google to save your progress,” no email field/collection notice, and an available Submit button while signed out. Verified account email collection is not enforced in this observed state. |
| Optional LLM | Not configured | All three LLM settings absent; deterministic mode remains available. |
| Optional adjuster webhook | Not configured | No notification sent. |

The second photo's initial lookup also encountered a reference-comparison failure. The later decision request successfully recomputed the server evidence and returned the safe unavailable-check escalation. Mapping is complete; a transient comparison error must not be mistaken for an unmapped dataset.

## Required follow-up

1. In the **Google Form editor**, choose **Settings → Responses → Collect email addresses → Verified**. Confirm signed-in account email collection manually; do not add email to the prefilled entry list. [Google's instructions](https://support.google.com/docs/answer/139706?hl=en).
2. Investigate intermittent Atlas connectivity and the Vision request timeout before recording a successful live demo. The current implementation has a three-second Mongo connection/server-selection timeout, one-second per-operation budgets in several API paths, and an eight-second maximum Vision deadline shortened to fit the ten-second route budget. No timeout, retry policy, credential, or guardrail threshold was changed during this check.
3. Retry the approved two-photo flow after resolving the latency issue. Run the 36-photo calibration separately when ready; this check did not upload the remaining 34 photos or fabricate a validation report.

## Verification boundaries

All 176 tests across 21 files pass after applying the manual mapping. Next's inspector reported no compilation/runtime errors before the live checks. Live API logs confirm lookup requests completed in approximately 6.7/7.6 seconds with explicitly unavailable web evidence, and the decision request completed in approximately 0.5 seconds.

No Google Form was submitted, no email was invented or prefilled, no webhook was called, no LLM was called, and no guardrail/config logic was edited. The dev server remains available for the user's next test. These observations supersede the earlier Phase 5 statement that live checks had not yet been run; they do not establish that Vision is working.

## Follow-up authentication and transport check — 2026-09-23

The user supplied a Google Cloud service-account key for `agents@claimguard-capstone.iam.gserviceaccount.com`. Its metadata matched the expected project and service account; the private key was not printed or copied into the repository. A temporary diagnostic made direct Web Detection calls with the previously approved `IMG-010.jpg`. Outside the Codex filesystem/network sandbox, the OAuth token exchange returned HTTP 200 in 105 ms, the service-account Vision call returned HTTP 200 with a Web Detection result in 784 ms, and the existing API-key Vision call returned HTTP 200 with a Web Detection result in 706 ms. No match counts were recorded by this diagnostic, and neither call flowed through the app's cache/database or decision pipeline.

The same diagnostic inside the sandbox could not connect to `oauth2.googleapis.com` (connection timeout); a plain Node GET to the Vision host also timed out there. This isolates the earlier *local tool sandbox's outbound network path* as a likely cause of those timeouts. It does not prove that every earlier app failure had that cause; Atlas/server timing can contribute too. The service account does not improve Vision latency here: both credential methods worked quickly on the unrestricted path. ClaimGuard remains configured for the restricted API key; no service-account secret was added to `.env`, `.env.example`, or source. `roles/mcp.toolUser` authorizes Google-managed MCP server calls, not direct Vision REST requests, and is not required for the current lookup implementation.

The service account's MCP Tool User role was selected in a Google Cloud IAM edit dialog. After the user confirmed the grant, the dialog was no longer visible; no saved role binding was verified. The computer-control safety reviewer rejected further IAM navigation/action, so the grant must be checked and, if necessary, saved by the user in Google Cloud IAM.
