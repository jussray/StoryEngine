# Capability Contract Federation Red Team

## Premise under attack

A machine-readable capability contract is useful only if the portfolio can trust the identity, freshness, scope, and provenance of its claims. A well-formed JSON file is not operational proof.

## Primary attack paths

1. **Self-attested green**: a repository marks a capability verified without immutable evidence.
2. **Cross-commit evidence reuse**: a passing workflow from commit A is attached to commit B.
3. **Stale proof replay**: old runtime or deployment evidence remains green after material code or configuration changes.
4. **Evidence aliasing**: multiple claims point to a vague URL or mutable branch instead of a specific artifact, run, deployment, and commit.
5. **Partial-suite inflation**: one narrow test is presented as proof of repository-wide readiness.
6. **Dependency blindness**: a repository is green while a required upstream service, secret, database, or provider is unavailable.
7. **Score gaming**: hard capabilities are omitted or marked not applicable to raise readiness.
8. **Schema downgrade**: a producer publishes an older or weaker schema that the consumer accepts silently.
9. **Identity confusion**: a contract claims a different repository or environment than the source that supplied it.
10. **Compromised producer**: a repository with write access falsifies its own contract and evidence references.

## Required controls

- Bind every verified claim to an immutable repository, commit SHA, workflow run, artifact or deployment identifier, and verification timestamp.
- Require the evidence commit to equal the contract commit unless an explicit ancestry rule is satisfied.
- Treat mutable branch links, screenshots, prose notes, and dashboard colors as context, not proof.
- Expire evidence after material changes to source, workflow, dependencies, configuration, secrets, infrastructure, or policy.
- Maintain a portfolio-owned capability allowlist so producers cannot omit expected capabilities without explanation.
- Reject unknown schema versions by default.
- Verify `repository` against the authenticated GitHub source.
- Keep producer scoring separate from consumer trust. Founder Control Room calculates the final portfolio score.
- Record dependencies and propagate blocked or unknown states when required upstream proof is missing.
- Preserve founder approval gates for publishing, credentials, billing, destructive actions, and authority expansion.

## L99 truth boundary

This repository currently publishes conservative states. Existing files, tests, workflows, dashboards, and policies establish implementation surfaces, not current production safety. Known authentication and security blockers remain blockers until exact-head evidence and targeted remediation prove otherwise.

## Promotion rule

A capability may move to `verified` only when:

1. its evidence reference is immutable;
2. the evidence belongs to this repository and exact contract head;
3. the evidence covers the stated capability scope;
4. the evidence is fresh under the portfolio freshness policy;
5. no unresolved blocker contradicts the claim;
6. Founder Control Room independently validates the contract and evidence.
