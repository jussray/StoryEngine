# L99 Opportunity Map from 2026 AI Tooling Signals

**Research date:** 2026-07-13  
**Source brief:** `jussray/chief-ai-machine/docs/strategy/AI_TOOLING_SIGNALS_2026.md`  
**Authority:** Opportunity analysis only. This file does not change runtime contracts, event schemas, promotion gates, or roadmap status.

## Ten under-the-radar opportunities

### 1. Signed capability manifests

**Evidence:** VERIFIED. Tool poisoning and mutable descriptors are documented agent attack paths.  
**L99 idea:** Store tool identity, schema hash, permissions, owner, approval, and effective dates as versioned artifacts. Reject execution when the approved manifest no longer matches.

### 2. Memory revocation replay

**Evidence:** VERIFIED. Current agent-memory systems struggle with selective forgetting and stale experience.  
**L99 idea:** Add a replay test proving that corrected, expired, or revoked memory no longer changes downstream plans or artifacts.

### 3. Provenance-aware cache keys

**Evidence:** VERIFIED as a risk-driven requirement.  
**L99 idea:** Include tenant, workspace, policy, model, prompt, tool-manifest, source, and authorization fingerprints in reusable-result keys. Similarity remains advisory, never authority.

### 4. Typed approval events

**Evidence:** VERIFIED as a need; standardization remains PARTIAL.  
**L99 idea:** Replace generic approval flags with explicit event types such as `proposal_approved`, `branch_approved`, `promotion_approved`, `deploy_approved`, and `rollback_approved`.

### 5. Evaluation distributions

**Evidence:** VERIFIED. LLM evaluators vary across model, prompt, and out-of-distribution input.  
**L99 idea:** Promotion reports should show repeated-run variance, judge disagreement, deterministic checks, and human-anchor outcomes rather than one aggregate score.

### 6. Agent identity in every event

**Evidence:** VERIFIED. Agent-specific identity and delegated authority are becoming distinct infrastructure concerns.  
**L99 idea:** Every action event should identify model/runtime agent, human owner, credential scope, delegation source, expiry, and revocation status.

### 7. Compatibility contracts for agent handoffs

**Evidence:** VERIFIED as interoperability grows through MCP and A2A.  
**L99 idea:** Define handoff envelopes containing purpose, input provenance, allowed actions, output schema, sensitivity, expiry, and return-to-owner behavior.

### 8. Shadow self-improvement

**Evidence:** PARTIAL. Self-refining workflows are advancing, but unattended improvement is not reliably safe.  
**L99 idea:** Let agents propose prompt, policy, or workflow changes in a shadow namespace. Promotion requires locked regressions, human anchors, no isolation regression, and a rollback artifact.

### 9. Event-stream reconstruction as a product

**Evidence:** PARTIAL but strongly supported by audit and rollback needs.  
**L99 idea:** Build a “why did this happen?” reconstruction that deterministically traces source, decision, tool version, memory reads, approvals, outputs, and later corrections.

### 10. Portable workflow genomes

**Evidence:** PARTIAL. Provider-neutral files and protocols are durable, but one winning format has not emerged.  
**L99 idea:** Export a workflow as plain versioned files containing contracts, schemas, tests, examples, policy, required capabilities, and promotion criteria without provider-specific hidden state.

## Priority order

1. Signed capability manifests.
2. Agent identity and typed approval events.
3. Provenance-aware cache keys.
4. Memory revocation replay.
5. Evaluation distributions.
6. Deterministic run reconstruction.
7. Shadow improvement and portable genomes only after the controls above exist.

## Unverified claims to avoid

- “Self-healing” without measured detection, containment, recovery, and regression proof.
- “Perfect memory” without correction, deletion, expiry, and selective-forgetting tests.
- “Provider independent” when artifacts or recovery depend on one vendor’s hidden conversation state.
- “Secure MCP” based only on OAuth while tool semantics and descriptor integrity remain unchecked.

## Stop conditions

Do not implement an opportunity when it creates a second event bus, memory authority, provenance engine, release gate, or incompatible artifact format. L99 depth is supposed to reduce drift, not industrialize it.