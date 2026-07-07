# Shared events.ndjson Live Feed Service

## Goal

Provide one shared NDJSON event stream for OODA quality, shadow validation, revocation history, rollback automation, poisoning detection, containment, and promotion decisions.

## Feed shape

Use one JSON object per line. Each line must validate against `schemas/shared_event_bus_schema.json`.

Required fields per event:

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

- `correlation_id`
- `parent_event_id`
- `trace_id`
- `group_key`
- `partition_id`
- `artifact_ref`

## Service behavior

- Append new events to `events.ndjson`.
- Keep each event independently parseable.
- Preserve `correlation_id` across the full incident chain.
- Keep `trace_id` separate from `correlation_id`.
- Use `parent_event_id` for direct causal links.
- Use descriptive dotted event names.
- Let dashboards poll, tail, or stream the file for incremental updates.
- Do not mutate historical event rows; append a new correcting or closing event instead.

## Dashboard consumers

The same feed should power:

- OODA quality event panels;
- shadow-validation recovery panels;
- revocation history timeline;
- rollback automation views;
- poisoning detection views;
- correlation-chain detail view;
- CI promotion gate artifacts.

## Read model

Dashboards should derive views by filtering and grouping:

```text
tenant_id first
severity second
correlation_id third
```

Critical bucket rule:

```text
severity == sev3
OR status == blocked
OR status == failed
OR event_type == poisoning.suspected
OR event_type == containment.started
```

## Feed examples

```ndjson
{"schema_version":"1.0","event_version":1,"event_id":"evt_001","event_type":"revocation.triggered","timestamp_utc":"2026-07-07T10:00:00Z","tenant_id":"tenant_alpha","namespace":"story_state","severity":"sev2","status":"active","source_system":"revocation_controller","reason":"permission_revoked","correlation_id":"inc_alpha_001"}
{"schema_version":"1.0","event_version":1,"event_id":"evt_002","parent_event_id":"evt_001","event_type":"cache.partition_invalidated","timestamp_utc":"2026-07-07T10:00:05Z","tenant_id":"tenant_alpha","namespace":"story_state","severity":"sev2","status":"completed","source_system":"cache_controller","reason":"revocation_epoch_bumped","correlation_id":"inc_alpha_001"}
```

## Core invariant

> The feed is append-only operational truth. Dashboards are derived views.
