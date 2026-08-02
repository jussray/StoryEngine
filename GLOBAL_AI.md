# L99 Global AI Contract

This repository follows the shared founder stack:

```text
/garyvee lindymode redteam l99 redteam ooda
```

Repeated `redteam` tokens are intentional.

1. **GaryVee frame** — define the creator/operator value, outcome, and fastest truthful proof.
2. **Lindy screen** — prefer durable schemas, append-only events, portable files, simple interfaces, reversible changes, and boring recovery paths.
3. **Redteam I: premise** — attack assumptions, authority, privacy, tenant isolation, provenance, cost, and whether the feature should exist.
4. **L99 systems pass** — inspect continuity, source-of-truth ownership, state transitions, memory, runtime, event history, promotion gates, rollback, and drift.
5. **Redteam II: plan** — attack the selected implementation, cross-tenant failure, stale memory, cache contamination, schema drift, blast radius, recovery, and proof.
6. **OODA** — re-observe, orient, decide one path, act minimally, verify, emit evidence, and loop.

Do not collapse the two redteam passes. The first attacks the premise. The second attacks the chosen mechanism.

## Mandatory founder truth loop

Before any merge-readiness, release-readiness, capability, recovery, or completion claim, every agent must run or explicitly classify why it cannot run:

```bash
python runtime/founder_truth_gate.py
```

The command must execute against the exact checked-out head and emit `artifacts/founder-truth/<sha>.json`. GitHub Actions may execute this command, but GitHub Actions is not the sole source of truth. A zero-step or no-log CI failure is infrastructure evidence, not a code failure. Never weaken a check to create a green result.

Every nontrivial action must follow and report:

```text
Observe reality
→ Redteam the premise
→ Map the L99 system
→ Decide the smallest reversible path
→ Redteam the selected path
→ Act
→ Run the founder truth gate
→ Classify evidence
→ Record rollback
→ Name the next approval gate
```

## Truth order

1. Repository, branch, runtime, artifacts, and deployed configuration actually inspected.
2. Current tests, schemas, event streams, logs, reports, and observed behavior.
3. Explicit founder decisions and approved architecture records.
4. Current official provider documentation.
5. Prior summaries, generated plans, chat memory, and assumptions.

Never claim an event, artifact, gate, test, deployment, rollback, or recovery path exists without evidence.

## L99 invariants

- Semantic similarity is never proof of authorization.
- Resolve identity and isolation before semantic search or reuse.
- Revocation beats TTL.
- The event bus owns operational truth. Dashboards are views.
- Provenance, tenant, workspace, policy, model, namespace, and user boundaries must be explicit.
- Narrative and canon drift are operational events when they can corrupt downstream work.
- Human-locked anchors, approvals, and authority boundaries may not be silently overwritten by models.
- Creator-facing products expose outcomes, not internal OODA, Lindymode, Redteam, or pipeline machinery unless explicitly designed for operators.

## Repository boundaries

- The root Python runtime and `story-engine/` Node application are distinct systems. Do not blend them merely because they share a repository.
- Event schemas, correlation IDs, parent links, and artifact formats are public contracts inside the system. Version changes deliberately.
- Dashboards must not invent truth outside the event stream or source artifacts.
- Cache and memory reuse must fail closed on provenance or isolation mismatch.
- Promotion gates should block unsafe release, not become decorative CI theater.

## Provider roles

- **Claude / Claude Code** — long-context repository analysis, structured implementation, schema and documentation work.
- **Codex / ChatGPT** — debugging, code review, tests, data analysis, repository operations, and founder-readable synthesis.
- **OpenAI Platform** — replaceable server-side model capability behind versioned adapters.
- **Anthropic Platform** — replaceable server-side model capability behind versioned adapters.
- **Perplexity** — current public research and source discovery, not private runtime truth.
- **GitHub** — source, review, CI evidence, and provenance; merge is not deployment proof.

## Non-negotiable rules

- Inspect existing schemas, policies, producers, consumers, tests, and artifacts before adding another.
- Preserve event compatibility or provide explicit migration and rollback.
- Never weaken tenant isolation, provenance, revocation, auth, page guards, or promotion gates to make tests pass.
- Keep provider keys, payment secrets, notification credentials, and operator access off public clients and logs.
- Do not treat model output as authorization, canon truth, or release approval.
- Prefer append-only evidence and deterministic validators where feasible.
- Avoid parallel event buses, duplicate memory graphs, and competing sources of truth.

## Approval gates

Require explicit founder approval before:

- merge, force-push, production deployment, or rollback;
- destructive event, memory, cache, database, or artifact migrations;
- auth, role, tenant, workspace, operator, or page-access changes;
- provider secret creation, rotation, deletion, or exposure;
- billing, Stripe, Resend, domains, DNS, Worker, or production environment changes;
- publishing internal operator machinery into creator-facing surfaces.

An audit authorizes inspection, not mutation.

## Required report

1. Reality
2. Risk I: premise
3. L99 system view
4. Decision
5. Risk II: selected plan
6. Action
7. Proof
8. Rollback
9. Next approval gate

Depth is only useful when it leaves the system safer, clearer, more reversible, or less likely to hallucinate its own architecture.
