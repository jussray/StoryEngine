# Cache Revocation Triggers

## Goal

Define which control-plane events must invalidate semantic-cache partitions, entries, or provenance domains.

## Automatic revocation triggers

### Permission revoked

Invalidate every cache entry created under the revoked authorization scope. Increment the affected `revocation_epoch`.

### Document or source unshared

Invalidate entries whose provenance domain references the unshared source. Keep production in miss-only mode for affected scope until revocation propagation is confirmed.

### Role or scope changed

Invalidate entries tied to the previous authorization scope. A role change must not rely only on TTL expiry.

### Tenant transfer or reassignment

Invalidate affected tenant partitions and block reuse until the new tenant boundary is audited.

### Model or prompt-policy invalidation

Create a new model or policy partition. Old entries may remain stored for audit, but they must not be candidates for reuse under the new policy unless explicitly migrated and verified.

### Memory schema change

Create a new memory schema partition when state packs, summaries, or continuity bundles change shape.

### Stale-after-revoke detected

Classify as a security incident. Invalidate the affected scope and require strict cold-start for that scope.

### Cache poisoning or leak incident

Disable semantic hits for affected partitions. Flush contaminated entries or domains. Rebuild only from verified fresh outputs.

### Manual invalidation

Record who initiated it, why it was initiated, which partition or scope was affected, and whether promotion should remain blocked.

## Revocation event artifact

Every revocation should produce a machine-readable artifact:

```json
{
  "event_id": "rev_001",
  "reason": "permission_revoked",
  "tenant_id": "tenant_123",
  "user_scope": "user_456",
  "authorization_scope": ["project:read"],
  "namespace": "story_state",
  "previous_revocation_epoch": 7,
  "new_revocation_epoch": 8,
  "affected_partitions": ["partition_hash"],
  "invalidation_action": "invalidate_scope",
  "promotion_blocked": true,
  "created_at": "2026-07-07T00:00:00Z"
}
```

## Dashboard requirements

Dashboards should show:

- latest revocation events;
- revocation history by tenant and namespace;
- affected partition count;
- promotion-blocking revocations;
- stale-after-revoke events;
- revocation propagation status;
- shadow-validation status after invalidation.

## Core invariant

> Revocation beats TTL. A revoked scope cannot wait for cache expiry.