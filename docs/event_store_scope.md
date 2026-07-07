# Registry Schema-Evolution Event-Store Scope

## Goal

Define what belongs in the L99 event store for RiverEditor registry evolution, style-chain execution, rollback audit, anomaly alerts, and tier-level aggregation.

Event-sourced systems work best when meaningful state transitions are recorded as immutable events instead of inferred after the fact.

## Include

The event store should include:

- registry validation events;
- migration applied events;
- migration blocked events;
- chain execution events;
- rollback events;
- anomaly alert events;
- audit aggregation events by tier;
- schema-version health events;
- unsupported-registry block events;
- L99 latency window events.

## Exclude

The event store should exclude:

- ephemeral UI hover state;
- local-only debug traces with no operator value;
- duplicate denormalized summary rows that can be derived from canonical events;
- raw draft content unless explicitly required for a separate audited workflow;
- noisy per-keystroke editor activity.

## Why this scope works

The store should preserve operationally meaningful transitions while avoiding UI noise. This keeps enough history to analyze:

- rollback frequency by profile tier;
- migration health by schema version;
- L99 latency by command chain;
- unsupported-registry block concentration;
- chain failures after migration;
- anomaly patterns by tenant, tier, schema version, and cache state.

## Canonical event families

```text
registry.*
style_chain.*
rollback.*
anomaly.*
audit.*
latency.*
shell.*
lindymode.*
```

## Core invariant

> Store meaningful transitions, not UI noise.
