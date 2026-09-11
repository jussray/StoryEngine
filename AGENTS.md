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

Read `.agents/skills/l99-operator/SKILL.md` before nontrivial work. Use its 5W1H contract and ULTRATHINK adaptive kernel as active reasoning: establish who, what, where, when, why, and how; declare expected state; observe exact reality; bind evidence; classify surprise; adapt; verify; then leave an exact-state fingerprint and bounded continuity cookie.

A continuity cookie is repository evidence metadata, **not** an HTTP/browser cookie. Never reuse or overload the `l99_session` authentication cookie or any other security-cookie channel. The `.security/cookies.json` contract remains authoritative for HTTP cookies.

For every material candidate, review state, merge decision, or release claim:

- compute/update the deterministic work fingerprint over the exact material state;
- invalidate older proof when a material fingerprint input changes;
- leave/update the bounded continuity cookie with proof refs, invalidation rules, and one next gate;
- treat current repository/runtime/provider readback as higher authority than stale cookies or conversation memory.

Read [`GLOBAL_AI.md`](./GLOBAL_AI.md) before changing runtime code, schemas, policies, dashboards, tests, or documentation.

Read [`skills/typescript-debugging-chain/SKILL.md`](./skills/typescript-debugging-chain/SKILL.md) before TypeScript, TSX, JavaScript, Node, build, PR, draft PR, mergeability, or feature-debugging work.

Read [`skills/typescript-behavior-tests/SKILL.md`](./skills/typescript-behavior-tests/SKILL.md) before writing, replacing, or retiring Jest/Vitest behavior tests.

Use:

```text
/elonmusk /garyvee lindymode redteam l99 redteam ooda /truthmode /steal ULTRATHINK
```

The first redteam attacks the premise. `/steal` borrows stable, battle-tested invariants rather than code, data, branding, or protected expression. Lindy asks what survives provider/framework churn. L99 maps provenance, isolation, event history, state, compatibility, release gates, promotion, rollback, and drift. OODA chooses the smallest reversible action. The second redteam attacks the selected plan.

## Required loop

1. Inspect the exact subsystem, current evidence, open PRs, and draft PRs.
2. Declare expected state, observe actual state, and classify surprise.
3. Attack the premise.
4. Map provenance, isolation, event history, state, compatibility, promotion, release truth, and rollback.
5. Apply `/steal` + Lindy to prefer mature invariants over new architecture.
6. Choose the smallest reversible OODA action.
7. Attack the selected plan.
8. Make only the coherent change.
9. Verify with behavior tests, Playwright when browser or runtime behavior changes, artifacts, schemas, logs, event replay, Founder Control Room records, or Cloudflare evidence when release truth is involved.
10. Emit/update the exact-state work fingerprint and bounded continuity cookie.
11. Report the next approval gate.

## Infrastructure outage and release truth

When GitHub Actions fails, classify the evidence before blaming code:

- `runner_startup_failure`: runner or job startup failed before meaningful steps executed, especially when there are no steps, no logs, or null log URLs.
- `workflow_no_jobs`: the workflow schedules no jobs or is skipped before jobs exist.
- `workflow_step_failure`: at least one job executed steps and logs show a concrete failing command, assertion, build, lint, type, test, or Playwright step.

Never call a zero-step or no-log Actions failure a code regression. Treat it as infrastructure evidence. It may still gate merge, release, or deployment truth until Founder Control Room and any available Cloudflare or runtime evidence explain the state.

Look to Founder Control Room first for cross-repository release-truth interpretation. Record the repository, PR, branch, exact head SHA, workflow, run, job evidence, classification, Cloudflare build or deployment result, runtime evidence, rollback, current fingerprint, continuity cookie, and next gate.

Cloudflare success is separate from GitHub Actions success and does not prove application, auth, data, privacy, provenance, or Playwright gates. Record both without blending them.

## Merge authority

Merge only when it is the correct evidence-backed integration step, not merely because a PR exists or a badge looks green.

A merge is safe only when:

- repository, target branch, PR, and exact head SHA are verified;
- the current work fingerprint matches the exact candidate being reviewed;
- continuity evidence is current and does not claim authority it does not possess;
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
- Never place credentials, session IDs, auth claims, personal data, private manuscript text, raw canon payloads, or secrets into continuity cookies.
- Never reuse `l99_session` or any HTTP/browser cookie as a continuity/evidence store.
- Do not weaken auth, page guards, revocation, provenance, validation, Playwright, or promotion gates to make CI green.
- Do not delete stale tests unless replacement behavior coverage or intentional behavior retirement is documented.
- Do not deploy, alter access, rotate credentials, perform destructive changes, or delete Ray/Juss material without explicit founder approval for that exact action.

## Evidence report

List files changed, contracts changed, exact fingerprint, bounded continuity cookie, tests run, Playwright result or inapplicability, artifacts produced, failures or skips, isolation impact, release impact, Cloudflare and Founder Control Room evidence when applicable, rollback, residual risk, and next gate.
