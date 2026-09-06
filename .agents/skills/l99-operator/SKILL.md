# l99-operator

## Trigger

Use for every nontrivial task, repository-state claim, code or documentation change, deployment discussion, review, or recovery operation in `jussray/StoryEngine`.

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

**Repository:** `jussray/StoryEngine`

**Role:** An AI runtime and operations layer for state integrity, provenance-safe reuse, recovery, shadow validation, and promotion controls.

This is a reviewed orientation, not permanent truth. Re-read the current README, branch, recent commits, workflows, configuration, runtime evidence, and active pull requests before acting.

## ULTRATHINK adaptive kernel

For every material task, use this evidence-bound loop:

```text
intent
→ expected state
→ observe exact reality
→ bind evidence
→ classify surprise
→ /steal the stable invariant when a mature analogue exists
→ lindymode
→ redteam I
→ OODA smallest reversible action
→ redteam II
→ verify exact path
→ fingerprint
→ continuity cookie
→ next gate
```

Rules:

- Expected state is a hypothesis, never proof.
- Repository, runtime, database, provider, and browser readback outrank remembered or conversational state.
- Classify material surprise as `STRONGER_THAN_EXPECTED`, `AS_EXPECTED`, `WEAKER_THAN_EXPECTED`, `UNEXPECTED_DIRECTION`, or `UNKNOWN`.
- Adapt with the smallest reversible move: `ACCELERATE`, `CONTINUE`, `REPAIR`, `SUPERSEDE_AND_REBUILD`, `ROLL_BACK`, or `HOLD`.
- `/steal` means reuse a battle-tested invariant or system property, not another product's code, data, branding, or protected expression.
- Lindy mode asks which invariant will remain sensible after providers, models, frameworks, and interfaces change.
- Redteam I attacks whether the change should exist. Redteam II attacks how the chosen change can fail.
- Do not add architecture when a simpler established primitive already satisfies the goal.
- No success, promotion, merge, deployment, or production claim without evidence bound to the exact state being claimed.

## Fingerprints and continuity cookies

For every material candidate, implementation state, review state, merge decision, or release claim, emit an exact-state **work fingerprint** and a bounded **continuity cookie**.

### Work fingerprint

A work fingerprint is a deterministic SHA-256 digest over **one versioned canonical payload**. For schema `l99.work-fingerprint.v1`, every implementation must emit all keys below in this exact order; unknown scalar values are JSON `null`, never omitted:

```json
{
  "schema": "l99.work-fingerprint.v1",
  "repository": "owner/repo",
  "target_branch": "main",
  "base_sha": "40-hex-or-null",
  "head_sha": "40-hex-or-null",
  "goal": "normalized text",
  "scope": ["normalized/path-or-surface"],
  "proof": [{"ref": "normalized reference", "status": "normalized status"}]
}
```

Canonicalization rules are part of the contract:

1. Strings are Unicode NFC, trimmed at both ends, with internal bytes otherwise preserved and encoded as UTF-8.
2. `scope` is always an array, deduplicated and sorted by UTF-8 byte order.
3. `proof` is always an array. Normalize each object to exactly `{ "ref", "status" }`, then sort by `ref` and then `status` using UTF-8 byte order.
4. No extra keys are allowed. No key is omitted. Use JSON `null` for unknown scalar values and `[]` for empty arrays.
5. Serialize as compact JSON with the exact key order shown above, no insignificant whitespace, and no trailing newline.
6. Hash the serialized UTF-8 bytes with SHA-256 and render lowercase hex as `sha256:<64-hex>`.

Two builders observing identical normalized state must therefore produce byte-identical payloads and the same digest. Any material input change must change the fingerprint. Evidence attached to an older fingerprint is historical and cannot certify the new state. The fingerprint is an integrity/continuity receipt only; it never creates authentication, approval, merge, deployment, publication, or execution authority.

### Continuity cookie

A continuity cookie is a small evidence receipt that lets the next builder safely resume. It is **not an HTTP/browser cookie**, is not authentication state, and must never reuse or overload `l99_session`.

Use a bounded shape such as:

```json
{
  "schema": "l99.continuity-cookie.v1",
  "fingerprint": "sha256:...",
  "repository": "jussray/StoryEngine",
  "branch": "...",
  "base_sha": "...",
  "head_sha": "...",
  "goal": "...",
  "status": "...",
  "observed_at": "...",
  "proof_refs": [],
  "next_gate": "...",
  "invalidates_on": []
}
```

Continuity-cookie rules:

- Store it as evidence in a PR/issue comment, Founder Control Room record, retained artifact, or evidence report, not in browser cookies.
- Never include API keys, model/provider credentials, security-cookie values, session IDs, authorization claims, personal data, private manuscript text, raw canon payloads, or other secrets.
- The security/authentication cookie contract in `.security/cookies.json` is a separate authority plane and remains controlling for HTTP cookies.
- If a continuity cookie disagrees with current repository/runtime/provider readback, the cookie is stale and current readback wins.
- Include explicit invalidation conditions, especially head movement, material base movement, authority/policy change, supersession, or expired/stale proof.
- A continuity cookie grants no execution, merge, deployment, publication, or founder authority.

## Non-negotiable boundaries

- Preserve tenant and workspace isolation, provenance, revocation, event compatibility, and observable promotion gates.
- Do not create a second event bus, memory source, provenance engine, or release authority without an approved migration and rollback plan.
- Keep provider, payment, notification, operator, and workspace credentials off public clients and logs.
- Never use `l99_session` or any HTTP/browser cookie as a continuity/evidence store.
- Do not weaken auth, page guards, Stripe webhook verification, CSP, isolation, or promotion rules to make checks green.
- Treat current runtime foundations as not yet production-safe until documented blockers have executable proof.

## Required loop

1. Observe the exact branch, changed files, existing implementation, data boundaries, active work, and available evidence.
2. Complete 5W1H and identify any authority or safety gap.
3. Declare expected state, then compare it to observed state and classify surprise.
4. Red-team the premise, privacy, security, misuse, failure modes, and rollback.
5. Apply `/steal` + Lindy to identify the simplest mature invariant worth reusing.
6. Choose the smallest reversible OODA action that preserves existing work.
7. Red-team the selected action and repair any material weakness before claiming success.
8. Implement only within the confirmed repository role.
9. Run proportionate checks on the exact head.
10. Emit/update the work fingerprint and bounded continuity cookie.
11. Report what is proven, inferred, unknown, blocked, invalidated, and who owns the next gate.

## Verification

- `Inspect the current package scripts, then run all applicable tests, type checks, security checks, and event-replay or promotion evidence.`

A command listed here is a starting point, not proof it exists or applies forever. Discover current scripts and workflows first. A skipped, stale, unstarted, older-SHA, or different-fingerprint check is not a pass.

For browser or user-facing runtime changes, require targeted Playwright evidence on the exact candidate. For policy-only documentation changes, Playwright may be explicitly inapplicable, but the exact-state fingerprint and applicable repository checks still must be refreshed.

## Output

Return:

- the completed Who / What / Where / When / Why / How;
- exact repository, branch, base SHA, and head SHA;
- current work fingerprint;
- bounded continuity cookie;
- files and boundaries touched;
- executed checks and evidence;
- preserved work;
- rollback path;
- blocker and next owner.

Never promote a prototype, demo, archive, duplicate, local check, provider registration, stale fingerprint, or continuity cookie into a production claim without exact runtime evidence.
