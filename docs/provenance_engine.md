# L99 Provenance Engine

## Purpose

The Provenance Engine is the mandatory trust boundary between authorization and semantic reuse. It does not generate content. It decides whether a cache candidate is eligible to be considered at all.

## Architecture

```text
Request
  ↓
Identity Layer
  ↓
Authorization Layer
  ↓
Provenance Engine
  ↓
Semantic Cache
  ↓
Model or verified cached result
```

Semantic similarity is evaluated only after every structural safety check succeeds.

## Responsibilities

- Validate tenant identity.
- Validate producer and consumer user scope.
- Validate authorization scope.
- Validate provenance domain.
- Validate revocation epoch.
- Validate TTL.
- Validate content, state, and summary hashes.
- Emit an auditable decision.
- Produce dedicated security and quality metrics.
- Trigger containment or cold-start recovery when required.

## Decision contract

The engine returns one of four actions:

- `allow`: structural checks passed; semantic similarity may now be evaluated.
- `miss`: entry is safe to ignore but does not require containment.
- `block`: structural trust failed; do not use the entry.
- `contain`: a boundary failure may have affected served output; activate incident response.

Example decision:

```json
{
  "request_id": "req_123",
  "candidate_entry_id": "cache_456",
  "action": "block",
  "reason_code": "authorization_scope_mismatch",
  "semantic_similarity_evaluated": false,
  "incident_required": true
}
```

## Evaluation order

1. Identity exists and is valid.
2. Authorization is current.
3. Tenant boundary matches.
4. User reuse scope matches.
5. Authorization scope matches.
6. Provenance domain matches.
7. Revocation epoch is current.
8. TTL is valid.
9. Integrity hashes match.
10. Confidence policy passes.
11. Semantic similarity may be evaluated.

This order prevents a highly similar entry from bypassing identity or authorization controls.

## Boundary failures versus quality failures

### Boundary failures

Examples:

- tenant mismatch;
- user-scope mismatch;
- authorization mismatch;
- stale reuse after permission revocation;
- provenance-domain mismatch.

Response:

```text
Block
→ Record security event
→ Invalidate affected entries
→ Contain if served
→ Cold-start and shadow validation when required
```

### Quality failures

Examples:

- stale summary;
- low confidence;
- expired TTL;
- narrative drift;
- integrity-hash mismatch without boundary crossing.

Response:

```text
Miss or invalidate
→ Verified rebuild
→ Shadow evaluation
→ Controlled promotion
```

## Revocation handling

Every authorization change increments or replaces a revocation epoch. Cache entries created under an older epoch are ineligible for reuse. Revocation must therefore invalidate by policy version, not only by elapsed TTL.

## Shared scopes

Shared reuse must be explicit. Supported policies are:

- `private`
- `explicit_shared`
- `tenant_shared`
- `public_verified`

The default is `private`. A broader scope must be declared when the entry is created and confirmed again when consumed.

## Required metrics

- leak candidate count;
- blocked cross-scope candidates;
- stale-after-revoke count;
- provenance mismatch count;
- authorization mismatch count;
- containment trigger count;
- safe semantic hit count;
- provenance-driven miss count.

## CI and promotion gate

Promotion must fail when:

- required cache-contract fields are absent;
- boundary tests permit mismatched scopes;
- revocation tests reuse an older authorization epoch;
- audit records cannot identify both producer and consumer scope;
- shadow validation observes any served boundary violation.

## Non-negotiable invariant

> Authorization precedes similarity, and provenance must be perfect before reuse is considered.