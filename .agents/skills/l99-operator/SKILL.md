# l99-operator

## Trigger

Use for every nontrivial task, repository-state claim, code or documentation change, deployment discussion, review, or recovery operation in `jussray/l99-StoryEngine`.

## 5W1H operating contract

Before planning, editing, or claiming completion, establish and state:

- **Who** — the requester, decision owner, affected users, data subjects, and execution authority.
- **What** — the requested outcome, concrete deliverable, non-goals, and existing work that must be preserved.
- **Where** — the exact repository, branch, environment, runtime, route, service, data store, and provider boundary.
- **When** — the current lifecycle or release state, required ordering, timing constraint, and rollback window.
- **Why** — the user problem and verified evidence that justify the work.
- **How** — the smallest safe implementation, required permissions, verification evidence, rollout, and rollback.

Inspect repository and runtime truth for unknowns. Ask only when a missing answer materially changes the safe solution or authority. Re-run 5W1H after red-team/OODA findings change the plan. Finish by mapping the result, evidence, remaining blocker, and next owner back to all six questions.

## Repository identity

**Repository:** `jussray/l99-StoryEngine`

**Role:** An AI runtime and operations layer for state integrity, provenance-safe reuse, recovery, shadow validation, and promotion controls.

This is a reviewed orientation, not permanent truth. Re-read the current README, branch, recent commits, workflows, configuration, and runtime evidence before acting.

## Non-negotiable boundaries

- Preserve tenant and workspace isolation, provenance, revocation, event compatibility, and observable promotion gates.
- Do not create a second event bus, memory source, provenance engine, or release authority without an approved migration and rollback plan.
- Keep provider, payment, notification, operator, and workspace credentials off public clients and logs.
- Do not weaken auth, page guards, Stripe webhook verification, CSP, isolation, or promotion rules to make checks green.
- Treat current runtime foundations as not yet production-safe until documented blockers have executable proof.

## Required loop

1. Observe the exact branch, changed files, existing implementation, data boundaries, and available evidence.
2. Complete 5W1H and identify any authority or safety gap.
3. Red-team the premise, privacy, security, misuse, failure modes, and rollback.
4. Choose the smallest reversible action that preserves existing work.
5. Implement only within the confirmed repository role.
6. Run proportionate checks on the exact head.
7. Report what is proven, what is inferred, what remains blocked, and who owns the next action.

## Verification

- `Inspect the current package scripts, then run all applicable tests, type checks, security checks, and event-replay or promotion evidence.`

A command listed here is a starting point, not proof it exists or applies forever. Discover current scripts and workflows first. A skipped, stale, unstarted, or older-SHA check is not a pass.

## Output

Return:

- the completed Who / What / Where / When / Why / How;
- exact repository, branch, and head SHA;
- files and boundaries touched;
- executed checks and evidence;
- preserved work;
- rollback path;
- blocker and next owner.

Never promote a prototype, demo, archive, duplicate, local check, or provider registration into a production claim without exact runtime evidence.
