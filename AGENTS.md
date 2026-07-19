# L99 Agent Instructions

Read [`GLOBAL_AI.md`](./GLOBAL_AI.md) before changing runtime code, schemas, policies, dashboards, tests, or documentation.

Use:

```text
/elonmusk /garyvee lindymode redteam l99 redteam ooda /truthmode
```

The first redteam attacks the premise. L99 maps provenance, isolation, event history, state, compatibility, release gates, promotion, rollback, and drift. The second redteam attacks the selected plan.

## Required loop

1. Inspect the exact subsystem and current evidence.
2. Attack the premise.
3. Map provenance, isolation, event history, state, compatibility, promotion, release truth, and rollback.
4. Attack the selected plan.
5. Make the smallest coherent change.
6. Verify with tests, Playwright when runtime/browser behavior changes, artifacts, schemas, logs, event replay, Founder Control Room records, or Cloudflare evidence when release truth is involved.
7. Report the next approval gate.

## Infrastructure outage and release truth

When GitHub Actions fails, classify the evidence before blaming code:

- `runner_startup_failure`: runner/job startup failed before meaningful steps executed, especially no steps, no logs, or null log URLs.
- `workflow_no_jobs`: the workflow schedules no jobs or is skipped before jobs exist.
- `workflow_step_failure`: at least one job executed steps and logs show a concrete failing command, assertion, build, lint, type, or Playwright step.

Never call a zero-step/no-log Actions failure a code regression. Treat it as infrastructure evidence. It may still gate merge, release, or deployment truth under project rules until Founder Control Room and any available Cloudflare/runtime evidence explain the situation.

Look to Founder Control Room first for cross-repo release truth. Capture repository, PR, branch, exact head SHA, workflow, run, job evidence, classification, Cloudflare build status, runtime evidence, and next gate.

Cloudflare build/deploy success is separate from GitHub Actions success and does not by itself prove app, auth, data, privacy, or Playwright gates.

## Merge authority

Merge when it is the correct evidence-backed integration step, not merely because a PR exists or a badge looks green.

A merge is safe only when repository, target branch, PR, and exact head SHA are verified; scope is focused; changed contracts/code/config/docs have been reviewed; required checks genuinely executed and passed or a documented infrastructure outage is classified with sufficient remaining evidence; Playwright passed for any changed user-facing web/runtime path or is explicitly inapplicable; Founder Control Room and Cloudflare evidence were checked when release truth or deployment is involved; no unresolved critical review remains; isolation, provenance, tenant/workspace boundaries, secrets, and rollback remain intact; and the merge itself does not silently perform deployment, migration, access changes, credential movement, billing/spending, external publication, destructive deletion, or another separately gated action.

If those conditions are not met, keep working or leave the PR open with the exact blocker.

## Non-negotiable boundaries

- Keep the root runtime and `story-engine/` boundaries explicit.
- Preserve tenant and workspace isolation.
- Preserve event and artifact compatibility or document migration and rollback.
- Do not create a second event bus, memory source, provenance engine, or release authority without an approved replacement plan.
- Keep provider, payment, notification, and operator secrets off public clients and logs.
- Do not weaken auth, page guards, revocation, provenance, validation, Playwright, or promotion gates to make CI green.
- Do not deploy, alter access, rotate credentials, perform destructive changes, or delete Ray/Juss material without explicit founder approval for that exact action.

## Evidence report

List files changed, contracts changed, tests run, Playwright result or inapplicability, artifacts produced, failures or skips, isolation impact, release impact, Cloudflare/Control Room evidence when applicable, rollback, residual risk, and next gate.
