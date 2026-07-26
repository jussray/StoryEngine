# Founder Truth Console — Product Design Contract

## User

A broke founder operating multiple repositories who needs a truthful answer fast without paying for another platform or reading raw CI archaeology.

## Core job

Answer four questions in one glance:

1. What actually ran?
2. Against which exact commit?
3. What failed: code, workflow, or infrastructure?
4. What is the smallest safe next action?

## Information architecture

### Portfolio row

- Repository and product name
- Exact branch and abbreviated head SHA
- Overall state: verified, failed, blocked, unknown
- Evidence freshness
- Highest-risk blocker
- Single next gate

### Repository drill-down

1. **Reality** — inspected repo, branch, SHA, environment, and artifact source.
2. **Redteam I** — premise and authority risks.
3. **L99 system map** — provenance, isolation, dependencies, state, promotion, rollback, and drift.
4. **Decision** — one selected path with rationale.
5. **Redteam II** — attacks against that path.
6. **Action** — smallest reversible implementation.
7. **Proof** — executed checks and immutable artifacts.
8. **Rollback** — code rollback and operational rollback shown separately.
9. **Next gate** — owner, action, and evidence required.

## Status language

Never show a decorative green badge without exact-head proof.

- **Verified** — independently validated immutable evidence covers the stated scope.
- **Failed** — a command executed and produced a concrete failure.
- **Infrastructure blocked** — runner or provider failed before meaningful steps executed.
- **Unknown** — no current evidence.
- **Not applicable** — explicitly justified and excluded from scoring.

## Interaction design

- Default to the highest-risk repository and newest evidence.
- Every status opens its evidence record, not a prose explanation.
- One primary action per state: run local gate, inspect failure, restore infrastructure, review, or merge.
- Keep advanced evidence behind progressive disclosure.
- Preserve accessible text labels alongside color and icons.
- Show timestamps as relative time plus exact UTC on detail.

## Broke-founder operating mode

The canonical proof command is:

```bash
python runtime/founder_truth_gate.py
```

It uses only Python, Node, Git, and repository files. It creates an exact-SHA JSON artifact under `artifacts/founder-truth/`. GitHub Actions may execute the same command, but it is not the sole truth source.

## Failure classification

- No job steps or logs: `runner_startup_failure`
- Workflow schedules no jobs: `workflow_no_jobs`
- A command starts and fails: `workflow_step_failure`
- Local gate cannot start because a required runtime is absent: `local_environment_blocked`

## Accessibility baseline

- Status must never rely on color alone.
- All evidence controls use native buttons or links.
- Keyboard focus order follows portfolio → repository → evidence → next gate.
- Error text includes cause, affected scope, and recovery action.
- Motion is optional and never required to understand state.

## Product truth boundary

The console is a view over evidence. It may summarize and prioritize, but it may not invent, upgrade, or merge claims from separate evidence sources.