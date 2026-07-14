# L99 — MCP and GitHub Models

L99 uses AI tooling to inspect evidence and pressure-test contracts. No model output may weaken tenant isolation, authorization, provenance, revocation, approval, rollback, or event truth.

## MCP servers

- **GitHub:** repository, pull-request, Actions, and security evidence with lockdown mode.
- **Playwright:** pinned isolated Chromium for local HTML dashboards and live-feed presentation verification.

Figma, Supabase, and Cloudflare production MCP servers are intentionally absent because they are not verified authorities for this repository.

## GitHub Models

GitHub Models is used for synthetic provenance, revocation, incident, and promotion-gate evaluation.

- The manual workflow uses the automatic `GITHUB_TOKEN` with only `contents: read` and `models: read`.
- Local or Codespaces use may store a fine-grained `models:read` PAT as `GITHUB_MODELS_TOKEN`.
- Never commit a token.

Allowed inputs are invented isolation envelopes, synthetic cache candidates, fabricated event chains, and public schema examples. Do not send real tenant or workspace identifiers, customer content, private prompts, credentials, production event payloads, cache values, or cross-project private data.

The model is advisory. Deterministic policy, schemas, runtime gates, and executable evidence remain authoritative. Semantic similarity is never proof of authorization; revocation beats TTL; missing provenance fails closed.
