# L99 Release Gate

The Release Gate is the final authority before expensive operations execute.

## Statuses

```text
READY
WARNING
BLOCKED
```

## Blocking conditions

The gate returns `BLOCKED` when any of these are true:

- active Sev3 Lindymode incident
- unresolved continuity conflict
- latest autonomous runtime failed
- unsupported story schema version
- migration failure recorded within the last 24 hours
- three consecutive rolled-back recovery attempts

## Warning conditions

The gate returns `WARNING` when there are no blockers but one or more of these are true:

- confidence is below the configured threshold
- drift score is high
- runtime p99 exceeds the configured limit
- recovery validation is pending

The default confidence threshold is `75`.

The default p99 limit is `2000ms`.

## Ready condition

The gate returns `READY` only when there are no blockers and no warnings.

## APIs

Read the current gate without persisting an audit:

```text
GET /api/release/gate/:workspace_id
```

Persist a gate audit:

```text
POST /api/release/gate/:workspace_id/audit
```

Authorize an expensive operation:

```text
POST /api/release/authorize/:workspace_id
```

Example request:

```json
{
  "operation": "export",
  "allow_warning": true
}
```

## Response shape

```json
{
  "status": "READY",
  "confidence": 92,
  "reasons": [],
  "blockers": [],
  "warnings": [],
  "recommended_actions": [],
  "metrics": {
    "active_incidents": 0,
    "sev3_incidents": 0,
    "unresolved_continuity_conflicts": 0,
    "p99": 120,
    "rollback_rate": 0,
    "max_drift": 0,
    "runtime_status": "completed",
    "recovery_status": "validated",
    "schema_version": "1.0.0",
    "rollback_loop": false,
    "migration_failed": false
  }
}
```

## Events

Every persisted gate result emits one of:

```text
release_gate_ready
release_gate_warning
release_gate_blocked
```

The event payload includes the operation, audit ID, confidence, blockers, and warnings.

## Current integrations

Movie beat generation calls the Release Gate before doing work.

Future export, publish, render, and release routes should use `assertReleaseAllowed` from `lib/releaseGate.js` before starting expensive work.

## Warning policy

Warnings are allowed by default for Movie Mode. Callers can set `allow_warning` to `false` when they require strict `READY` status.
