# Shared Event Bus Format

## Goal

Define one operational event contract for revocation invalidation, rollback decisions, poisoning incidents, shadow-validation results, and threshold promotion outcomes.

Dashboards should not invent incident state. They should read it from the shared event stream.

## Priority order

The first live timeline slice prioritizes:

1. Tenant-level filtering.
2. Severity grouping.
3. Correlation IDs across incident chains.

This means operators first isolate the tenant, then surface the most urgent events inside that tenant scope, then trace related rollback, revocation, poisoning, and shadow-validation records through `correlation_id`.

## Core contract

Required fields:

- `schema_version`
- `event_id`
- `event_type`
- `timestamp_utc`
- `tenant_id`
- `namespace`
- `severity`
- `status`
- `source_system`
- `reason`

Recommended fields:

- `event_version`
- `group_key`
- `correlation_id`
- `partition_id`
- `policy_version`
- `model_version`
- `artifact_ref`

Optional action fields:

- `rollback_action`
- `invalidation_action`
- `promotion_action`

## Event vocabulary

Use dotted event names:

```text
revocation.triggered
cache.partition_invalidated
cache.semantic_hits_disabled
cache.semantic_hits_restored
rollback.started
rollback.completed
shadow.started
shadow.passed
shadow.failed
promotion.blocked
promotion.unblocked
poisoning.suspected
containment.started
containment.cleared
threshold.changed
threshold.rejected
incident.created
incident.updated
incident.closed
```

## Grouping model

Primary grouping:

```text
tenant_id
```

Secondary grouping:

```text
severity
```

Critical bucket:

```text
severity == sev3
OR status == blocked
OR status == failed
```

Dashboard group keys should use a stable format:

```text
tenant:<tenant_id>
tenant:<tenant_id>:severity:<severity>
correlation:<correlation_id>
```

## Correlation IDs

A single incident chain should share one `correlation_id` across related events.

Example:

```text
revocation.triggered
cache.partition_invalidated
cache.semantic_hits_disabled
rollback.started
shadow.started
shadow.passed
promotion.unblocked
```

All of those events can share `correlation_id = inc_123`.

## Dashboard rule

Dashboards may filter, group, and summarize events. They must not invent event state that is absent from the stream.

## Core invariant

> The event bus owns operational truth. Dashboards are views.