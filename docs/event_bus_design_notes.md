# Tenant-Aware Event Bus Design Notes

## Chosen priorities

The L99 event bus is optimized for:

1. Tenant-level filtering first.
2. Severity grouping second.
3. Correlation-based incident tracing third.

## Why tenant first

Multi-tenant operations usually begin with one question:

> Which tenant is affected?

Tenant-first filtering lets dashboards, CI artifacts, incident reports, and shadow-validation panels isolate a tenant before grouping events by severity or workflow.

## Why severity second

After a tenant is selected, operators need to know whether the tenant has active critical conditions.

Severity grouping should therefore expose:

- `sev3` containment events;
- blocked promotion events;
- failed shadow-validation events;
- stale-after-revoke events;
- poisoning suspicion events.

## Why correlation third

Correlation IDs connect related events after the tenant and severity scope is clear. A single incident chain can include revocation, invalidation, rollback, shadow validation, and promotion events.

## Recommended grouping metadata

Each event should include:

- `tenant_id`
- `severity`
- `status`
- `group_key`
- `correlation_id`
- `event_type`
- `namespace`

Recommended group-key examples:

```text
tenant:tenant_alpha
tenant:tenant_alpha:severity:sev3
correlation:inc_20260707_001
```

## Critical bucket rule

An event belongs to the critical bucket when any condition is true:

```text
severity == sev3
status == blocked
status == failed
event_type == poisoning.suspected
event_type == containment.started
```

## Dashboard behavior

Dashboards should support:

- tenant filter;
- severity filter;
- critical-only toggle;
- timeline grouping;
- severity grouping;
- correlation-chain view.

## Core invariant

> Scope first, urgency second, chain third.