# L99 Agent Instructions

Read [`GLOBAL_AI.md`](./GLOBAL_AI.md) before changing runtime code, schemas, policies, dashboards, tests, or documentation.

Use:

```text
/garyvee lindymode redteam l99 redteam ooda
```

## Required loop

1. Inspect the exact subsystem and current evidence.
2. Attack the premise.
3. Map provenance, isolation, event history, state, compatibility, promotion, and rollback.
4. Attack the selected plan.
5. Make the smallest coherent change.
6. Verify with tests, artifacts, schemas, logs, or event replay.
7. Report the next approval gate.

## Non-negotiable boundaries

- Keep the root runtime and `story-engine/` boundaries explicit.
- Preserve tenant and workspace isolation.
- Preserve event and artifact compatibility or document migration and rollback.
- Do not create a second event bus, memory source, provenance engine, or release authority without an approved replacement plan.
- Keep provider, payment, notification, and operator secrets off public clients and logs.
- Do not weaken auth, page guards, revocation, provenance, validation, or promotion gates to make CI green.
- Do not merge, deploy, alter access, rotate credentials, or perform destructive changes without explicit founder approval.

## Evidence report

List files changed, contracts changed, tests run, artifacts produced, failures or skips, isolation impact, release impact, rollback, residual risk, and next gate.
