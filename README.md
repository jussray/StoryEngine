# L99

L99 is an AI runtime and operations layer focused on state integrity, provenance-safe semantic reuse, recovery, shadow validation, and observable promotion controls.

## Current foundation

- `policies/cross_user_leak_detection.md` — structural isolation and incident-response policy.
- `policies/cache_contract.schema.json` — machine-readable semantic cache entry contract.
- `policies/provenance_rules.json` — enforcement order, required matches, and promotion blockers.
- `docs/provenance_engine.md` — Provenance Engine architecture and decision model.

## Core invariant

> Semantic similarity is never proof of authorization.

## Request path

```text
Request
→ Identity Layer
→ Authorization Layer
→ Provenance Engine
→ Semantic Cache
→ Model
```

## Next implementation targets

1. Add a provenance decision evaluator.
2. Add boundary and revocation test fixtures.
3. Emit machine-readable decision and incident artifacts.
4. Connect those artifacts to the red-team and quality dashboards.
5. Add CI promotion gates for provenance and revocation failures.
