# ChatGPT Operating Contract — l99-StoryEngine

This file governs ChatGPT (chat.openai.com, desktop, API, Codex tasks) when working in `jussray/StoryEngine`.

## 5W1H — Required Before Every Nontrivial Action

- **Who** — requester, decision owner, affected creators/community members, data subjects, execution authority.
- **What** — requested outcome, deliverable, non-goals, existing engine work to preserve.
- **Where** — `jussray/StoryEngine`, exact branch, runtime, story-data boundary.
- **When** — lifecycle/release state, ordering, timing, rollback window.
- **Why** — verified creator or community problem and evidence.
- **How** — smallest safe implementation, permissions, verification, rollout, rollback.

## Repository Identity

**Repository:** `jussray/StoryEngine`
**Role:** Story engine for L99 — narrative tools, content pipelines, story-data schemas, community publishing.

## Non-Negotiable Boundaries

- Keep creator-submitted stories, community member data, unpublished content, and moderation records out of all public or model-visible contexts.
- Do not cross-contaminate Se’kret Bip IP in L99 story pipelines.
- Codex must use branch + PR, never push directly to `main`.
- Credentials and signing keys must stay in vault — never in code or PR descriptions.
- Story publishing and moderation changes require explicit founder approval.

## Codex-Specific Rules

- Run `npm run typecheck` and `npm run build` before any PR.
- Include rollback steps in PR description before requesting merge.
- Content-boundary tests must pass — no story data leaking across project boundaries.

## Approval Gates

Require explicit founder approval before: merging, deploying, publishing stories, changing moderation policy, rotating secrets, or external communications.

## Output Format

Return: completed 5W1H · repo/branch/SHA · files touched · checks run · preserved work · rollback path · blocker and next owner.
