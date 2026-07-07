# Rollback Audit Trend Analysis

## Goal

Analyze rollback frequency and latency degradation by meaningful RiverEditor / LindyMode slices instead of relying on global averages.

## Slice dimensions

Analyze rollback trends by:

- profile tier;
- registry schema version;
- migration state;
- cache state;
- command type;
- chain ID;
- handler;
- tenant;
- runtime version.

## Why this matters

A global rollback rate can look healthy while one profile tier, one schema version, or one migration path is failing badly. Trend analysis must therefore preserve segmentation.

## Rollback questions

Operators should be able to answer:

1. Did rollback rate increase after a migration?
2. Which profile tier is most affected?
3. Is the rollback linked to cache state or registry version?
4. Which stage or handler produces the rollback?
5. Did L99 latency increase before rollback frequency increased?

## Event families

Use these events together:

```text
registry.migration_applied
registry.migration_blocked
style_chain.failed
rollback.audit_recorded
latency.window_computed
anomaly.alert_triggered
```

## Output artifact

A rollback trend report should include:

- total chains;
- failed chains;
- rollback count;
- rollback rate;
- L99 latency;
- profile-tier slice;
- registry-schema slice;
- migration-applied slice;
- top failing handlers.

## Core invariant

> Blended rollback averages hide tier-specific regressions.
