# Cross-User Leak Detection Policy

## Core law

> Semantic similarity is never proof of authorization.

L99 must structurally isolate semantic-cache entries before similarity is evaluated. Identity, tenant, authorization scope, provenance domain, revocation state, and TTL validity are mandatory parts of the cache contract.

## Request path

```text
Request
→ Identity Layer
→ Authorization Layer
→ Provenance Engine
→ Semantic Cache
→ Model
```

The semantic cache must never make an access-control decision. A request may only reach semantic lookup after identity and authorization checks pass.

## Required checks for every candidate hit

1. Tenant ID matches exactly.
2. User scope matches the permitted reuse policy.
3. Authorization scope matches exactly or satisfies an explicit narrowing rule.
4. Provenance domain matches.
5. The entry has not been invalidated by permission revocation.
6. TTL is valid.
7. Producer and consumer scopes are logged.
8. Entry confidence and integrity hashes satisfy policy.

## Immediate block conditions

- Cross-tenant mismatch.
- Cross-user mismatch outside an explicitly shared scope.
- Authorization-scope mismatch.
- Provenance-domain mismatch.
- Stale-after-revoke reuse.
- Missing identity or provenance metadata.
- Invalid state, summary, or content hash.

Any immediate block condition must produce a cache miss and a structured security event. Security failures must not fall back to threshold tuning.

## Incident responses

### `cross_user_leak`

- Classify as `sev3`.
- Disable semantic hits for affected partitions.
- Switch affected traffic to miss-only mode.
- Flush affected cache partitions or provenance domains.
- Block threshold promotion.
- Require strict cold-start and shadow validation.

### `cross_tenant_leak`

Use the same containment response as `cross_user_leak`, but expand the investigation to every partition sharing the faulty key, index, or routing policy.

### `authorization_mismatch`

- Block the hit.
- Record producer and consumer authorization scopes.
- Invalidate affected entries.
- Enter containment if the mismatch was served to a user.

### `stale_after_revoke`

- Block the hit.
- Invalidate entries connected to the revoked authorization scope.
- Require strict cold-start for the affected scope.
- Verify revocation propagation before semantic reuse resumes.

## Dedicated metrics

- `leak_candidate_count`
- `cross_scope_hit_blocked_count`
- `cross_user_leak_count`
- `cross_tenant_leak_count`
- `stale_after_revoke_count`
- `provenance_mismatch_count`
- `authorization_mismatch_count`
- `security_containment_trigger_count`
- `safe_semantic_hit_count`
- `miss_due_to_provenance_count`

## Audit requirements

Every semantic-cache decision must record:

- request ID;
- candidate entry ID;
- producer tenant and user scope;
- consumer tenant and user scope;
- producer and consumer authorization scope;
- provenance domain;
- revocation version or epoch;
- TTL decision;
- integrity-hash decision;
- final action: `allow`, `miss`, `block`, or `contain`;
- machine-readable reason code.

## Promotion rule

A release must fail promotion when tenant, user, authorization, provenance, or revocation boundaries are absent from the cache contract or cannot be audited.