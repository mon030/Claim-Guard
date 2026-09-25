# ClaimGuard production deployment record

This is a **retrospective**, not a future deployment guide. It records the team's reported end-to-end production validation and the configuration visible in the repository as of 2026-09-25. Cloud-console settings and a human's Google Form submission cannot be proven from source code alone; no screenshots, secret values, quota numbers, or Form responses are invented here.

Production app: [claim-guard-mu.vercel.app](https://claim-guard-mu.vercel.app/)  
Repository: [mon030/Claim-Guard](https://github.com/mon030/Claim-Guard)

| Item | What was done and verified | Evidence boundary |
| --- | --- | --- |
| Vercel deployment | The team deployed the Next.js App Router app successfully and tested the user flow at the production URL. Required server-side values were set in Vercel Project Settings → Environment Variables. Changes to those values require a new deployment to take effect. | Team-reported live verification; exact dashboard values are intentionally absent here. |
| Atlas database and access | A dedicated Atlas database connection was configured, indexes created, and the seed run against the production MongoDB database. Atlas Network Access was set to `0.0.0.0/0` because Vercel Hobby's outbound IPs are dynamic; the team reports production became stable afterward. | Team-reported production seeding/connectivity. `0.0.0.0/0` permits attempts from any IP, so narrow DB permissions and strong credentials remain necessary. |
| Local 503 root cause | Earlier intermittent local database 503s occurred while developing on a university network whose public IP changed against a narrow Atlas allowlist. The team also ruled out sustained MongoClient leaks and a matching Atlas primary-election event. | Historical team/debug finding; not a current production failure. |
| Reference data | The production seed loaded the team's manually mapped 18 claims and 36 instructor reference JPGs; originals remain outside `public/`, with thumbnails stored for the UI. | Team-reported production seed. `data/claims.json`, `data/mapping.json`, `data/photos/`, and seed logic are present in the repository. |
| Deployed APIs | The team exercised `POST /api/lookup` and `POST /api/decide` against the deployed URL and saw real evidence/decision output, not just local fixtures. The server recomputes evidence before `decide()`. | Team-reported live checks; no claim-specific production output is reproduced without a saved artifact. |
| Google Form handoff | The real pre-filled Form link was tested end-to-end by the team. It contains Claim ID, Claimant Name, lookup summary, and decision; the Form collects the human's email after sign-in. The app never posts a Form response or invents an email. | Human-side production check reported by the team; the repository enforces only the four-field prefill and human-only boundary. |
| Vision key and quota | The team confirmed the key is restricted to Cloud Vision API and a Google Cloud Vision quota cap is configured. The deployed app calls Web Detection through the official `@google-cloud/vision` client using image bytes, with SHA-256 caching and its own daily limit. | Restriction/quota are team-reported cloud-console settings; code behavior is repository-verifiable. No exact Google quota value is claimed. |
| Billing alert | The README explains how to set a budget alert and that it is **not** a hard spending cap. | Alert creation was not separately attested in the request; this record does not mark it verified. |

The production environment does **not** need a service-account JSON file for this Vision integration: the current client uses `GOOGLE_VISION_API_KEY`. The optional LLM can remain unconfigured; deterministic fallbacks still run. User-origin records expire after 14 days, while `reset-user-data` is a manual demo utility and was not part of this deployment verification.

For reproducible local checks and earlier observed counts, see [FULL_DEBUG_2026-09-25.md](FULL_DEBUG_2026-09-25.md). Those local observations should not be presented as production measurements. For API behavior, see [PHASE4.md](PHASE4.md); for the UI and human Form handoff, see [PHASE5.md](PHASE5.md).
