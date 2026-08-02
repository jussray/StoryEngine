# L99 Guardrails

These guardrails are implemented in `story-engine/lib/guardrails.js`, exposed through `/guardrails` and `/guardrails.json`, and verified with Playwright.

| ID | Requirement | Enforcement |
|---|---|---|
| `L99-ISOLATION-001` | Identity and tenant/workspace authorization resolve before semantic memory or cache reuse. | Existing security context and workspace enforcement; Playwright verifies protected API denial without credentials. |
| `L99-PROVENANCE-001` | Material outputs, events, and artifacts preserve source and lineage. | Guardrail registry requires provenance evidence and reports event-spine ownership. |
| `L99-REVOCATION-001` | Revocation outranks TTL and stale reuse. | Existing revocation policy; public snapshot marks revocation as a release invariant. |
| `L99-EVENT-001` | The event bus owns operational truth; dashboards are views. | Status surface exposes event-spine ownership and forbids dashboard authority. |
| `L99-CANON-001` | Human-locked canon and authority cannot be silently overwritten by models. | Guardrail registry and story-engine canon enforcement. |
| `L99-FRONTSTAGE-001` | Creator-facing pages do not expose operator-only machinery or credentials. | Existing page guard; Playwright checks creator entry and public guardrail surface for operator secrets. |
| `L99-RELEASE-001` | Promotion requires validation, proof, and rollback. | Existing release gates; status snapshot declares promotion authority and rollback requirements. |
| `L99-SECRET-001` | Provider, payment, notification, and operator credentials never appear in public responses. | Public snapshot is allowlisted; Playwright scans rendered and JSON output. |

## Public status surface

`GET /guardrails` and `GET /guardrails.json` expose only public-safe doctrine and implementation status. They do not expose API keys, tenants, workspace IDs, model credentials, payment secrets, notification credentials, private canon, or event payloads.

## Verification

```bash
cd story-engine
npm install
npx playwright install chromium
npm run test:guardrails
```

Playwright verifies the public guardrail status, secret minimization, creator-facing separation, and unauthorized API denial. It does not replace schema, partition, revocation, canon, or promotion-gate tests.