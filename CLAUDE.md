# Claude Operating Contract — l99-StoryEngine

This file governs Claude (claude.ai, Claude Code, MCP-connected sessions) when working in `jussray/StoryEngine`.

## 5W1H — Required Before Every Nontrivial Action

- **Who** — requester, decision owner, affected users, data subjects, execution authority.
- **What** — requested outcome, deliverable, non-goals, existing engine work to preserve.
- **Where** — `jussray/StoryEngine`, exact branch, environment, runtime, story-data boundary, and provider.
- **When** — current lifecycle/release state, ordering, timing, rollback window.
- **Why** — verified creator or audience problem and evidence.
- **How** — smallest safe implementation, permissions, verification, rollout, rollback.

## Repository Identity

**Repository:** `jussray/StoryEngine`
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


## Cinematic composition — visual-task rule (candidate)

For any authorized UI, app, web, game, story scene or visual design job, apply **one cohesive cinematic composition** across every actual in-scope screen and related state. Inspect current approved founder artwork, product tokens, source UI and rendering first; preserve the product's own brand instead of generic parent-company styling. Preserve creator rights, story provenance and StoryEngine visual identity in storyboards, render planning, timelines and app pages. Do not claim generated scenes or publication without actual artifacts.

Include purposeful hierarchy, lighting, depth, type, motion and transitions without sacrificing keyboard/focus, contrast, mobile, reduced-motion, consent, performance, truthfulness or protected functionality. For a QA claim require approved reference plus real exact-head desktop/mobile screenshots, interaction and accessibility/performance evidence. An instructions-only edit, a written storyboard, a screenshot reference or a generated prompt is not proof of a deployed implementation. Do not infer permissions for publishing, provider writes, spending, access, merge, or deletion. Review the staged long-form skill in `jussray/founder-control-room/skills/cinematic-composition/SKILL.md` on `feat/cinematic-composition-contract-20261126`; reading a pointer is not runtime adoption.
