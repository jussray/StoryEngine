# L99 Autonomous Runtime

The runtime connects the Story Engine into one correlated chain.

## Flow

```text
workspace change
-> Lindymode analysis
-> OODA decision
-> guarded recovery plan
-> reversible recovery
-> Lindymode validation
-> Story Genome refresh
-> predictive OODA
-> release audit
-> runtime ledger
```

Each run receives one `run_id` and one `correlation_id`.

## Safety

- Manuscript text is never changed automatically.
- POV and continuity conflicts require author approval.
- Only reversible strategies run automatically.
- Canonical state is captured before repair.
- A failed validation restores the prior state.
- Every step emits an event with the same correlation ID.

## Recovery strategies

- `raise_context_budget`: adjusts context capacity and validates again.
- `refresh_state_metadata`: refreshes safe canonical metadata and validates again.
- `resolve_after_author_fix`: records that author action is required and makes no manuscript change.

## Runtime ledger

The `autonomous_runtime_runs` table stores:

- trigger
- chapter
- ordered steps
- analysis
- OODA decision
- recovery result
- Story Genome version
- prediction
- release result

## APIs

```text
POST /api/runtime/run/:workspace_id
GET /api/runtime/run/:run_id
GET /api/runtime/runs/:workspace_id
```

Example request:

```json
{
  "chapter_id": 12,
  "trigger_type": "manual_runtime_run",
  "allow_recovery": true
}
```

## Event names

Runtime events follow:

```text
runtime.<step>.<status>
```

Examples include:

```text
runtime.lindymode_analysis.completed
runtime.ooda_decision.completed
runtime.recovery_plan.approved
runtime.recovery.validated
runtime.recovery.rolled_back
runtime.story_genome.refreshed
runtime.predictive_ooda.completed
runtime.release_gate.ready
```

## Module boundaries

- `lindymodeProcessor`: analysis
- `oodaProcessor`: incident collection
- `decisionEngine`: policy and release decisions
- `recoveryEngine`: guarded repair and validation
- `learningEngine`: episodes and prediction
- `storyGenome`: narrative fingerprint
- `autonomousRuntime`: orchestration and ledger
