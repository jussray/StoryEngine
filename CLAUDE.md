# Claude Operating Contract — l99-StoryEngine

This file governs Claude (claude.ai, Claude Code, MCP-connected sessions) when working in `jussray/l99-StoryEngine`.

## 5W1H — Required Before Every Nontrivial Action

- **Who** — requester, decision owner, affected users, data subjects, execution authority.
- **What** — requested outcome, deliverable, non-goals, existing engine work to preserve.
- **Where** — `jussray/l99-StoryEngine`, exact branch, environment, runtime, story-data boundary, and provider.
- **When** — current lifecycle/release state, ordering, timing, rollback window.
- **Why** — verified creator or audience problem and evidence.
- **How** — smallest safe implementation, permissions, verification, rollout, rollback.

## Repository Identity

**Repository:** `jussray/l99-StoryEngine`
**Role:** Story engine powering the L99 creator and community ecosystem — narrative tools, content pipelines, story-data schemas, and community publishing layer.
**Separation:** Strictly separate from Se’kret Bip IP, JBH operations, Think Tank, and Untold Stories storefronts.

## Non-Negotiable Boundaries

- Keep creator-submitted stories, community member data, unpublished content, and moderation records out of model-visible or public outputs.
- Do not expose or cross-contaminate Se’kret Bip IP in L99 story pipelines.
- Story moderation, publishing, and community-safety decisions require explicit founder approval.
- Credentials and signing keys must stay in vault — never in code or PR descriptions.
- All production-touching actions require explicit founder approval.

## Required Loop

1. Observe exact branch, story schema version, content pipeline state, and deployment boundary.
2. Complete 5W1H and identify authority, safety, or community-safety gaps.
3. Red-team the premise, data exposure, IP separation, moderation bypass, cost, and rollback.
4. Map the L99 system: provenance, isolation, state, dependencies, promotion, recovery, and drift.
5. Choose the smallest reversible action preserving existing engine and content.
6. Red-team the selected implementation.
7. Implement minimally.
8. Run the canonical truth command against the exact head:

```bash
python runtime/founder_truth_gate.py
```

9. Classify any failure as code, workflow, local environment, or runner infrastructure evidence.
10. Report proven, inferred, blocked, rollback, and next owner.

A skipped command is not a pass. GitHub Actions is an optional executor of the same gate, not the sole source of truth. Do not weaken tests or policy to obtain green status.

## Approval Gates

Require explicit founder approval before: merging, deploying, publishing stories, changing moderation policy, rotating secrets, or external communications.

## Output Format

Return: completed 5W1H · repo/branch/SHA · files touched · checks run · founder truth artifact · preserved work · rollback path · blocker classification and next owner.
