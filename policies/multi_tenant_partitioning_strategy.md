# Multi-Tenant Semantic Cache Partitioning Strategy

## Goal

Design semantic-cache lookup so similarity never bypasses tenant, user, authorization, namespace, model, or policy boundaries.

## Partitioning model

Use layered partitioning before semantic nearest-neighbor lookup:

1. `tenant_id` as the top-level partition.
2. `model_version` and `policy_version` as the second-level partition.
3. `namespace` or workflow scope as the third-level partition.
4. Optional `user_scope` subpartition when output is personalized.
5. `revocation_epoch` and `partition_version` as invalidation and migration controls.

Within each resolved partition, semantic nearest-neighbor search may compare only entries that share the same isolation envelope.

## Lookup path

```text
Request
  ↓
Build Isolation Envelope
  ↓
Resolve Partition ID
  ↓
Search only inside resolved partition
  ↓
Run provenance validation on candidate
  ↓
Evaluate semantic similarity
```

The semantic index must not receive entries outside the resolved partition.

## Isolation envelope fields

Required fields:

- `tenant_id`
- `user_scope`
- `authorization_scope`
- `namespace`
- `model_version`
- `policy_version`
- `memory_schema_version`
- `revocation_epoch`
- `partition_version`

Optional fields:

- `workflow_id`
- `region`
- `data_residency_zone`
- `shared_scope_policy`

## Composite key pattern

```text
isolation_envelope_hash = SHA256(
  tenant_id ||
  user_scope ||
  authorization_scope ||
  namespace ||
  model_version ||
  policy_version ||
  memory_schema_version ||
  revocation_epoch ||
  partition_version
)

semantic_key = embedding(normalized_request)
lookup = semantic_cache[isolation_envelope_hash].nearest_neighbor(semantic_key)
```

## Why this works

Layered partitioning makes isolation structural. A highly similar prompt in another tenant, authorization scope, policy version, or revocation epoch is not a candidate, because it is never searched.

This also improves observability and recovery:

- tenant-level invalidation can target one top-level partition;
- policy changes can invalidate only matching policy partitions;
- namespace incidents can be isolated without flushing unrelated workflows;
- user-specific reuse can be restricted to personalized subpartitions;
- revocation epochs can invalidate stale entries immediately.

## Promotion blockers

Promotion must fail if:

- the isolation envelope is incomplete;
- semantic lookup occurs before partition resolution;
- a candidate from another partition is observed;
- revocation epoch is ignored;
- partition resolver output is not audited;
- user-specific output is stored in a shared partition without explicit policy;
- policy or model version changes do not create a new partition or invalidation artifact.

## Dashboard requirements

Dashboards should expose:

- active partition count;
- partition hit/miss rate;
- partition warm coverage;
- revocation event count by partition;
- blocked cross-partition candidates;
- promotion blockers by partition;
- stale-after-revoke count by tenant and namespace.

## Core invariant

> Resolve isolation first. Search semantics second.