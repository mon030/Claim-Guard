# Local development environment

`.env` is the local runtime configuration. `.env.example` documents the names without credentials. `env_setup.md`, `.env`, and `tmp/` are ignored by Git. In Vercel, configure the same variable names in Project Settings and redeploy after changing them.

The setup helper `npm run env:setup` reads the supplied local notes and fills only empty values in an existing `.env`. It imports the Vision key, MongoDB URI, and five Google Form values. It never prints their secret values. To bootstrap a fresh checkout, copy `.env.example` to `.env` first. Existing nonempty settings are preserved, so edit `.env` directly to change credentials later.

MongoDB model API keys and Atlas database-user passwords are different credentials. `MONGODB_URI` needs the connection string from your Atlas deployment with a current database user authorized for the ClaimGuard database. URI-encode special characters in the username/password; leave the host list and connection options intact. The importer encodes credentials in the supplied URI without treating MongoDB's multi-host format as an ordinary web URL. Atlas must also allow your development machine's network address.

No complete LLM model/base configuration was provided, so `LLM_API_KEY`, `LLM_API_BASE_URL`, and `LLM_MODEL` remain empty. ClaimGuard's deterministic behavior does not depend on them. When selecting a provider, configure all three together using the verified compatible API base and an actual supported model name. Do not treat a bare service hostname as a confirmed chat-completions endpoint.

The Google key should be restricted to Cloud Vision API. The four Google Form entry IDs must be distinct and must refer to the four required questions, not an email question. `check-prefill` strips any pre-existing query parameters before adding the four approved entries. Google Forms itself collects the real human's signed-in email; the agent never pre-fills or submits it.

No `.env` values are included in this document, project reports, or committed source. Do not paste credentials into source code, chat output, screenshots, or the course deck.
