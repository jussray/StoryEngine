# TypeScript Debugging Chain Skill

## Trigger

Activate before TypeScript, TSX, JavaScript, Node, build, test, PR, draft PR, mergeability, or feature-debugging work in this repository.

## Required order

1. Audit first.
2. Diagnose root cause by ranked probability.
3. Write the smallest viable patch only after the highest-probability cause is verified.
4. Review strictly before ready-for-review or merge-ready claims.

## Audit frame

```text
You are a senior TypeScript engineer auditing my repo before any edits.

Project:
- Repo: [REPO]
- Stack: [STACK]
- Goal: [GOAL]

GUARDRAILS:
- Audit first, then suggest, no edits until you understand the repo state
- Prefer minimal, surgical changes
- Do not remove functionality just to make the build pass
- If secrets/env handling is involved, never expose or hardcode keys
- If something cannot be verified from the material I gave you, say so clearly

INPUT:
[paste tree / files / logs / commit]

OUTPUT FORMAT:
1. Current repo state as you understand it
2. Likely root issues, ranked
3. What is blocked vs safe to change
4. Recommended next step only, not a full rewrite
```

## Root-cause frame

```text
Act like a calm senior debugger. I want root-cause analysis, not a list of unrelated guesses.

Context:
- Repo: [REPO]
- Feature / screen: [FEATURE]
- Expected: [EXPECTED]
- Actual: [ACTUAL]
- Recent change, if any: [CHANGE]

Evidence:
[paste error log / stack trace / code / screenshots]

Rules:
- Restate the problem first
- Rank top 3 most likely causes by probability
- Give fastest checks in order
- Suggest only minimal TypeScript changes
- Do not replace architecture unless absolutely necessary

Return:
1. Diagnosis
2. Ordered debug checklist
3. Smallest viable patch
4. Regression risks after patch
```

## Minimal patch frame

```text
You are writing a minimal patch for a TypeScript codebase.

Task: Fix [BUG] in [FILE/MODULE]

Constraints:
- Keep existing behavior unless directly related to the bug
- Touch as few files as possible, no broad refactors
- No placeholder logic, no fake mocks unless explicitly requested
- Explain why each change is necessary in exactly one sentence

Input:
[paste relevant code]

Return:
- Unified diff or exact replacement blocks
- One-paragraph explanation
- Manual test steps
```

## Strict review frame

```text
Review this change like a strict senior reviewer for a production TypeScript app.

Priorities, in order:
1. Correctness
2. Regression risk
3. Type safety
4. Target-stack compatibility
5. Supabase / Worker integration safety
6. Minimal blast radius

Input:
[paste diff / PR summary]

Output:
1. Critical issues (blockers)
2. Medium-risk concerns
3. What is good and should stay unchanged
4. Suggested exact fixes
5. Merge recommendation: YES / NO / YES WITH CHANGES
```

## Repository rules

- Open draft PRs are part of the work, not invisible backlog.
- Never treat `mergeable: true` alone as safe to merge.
- Separate code failures from missing evidence, stale branches, runner-startup failures, Cloudflare failures, provider/config failures, and user-data preconditions.
- Do not weaken auth, page guards, revocation, provenance, validation, promotion gates, event compatibility, or tenant/workspace isolation to make CI green.
- Do not expose or hardcode provider, payment, notification, operator, or service-role secrets.
- No broad architecture replacement unless evidence proves the architecture is the defect.

## Done

Work is done only when repo state is understood, root cause is ranked, the patch is minimal, strict review names blockers separately from concerns, tests/evidence are named, rollback is obvious, and the next approval gate is explicit.