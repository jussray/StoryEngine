# L99 Release Attempts

Release Attempts track expensive operations from authorization through completion.

## Lifecycle

```text
Release Gate audit
→ blocked
or
→ running
→ completed / failed
```

## Stored fields

- attempt ID
- workspace ID
- operation
- gate status and audit ID
- attempt status
- result JSON or error
- created and completed timestamps

## APIs

```text
POST /api/release/attempt/:workspace_id
GET  /api/release/attempts/:workspace_id
GET  /api/release/attempt/:attempt_id
POST /api/release/attempt/:attempt_id/complete
POST /api/release/attempt/:attempt_id/fail
```

`WARNING` requires `allow_warning: true`. `BLOCKED` records the attempt but does not execute the operation.

## Events

```text
release_attempt_started
release_attempt_blocked
release_attempt_completed
release_attempt_failed
```

## Movie Mode

Movie beat generation now creates an attempt, runs Release Gate, generates beats only when authorized, then records completion or failure.

Movie Mode currently creates a movie plan from chapters. It does not render video.

## Mission Control

Mission Control shows attempt totals and the latest attempt for each workspace.
