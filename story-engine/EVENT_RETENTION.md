# L99 Event Retention

L99 keeps recent operational events live for dashboards and compacts older correlated events into audit episodes.

## Goal

Keep the `events` table fast without losing the story of what happened during runtime, Lindymode, OODA, recovery, and release-gate chains.

## Policy

Default live window:

```text
7 days
```

Older events are eligible for compaction only when they carry a `correlation_id` in their payload.

## Safety rules

- Active Lindymode incidents are never compacted away by correlation ID.
- Events are inserted into `compacted_event_episodes` before deletion.
- Events without a correlation ID remain live.
- Failed compaction leaves live events untouched.
- Dry runs can be used to verify behavior without deleting events.

## Tables

### `event_compaction_runs`

Records each retention pass:

- `compaction_id`
- `status`
- `cutoff_at`
- `keep_ms`
- `compacted_groups`
- `deleted_events`
- `skipped_groups`
- `error`
- timestamps

### `compacted_event_episodes`

Stores one summary per compacted correlation chain:

- `correlation_id`
- `workspace_id`
- event count
- first and last event timestamps
- summary JSON

The summary includes event-type counts, mode counts, rollback count, average duration, and original event IDs.

## APIs

```text
GET  /api/events/retention/status
POST /api/events/retention/run
```

Example retention run:

```json
{
  "limit": 100
}
```

Example dry run:

```json
{
  "dry_run": true,
  "limit": 100
}
```

Override the live window:

```json
{
  "keep_ms": 604800000,
  "limit": 100
}
```

## Mission Control

Mission Control shows:

- live event count
- compacted episode count
- oldest live event
- eligible event count
- last compaction time
- retention trigger button

## Current boundary

This compacts events from the `events` table only. It does not compact active incidents, decisions, risk snapshots, recovery runs, runtime runs, or release audits.
