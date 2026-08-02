# L99 Agent Instructions

## Founder Intelligence entrypoint

Before material planning, implementation, review, automation, publication, deployment, migration, or cross-repository coordination, read and apply:

- [`AGENTS_FOUNDER_INTELLIGENCE.md`](AGENTS_FOUNDER_INTELLIGENCE.md)
- [`docs/FOUNDER_INTELLIGENCE_CONSTITUTION.md`](docs/FOUNDER_INTELLIGENCE_CONSTITUTION.md)

Use the complete remembrance loop:

```text
/human
→ /futureyou
→ /truthmode
→ /confess
→ /billgates
→ /elonmusk
→ Build
→ Verify
→ Explain
→ Leave evidence
→ Teach the next builder
→ Repeat
```

`/futureyou` asks: **How would it be remembered by building this?** Future creators should inherit a map, not a maze. Preserve authorship, provenance, permissions, source material, transformations, assumptions, evidence, release boundaries, rollback, and enough context for the next builder to continue safely.

This entrypoint supplements every stricter authorship, tenant, privacy, promotion, approval, rollback, and non-deletion rule below. It never creates founder approval or publication authority.

## Required repository skill

Read `.agents/skills/l99-operator/SKILL.md` before nontrivial work. Use its 5W1H contract as active reasoning: establish who, what, where, when, why, and how; inspect missing answers; and ask only when an unknown materially changes the safe action or authority.

Read [`GLOBAL_AI.md`](./GLOBAL_AI.md) before changing runtime code, schemas, policies, dashboards, tests, or documentation.

Read [`skills/typescript-debugging-chain/SKILL.md`](./skills/typescript-debugging-chain/SKILL.md) before TypeScript, TSX, JavaScript, Node, build, PR, draft PR, mergeability, or feature-debugging work.

Read [`skills/typescript-behavior-tests/SKILL.md`](./skills/typescript-behavior-tests/SKILL.md) before writing, replacing, or retiring Jest/Vitest behavior tests.

Use:

```text
/elonmusk /garyvee lindymode redteam l99 redteam ooda /truthmode
```

The first redteam attacks the premise. L99 maps provenance, isolation, event history, state, compatibility, release gates, promotion, rollback, and drift. The second redteam attacks the selected plan.

## Required loop

1. Inspect the exact subsystem, current evidence, open PRs, and draft PRs.
2. Attack the premise.
3. Map provenance, isolation, event history, state, compatibility, promotion, release truth, and rollback.
4. Attack the selected plan.
5. Make the smallest coherent change.
6. Verify with behavior tests, Playwright when browser or runtime behavior changes, artifacts, schemas, logs, event replay, Founder Control Room records, or Cloudflare evidence when release truth is involved.
7. Report the next approval gate.

## Infrastructure outage and release truth

When GitHub Actions fails, classify the evidence before blaming code:

- `runner_startup_failure`: runner or job startup failed before meaningful steps executed, especially when there are no steps, no logs, or null log URLs.
- `workflow_no_jobs`: the workflow schedules no jobs or is skipped before jobs exist.
- `workflow_step_failure`: at least one job executed steps and logs show a concrete failing command, assertion, build, lint, type, test, or Playwright step.

Never call a zero-step or no-log Actions failure a code regression. Treat it as infrastructure evidence. It may still gate merge, release, or deployment truth until Founder Control Room and any available Cloudflare or runtime evidence explain the state.

Look to Founder Control Room first for cross-repository release-truth interpretation. Record the repository, PR, branch, exact head SHA, workflow, run, job evidence, classification, Cloudflare build or deployment result, runtime evidence, rollback, and next gate.

Cloudflare success is separate from GitHub Actions success and does not prove application, auth, data, privacy, provenance, or Playwright gates. Record both without blending them.

## Merge authority

Merge only when it is the correct evidence-backed integration step, not merely because a PR exists or a badge looks green.

A merge is safe only when:

- repository, target branch, PR, and exact head SHA are verified;
- scope is focused and unrelated changes are absent;
- changed contracts, code, configuration, schemas, documentation, and artifacts are reviewed;
- required checks genuinely executed and passed, or a documented infrastructure outage is classified and the remaining evidence is sufficient for this exact change;
- Playwright passed for any changed user-facing browser or runtime path, or is explicitly inapplicable;
- Founder Control Room and Cloudflare evidence were checked when release truth or deployment is involved;
- no unresolved critical review remains;
- authorship, provenance, tenant and workspace isolation, secrets, privacy, compatibility, and rollback remain intact;
- the merge itself does not silently perform deployment, migration, access changes, credential movement, billing or spending, external publication, destructive deletion, or another separately gated action.

If these conditions are not met, keep working or leave the PR open with the exact blocker.

## Codex provider baseline

When a repo-running Codex agent needs model-provider configuration, keep it machine-local and use OpenAI/Codex as the default coding engine:

```toml
model = "gpt-5.3-codex"
model_provider = "openai"
model_reasoning_effort = "high"
model_reasoning_summary = "auto"
model_supports_reasoning_summaries = true
model_auto_compact_token_limit = 900000
```

Store the API key outside the repository, for example in `~/.codex/.env`:

```dotenv
OPENAI_API_KEY=replace_with_local_secret
```

Never commit `.codex/.env`, `OPENAI_API_KEY`, `MODEL_API_KEY`, service-role keys, provider tokens, or any other secret. Model choice does not override this file, `GLOBAL_AI.md`, repository skills, verification gates, or founder approval gates.

## Non-negotiable boundaries

- Keep the root runtime and `story-engine/` boundaries explicit.
- Preserve tenant and workspace isolation.
- Preserve event and artifact compatibility or document migration and rollback.
- Do not create a second event bus, memory source, provenance engine, or release authority without an approved replacement plan.
- Keep provider, payment, notification, and operator secrets off public clients and logs.
- Do not weaken auth, page guards, revocation, provenance, validation, Playwright, or promotion gates to make CI green.
- Do not delete stale tests unless replacement behavior coverage or intentional behavior retirement is documented.
- Do not deploy, alter access, rotate credentials, perform destructive changes, or delete Ray/Juss material without explicit founder approval for that exact action.

## Evidence report

List files changed, contracts changed, tests run, Playwright result or inapplicability, artifacts produced, failures or skips, isolation impact, release impact, Cloudflare and Founder Control Room evidence when applicable, rollback, residual risk, and next gate.
