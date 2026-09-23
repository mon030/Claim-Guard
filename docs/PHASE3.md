# Phase 3 scripts and run order

All scripts in this guide run through `tsx --env-file=.env`. Work from the repository root. The local `.env` and `env_setup.md` are ignored by Git. The instructor's 36 JPEGs have been copied byte-for-byte to `data/photos/`; `README.txt` is ignored. Photos never belong in `public/`.

## Before completing the mapping

1. **Run `npm run contact-sheet` first.** Open `tmp/contact-sheet.html` locally. It contains the 36 images and filenames, with no claims, guesses, descriptions, reuse flags, or pairing hints. Images and daisyUI styles are embedded, so it works offline without external assets. The `tmp/` directory is ignored by Git.
2. Run `npm run seed:dry-run` to decode all 36 JPEGs, compute their hashes/thumbnails, and validate the input files without a database connection. Null mappings produce warnings rather than a crash.
3. Configure the real `MONGODB_URI` and `GOOGLE_VISION_API_KEY` in `.env`. The local setup importer already copied the supplied Vision, database, and Form fields. Optional LLM configuration remains disabled because no complete compatible base URL/model was provided. See [ENVIRONMENT.md](ENVIRONMENT.md).
4. Run `npm run seed`. It creates indexes and upserts 18 claims and 36 photos. Claims with null mappings have `mappedPhotos: null`; their reference photos have `claimId: null`. Repeated filenames are keyed by `(origin=seed, filename)`, not by SHA-256, preserving legitimate identical reference files. Existing user records are never overwritten by seed upserts. Rerunning updates seed data/associations but preserves creation times.
5. Run `npm run validate-vision`. Mapping is not required. This can also run before seed: it creates its cache/usage indexes and compares all file hashes locally, though cross-claim reference coverage will be absent until seed runs. Expect real Vision requests on cache misses; each HTTP attempt, including a retry, reserves one daily quota slot.
6. Run `npm run check-prefill`. This prints a clearly labeled manual-test URL. Verify the four Form fields, signed-in email collection, and human-only submission. The script sends no request and submits nothing. Never treat the sample values as lookup evidence.

`npm run check-mapping` is expected to fail while any mapping is null. It describes missing/unknown claim IDs, invalid pairs, nonexistent files, repeated filenames, and unused photos. It validates structure, not whether the team's visual interpretation is correct.

## After the team fills data/mapping.json

Replace each null with an array of exactly two distinct existing JPG filenames, based on your team's visual review. Every reference file must appear once across the whole mapping. Then run:

```sh
npm run check-mapping
npm run seed
npm run mapping-doc
npm run lookup -- ./data/photos/IMG-001.jpg
npm run check-prefill
```

The example lookup filename is just an input example, not a claim-mapping hint or an assertion that this particular photo is reused. Select actual evidence based on the real report. Re-seeding applies the manual associations, so the single-photo CLI can name matching claims and exclude the input's own claim. `mapping-doc` writes `docs/MAPPING.md` only after complete validation; on invalid input, it fails without replacing an existing mapping document.

Run `npm run validate-vision` again whenever useful. Successful, unexpired evidence for the same byte hash and stock-domain allowlist comes from `vision_cache`. A changed allowlist triggers a refresh; changing dHash or escalation thresholds does not itself require repeating Vision requests. Threshold values remain entirely under the team's control.

## Reports and shared lookup service

`lib/lookup.ts` exports `lookupPhoto`, the shared entry point both CLI scripts use and the Phase 4 `/api/lookup` handler must import. It uses the Phase 2 hash and Vision modules, plus `lib/usage.ts` for atomic daily reservations. It never assigns photos to claims or calls `decide()`.

`validate-vision` prints per-photo progress and the final report, and checkpoints these files after every photo:

- `docs/vision-validation.txt`: readable match counts, top domains, byte-identical file groups, near-duplicate candidates at the current threshold, a 0–64 dHash distance histogram, and photos with non-stock full matches.
- `docs/vision-validation.json`: the extracted fields for every lookup, provenance (`live` or `cache`), evidence timestamps, errors/warnings, all unordered pair distances, full domain frequency data, and the config snapshot.

The histogram includes all unordered pairs, including byte-identical pairs. Near-duplicate candidates exclude byte-identical pairs, which are listed separately. Top domains report both file counts and distinct SHA-256 image counts to avoid confusing multiple filenames with distinct web evidence. Match counts come only from returned Vision results. Missing/failed lookups are `UNAVAILABLE` with null Vision data, not zero-match successes. An interrupted run leaves an honestly labeled partial photo count. Any unavailable lookup makes the command exit nonzero while preserving the report.

`lookup` prints a full JSON report and writes `tmp/lookup-report.json`, including hashes, extracted Vision fields, checked time, cache provenance, reference matches, cross-claim matches, and reference coverage. Before mapping, matches can be identified by filenames but claim IDs/dates remain null. For an arbitrary file outside `data/photos`, claim association is explicitly unknown; the report does not infer it from the name. Failed or incomplete reference checks must not be interpreted as a clean claim in Phase 4.

No real Vision output files are shipped before a real validation run. The report-generation code is complete; the absence of results is not replaced by fabricated data.

## Reset between demos

Use the explicit dry-run alias to preview the scope, then execute the reset when you want those demo records removed:

```sh
npm run reset-user-data:dry-run
npm run reset-user-data
```

Reset first captures IDs from `claims` with `origin: "user"`. It then deletes decisions and audit entries with those IDs, deletes photos with `origin: "user"`, and finally deletes the captured user claims. It leaves all seeded claims/photos, decisions/audits for seed claim IDs, `vision_cache`, and `usage` untouched. Deletions are permanent in the database; the script prints counts by collection and the exact confirmation `vision_cache and usage were left untouched`. Stop demo activity while resetting to avoid concurrent writes creating new dependent entries during reset.

Both `seed` and `reset-user-data` also accept `--dry-run`. Windows PowerShell's npm wrapper can consume that flag as an npm option, so the scripts honor `npm_config_dry_run` too. The explicit `seed:dry-run` and `reset-user-data:dry-run` aliases embed the flag in the script command and are the most direct cross-shell invocation.

## Cache, quotas, and retention

Per the Phase 3 clarification, `vision_cache` and `usage` have no `origin` field. Cache is content-addressed by unique SHA-256; its expiresAt is 14 days after the successful lookup. Cache reads exclude expired/malformed/incompatible evidence even before asynchronous TTL cleanup. Usage is a global unique `(date, type)` counter, where date is UTC YYYY-MM-DD and type is `vision` or `llm`; counter records age out after 14 days. Reset cannot restore today's quota. Cache hits do not reserve another Vision slot. Failed network attempts count, and each 5xx retry reserves a second slot. No quota reservation means no Vision request.

Claims, photos, decisions, and audit records retain their Phase 2 user-origin expiry rules. Seed photo content and thumbnails are BSON Binary fields in the same document. Input bytes are capped at 8 MiB, comfortably below MongoDB's document-size limit with thumbnail/metadata overhead. No image URLs are sent to Vision.

## Verification performed

The original nine guardrail tests remain unchanged. The expanded offline suite covers cache reuse/invalidation, exact and near matches, incomplete mappings, reset filters and deletion order, quota reservations and retry accounting, report arithmetic, and Form URL encoding/email exclusion. The real 36 files decode and produce thumbnails/hashes successfully; the contact sheet contains exactly 36 embedded images and no external image/stylesheet requests.

One verification invocation intended as a dry run was consumed by npm as its own flag and seeded 18 claims and 36 photos. This was disclosed immediately; flag handling was corrected and then verified with the explicit offline alias. No reset was executed and no live Vision lookups were run. The user chose to perform further live verification themselves.

The assignment brief also calls for a guardrail justification, working lookup evidence, and a requirements/wireframe document. These and the course deck remain later deliverables; the scripts do not use the packet to populate mappings.
