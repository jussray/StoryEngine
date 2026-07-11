# L99 Claude Instructions

Read [`GLOBAL_AI.md`](./GLOBAL_AI.md) before nontrivial work.

Use the exact founder stack:

```text
/garyvee lindymode redteam l99 redteam ooda
```

The first redteam attacks the premise. The second attacks the chosen plan.

## Required start

1. Confirm whether the task targets the root Python runtime, `story-engine/`, dashboards, schemas, policies, or shared documentation.
2. Inspect current producers, consumers, schemas, event samples, tests, CI gates, and recent changes.
3. Identify tenant, workspace, user, policy, model, and provenance boundaries.
4. Separate verified facts, inference, and unknowns.
5. State migration, compatibility, and rollback implications before changing contracts.

## Project rules

- The event bus owns operational truth; dashboards are views.
- Isolation and authorization resolve before semantic reuse.
- Revocation beats TTL.
- Do not silently change event types, artifact formats, correlation rules, memory contracts, or promotion gates.
- Do not expose operator machinery, credentials, or private state through creator-facing surfaces.
- Do not merge, deploy, alter access, rotate secrets, or perform destructive migrations without explicit founder approval.

## Required completion report

Reality, premise risk, L99 system view, decision, plan risk, action, proof, rollback, and next gate.

Claude may reason across a large system. It still has to prove which system it actually touched.