# Semantic Cache Revocation Audit Requirements

## Goal

Make cache revocation observable, queryable, and usable by promotion gates and dashboards.

## Required audit chain

Every revocation must connect three records:

1. The triggering control-plane event.
2. The invalidation action taken by the cache layer.
3. The recovery or promotion decision that followed.

Without all three, L99 cannot prove whether a permission or scope change actually removed unsafe reuse.

## Required fields

Each revocation audit event must include:

- `event_id`
- `trigger_event_id`
- `tenant_id`
- `user_scope`
- `authorization_scope`
- `namespace`
- `reason`
- `severity`
- `previous_revocation_epoch`
- `new_revocation_epoch`
- `affected_partitions`
- `affected_entry_count`
- `invalidation_action`
- `initiated_by`
- `created_at`
- `completed_at`
- `propagation_status`
- `promotion_blocked`
- `shadow_validation_required`
- `dashboard_visible`

## Query requirements

Audit storage must support queries by:

- tenant;
- namespace;
- user scope;
- authorization scope;
- revocation reason;
- event time range;
- propagation status;
- promotion-blocking status.

## Promotion requirements

Promotion must fail if:

- revocation propagation is incomplete;
- a revoked scope is observed in semantic-hit candidates;
- stale-after-revoke count is greater than zero;
- revocation audit logs are missing required fields;
- shadow validation has not completed after a severity-bearing revocation.

## Dashboard requirements

Dashboards should show a revocation event history panel with:

- event timeline;
- tenant and namespace filters;
- affected partition count;
- invalidation action;
- propagation status;
- promotion block status;
- linked shadow-validation result.

## Core invariant

> A revocation is not complete until invalidation, audit, and promotion state agree.