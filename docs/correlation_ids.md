# Correlation IDs for Incident Chaining

## Goal

Trace one incident across revocation, rollback, poisoning, containment, shadow-validation, and promotion events.

## Required and recommended identifiers

### `correlation_id`

Application-level incident chain identifier. It must be shared across every event that belongs to the same safety-relevant incident.

### `parent_event_id`

Direct causal link to the event that triggered the current event. Use it when one event immediately causes another.

### `trace_id`

Optional infrastructure-level identifier for broker hops, service spans, or distributed tracing systems. Keep it separate from `correlation_id`.

## Usage rules

1. Generate a new `correlation_id` at the first safety-relevant event in the chain.
2. Reuse that `correlation_id` in every downstream event artifact.
3. Use `parent_event_id` when one event directly causes another.
4. Keep `trace_id` separate from `correlation_id`.
5. Do not create a new `correlation_id` for downstream rollback, containment, shadow, or promotion events that are part of the same incident.

## Example chain

```text
evt_001 incident.created
  ↓
evt_002 revocation.triggered parent_event_id=evt_001
  ↓
evt_003 cache.partition_invalidated parent_event_id=evt_002
  ↓
evt_004 promotion.blocked parent_event_id=evt_003
  ↓
evt_005 shadow.started parent_event_id=evt_004
  ↓
evt_006 shadow.passed parent_event_id=evt_005
  ↓
evt_007 promotion.unblocked parent_event_id=evt_006
```

Every event above shares the same `correlation_id`.

## Dashboard behavior

Dashboards should support:

- tenant filtering first;
- severity grouping second;
- correlation-chain expansion third;
- parent-child event rendering when `parent_event_id` is present.

## Core invariant

> One incident, one correlation ID.