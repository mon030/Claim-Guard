# Verified API references

## Phase 5.5

New npm stable pins: @google-cloud/vision 6.1.0, p-retry 8.0.1, downshift 9.4.0. Context7 resolved `/sindresorhus/p-retry`, `/downshift-js/downshift`, and `/mongodb/node-mongodb-native` and verified retry callbacks/options, useCombobox prop getters/disabled items, and driver retry behavior. The Google-specific search required official docs plus installed declarations/source to confirm API-key-only auth.

- [Google ImageAnnotatorClient](https://docs.cloud.google.com/nodejs/docs/reference/vision/latest/vision/v1.imageannotatorclient-class): constructor and batch API; installed 6.1.0 confirms `apiKey` with REST fallback, no service account.
- [Google GAX](https://github.com/googleapis/gax-nodejs): installed CallOptions accepts `timeout`, `retry: null`; fallback errors preserve `httpStatusCode`, distinct from gRPC code. SDK initialization precedes the transport deadline, so the app recalculates remaining time afterward.
- [p-retry](https://github.com/sindresorhus/p-retry): retries/minTimeout/factor/shouldRetry/onFailedAttempt/signal. AbortSignal alone does not interrupt an in-flight promise; the app retains a wall-clock race and SDK transport timeout.
- [Downshift useCombobox](https://github.com/downshift-js/downshift/tree/master/src/hooks/useCombobox): controlled inputValue/selectedItem, getInputProps/getItemProps/getMenuProps/getToggleButtonProps and isItemDisabled.
- [MongoDB driver](https://github.com/mongodb/node-mongodb-native): installed 7.6.0 connection_string source defaults retryReads/retryWrites to true; both are explicitly set in ClaimGuard.

The installed daisyUI skill supplied toast/alert/collapse/menu/input/validator classes; Next.js bundled docs and skills guided route/client boundaries. See [PHASE5.5.md](PHASE5.5.md) for real vs mocked verification.

Verified during Phase 2 on 2026-09-21. Exact dependency versions were resolved with `npm view PACKAGE@latest name version engines peerDependencies --json`, then installed with a committed lockfile. The checked APIs were also verified through Context7 or the installed skills before implementation.

- [sharp resize](https://sharp.pixelplumbing.com/api-resize/): explicit width/height, `fit: "fill"`, `kernel: "lanczos3"`.
- [sharp raw output](https://sharp.pixelplumbing.com/api-output/#raw): row-major raw pixels; `toBuffer({ resolveWithObject: true })` supplies dimensions and channel metadata.
- [MongoDB Node driver connection pools](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/): pool sizing, idle connection management, and sharing the client.
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/): BSON dates and absolute expiration with `expireAfterSeconds: 0`; expiry is asynchronous.
- [MongoDB partial indexes](https://www.mongodb.com/docs/manual/core/index-partial/): equality filters and unique constraints restricted to matching documents.
- [Zod APIs](https://zod.dev/api): strict objects, refinements, safe parsing, and runtime output validation.
- [Google Vision images:annotate](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate): REST endpoint and request envelope.
- [Google Vision Web Detection response](https://docs.cloud.google.com/vision/docs/reference/rest/v1/AnnotateImageResponse#WebDetection): full/partial/similar images, pages, entities, labels, and per-image errors.
- [OpenAI chat completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): compatible endpoint, messages, JSON response mode, choices, and completion status.
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai): verified `/v1beta/openai/` base path; model is user-configured.
- [Vitest mocking](https://vitest.dev/guide/mocking.html): fetch stubs, environment/global restoration, and fake timers.
- [daisyUI installation](https://daisyui.com/docs/install/): Tailwind v4 CSS-based plugin setup for the forthcoming UI.
- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route): Node runtime and App Router conventions for later request orchestration.

Phase 3 additionally checked the MongoDB driver's updateOne/upsert, $setOnInsert, findOneAndUpdate return behavior, and deleteMany APIs through Context7, along with sharp thumbnail sizing and JPEG output. No dependencies were added or version pins changed. Code is checked against the installed exact packages with strict TypeScript and Vitest. Documentation checks do not constitute live Vision/LLM verification; actual local and seed verification is recorded in PHASE3.md.

Phase 4 (2026-09-22): all 18 stable npm versions were reconfirmed and still match the exact pins. Context7 lookup requests failed to connect. The installed Next.js skill and its route-handler, async-params and runtime references were read; official documentation supplied the fallback API checks:

- [sharp input metadata](https://sharp.pixelplumbing.com/api-input/): decoder format, dimensions and pages; metadata alone is not full pixel decoding.
- [sharp resize](https://sharp.pixelplumbing.com/api-resize/): inside fit and withoutEnlargement for 320px thumbnails.
- [MongoDB compound operations](https://www.mongodb.com/docs/drivers/node/current/crud/compound-operations/): findOneAndUpdate with returnDocument after and includeResultMetadata false.
- [Next.js TypeScript](https://nextjs.org/docs/app/api-reference/config/typescript): generated route types, next typegen, and generated next-env.d.ts.
- [Vitest mocking](https://vitest.dev/guide/mocking.html): mocks, HTTP stubs and timer-based timeout checks.

The production build exposed a CLI filesystem dependency in the shared lookup import graph; error types/sanitization now live in a filesystem-independent module, preserving one lookup implementation for CLI and API. Production compilation and offline route tests passed; no live integration run was performed.

Phase 5 (2026-09-22): Context7 successfully verified fflate's `Unzip`/`UnzipInflate`, `start`, `ondata`, `originalSize`, and termination APIs, plus Mammoth's browser `extractRawText({arrayBuffer})` API. The corresponding exact package declarations were inspected, and the fflate/Mammoth/daisyUI stable pins were reconfirmed without changes. Sources: [fflate](https://github.com/101arrowz/fflate) and [Mammoth](https://github.com/mwilliamson/mammoth.js). The installed daisyUI skills supplied the pinned v5 component markup, semantic color rules and CSS-only theme override configuration. The installed Next.js skills and bundled 16.3.5 server/client and Route Handler guides supplied the App Router conventions. Strict typing, a production build, real-browser DOCX/ZIP processing, and the live Next.js compilation/runtime inspector checked these integrations; external services remained mocked or disabled.
