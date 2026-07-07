# Lindymode Event Producer Spec

## Goal

Extend the shared event bus so Lindymode emits long-horizon narrative continuity, state drift, and summary refresh signals into the same operational feed as revocation, rollback, poisoning, shadow-validation, and promotion events.

## Producer role

Lindymode is an event producer. It does not own dashboard state. It appends events to the shared `events.ndjson` feed, and dashboards derive views from that feed.

## Event types

Use dotted event names:

- `lindymode.state_drift_detected`
- `lindymode.summary_refresh_triggered`
- `lindymode.continuity_conflict`
- `lindymode.context_budget_breach`
- `lindymode.recovery_completed`

## Required shared fields

Each Lindymode event must use the shared event contract:

- `schema_version`
- `event_id`
- `event_type`
- `timestamp_utc`
- `tenant_id`
- `namespace = l99_lindymode`
- `severity`
- `status`
- `source_system = lindymode`
- `reason`
- `correlation_id`

## Recommended Lindymode fields

- `chapter_id`
- `arc_stage`
- `pov`
- `continuity_entity`
- `drift_score`
- `summary_window`
- `token_budget_state`
- `recovery_action`

## Severity guidance

- `info`: summary refresh completed or routine refresh triggered.
- `watch`: mild drift or approaching token-budget pressure.
- `sev1`: continuity conflict that can be repaired automatically.
- `sev2`: drift that blocks promotion or requires shadow validation.
- `sev3`: narrative-state corruption that triggers containment or rollback.

## Correlation rules

Generate a `correlation_id` when Lindymode detects the first safety-relevant narrative-state event. Reuse the same `correlation_id` for downstream summary refresh, recovery, rollback, or promotion events connected to the same incident.

Use `parent_event_id` when one event directly causes another.

## Example

```json
{
  "schema_version": "1.0",
  "event_version": 1,
  "event_id": "evt_lindy_001",
  "event_type": "lindymode.state_drift_detected",
  "timestamp_utc": "2026-07-07T10:12:00Z",
  "tenant_id": "tenant_alpha",
  "namespace": "l99_lindymode",
  "severity": "sev2",
  "status": "active",
  "source_system": "lindymode",
  "reason": "relationship_memory_diverged_from_arc_state",
  "correlation_id": "inc_lindy_alpha_001",
  "chapter_id": "chapter_12",
  "arc_stage": "rising_conflict",
  "pov": "first_person",
  "continuity_entity": "main_character_relationship_state",
  "drift_score": 0.82,
  "summary_window": "chapters_8_12",
  "token_budget_state": "near_limit"
}
```

## Core invariant

> Narrative-state drift is an operational event, not only an editorial issue.
