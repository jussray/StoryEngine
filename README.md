# L99

L99 is an AI runtime and operations layer focused on state integrity, provenance-safe semantic reuse, recovery, shadow validation, and observable promotion controls.

## Current foundation

- `policies/cross_user_leak_detection.md` — structural isolation and incident-response policy.
- `policies/cache_contract.schema.json` — machine-readable semantic cache entry contract.
- `policies/provenance_rules.json` — enforcement order, required matches, and promotion blockers.
- `docs/provenance_engine.md` — Provenance Engine architecture and decision model.
- `policies/multi_tenant_partitioning_strategy.md` — layered tenant/model/policy/namespace/user partitioning strategy.
- `schemas/isolation_envelope.schema.json` — machine-readable isolation envelope contract.
- `policies/cache_revocation_triggers.md` — events that invalidate cache partitions or scopes.
- `policies/semantic_cache_revocation_audit_requirements.md` — required revocation audit chain and dashboard fields.
- `runtime/partition_resolver.py` — deterministic isolation-envelope to partition-id resolver.

## Core invariants

> Semantic similarity is never proof of authorization.

> Resolve isolation first. Search semantics second.

> Revocation beats TTL.

## Request path

```text
Request
→ Identity Layer
→ Authorization Layer
→ Provenance Engine
→ Partition Resolver
→ Semantic Cache
→ Model
```

## Next implementation targets

1. Add a provenance decision evaluator.
2. Add boundary and revocation test fixtures.
3. Emit machine-readable decision, revocation, and incident artifacts.
4. Connect those artifacts to red-team, quality, and shadow-validation dashboards.
5. Add CI promotion gates for provenance, revocation, and partition-boundary failures.
