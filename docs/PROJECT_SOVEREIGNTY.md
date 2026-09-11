# Project Sovereignty Contract

This project must preserve its core product meaning and critical operating capability if an external provider, API, SDK, model, connector, runtime, or vendor disappears or materially changes.

## Invariants

- Project-owned contracts define canonical inputs, outputs, errors, authority, state, evidence, and completion semantics.
- External providers are adapters, not project identity.
- Critical dependencies are classified `REPLACEABLE`, `DEGRADED_FALLBACK`, `HARD_DEPENDENCY`, or `UNKNOWN`.
- A critical capability must have an alternate adapter, local/open implementation, deterministic fallback, export/manual recovery path, or honest safe degraded mode unless a documented hard dependency is explicitly accepted.
- Critical data keeps project-owned semantics and a migration/export path; vendor IDs are provenance, not canonical identity.
- Provider swaps must not broaden authority, replay stale approvals, duplicate mutations, or weaken evidence requirements.
- Provider-specific results map into project-owned receipts; provider acceptance is not founder-goal outcome proof.
- When operated through Founder Control Room, this project remains a sovereign subsystem, not a separate founder operating system. FCR remains the founder-facing orchestration, authority, evidence, outcome, and next-gate plane.

## Mandatory audit question

> If every named provider disappeared now, what exactly would stop, what would survive, what is the recovery path, and what evidence proves that answer?

Architecture docs are not failover proof. Verify contract, adapter, focused test, runtime, data-exit path, and real-path evidence separately.

Future provider work must follow the smallest reversible repair workflow: Reality → Redteam I → Lindy → L99 → OODA → implement → focused proof → Redteam II / provider-loss attack → rollback → next gate.
