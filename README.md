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
- `schemas/shared_event_bus_schema.json` — shared operational event contract with schema versioning, parent links, correlation IDs, trace IDs, and Lindymode event types.
- `docs/shared_event_bus_format.md` — event vocabulary, grouping rules, and event-bus invariants.
- `docs/event_bus_design_notes.md` — tenant-first filtering, severity-second grouping, and correlation-chain strategy.
- `docs/correlation_ids.md` — incident-chain correlation and parent-event rules.
- `docs/events_live_feed_service.md` — append-only NDJSON live-feed service design.
- `docs/lindymode_event_producer_spec.md` — Lindymode producer contract for continuity drift, summary refresh, and recovery events.
- `runtime/lindymode_event_emitter.py` — Lindymode NDJSON event emitter.
- `samples/events.sample.json` — sample JSON event array for dashboards and tests.
- `samples/events.ndjson` — sample live-feed event stream including cache, revocation, containment, and Lindymode events.

## Core invariants

> Semantic similarity is never proof of authorization.

> Resolve isolation first. Search semantics second.

> Revocation beats TTL.

> The event bus owns operational truth. Dashboards are views.

> Narrative-state drift is an operational event.

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

## Event read model

```text
tenant_id first
severity second
correlation_id third
```

## Producer model

```text
Cache / Revocation / Rollback / Shadow / Lindymode producers
→ samples/events.ndjson
→ dashboards, CI gates, incident episode views, and replay tools
```

## Next implementation targets

1. Add a provenance decision evaluator.
2. Add boundary and revocation test fixtures.
3. Emit machine-readable decision, revocation, Lindymode, and incident artifacts.
4. Connect dashboards to `samples/events.ndjson` as the shared live feed.
5. Add an incident episode view that expands one `correlation_id` into a causal chain.
6. Add CI promotion gates for provenance, revocation, partition-boundary, event-schema, and Lindymode drift failures.
