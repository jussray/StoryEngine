# Registry Migration Anomaly Alert

## Goal

Detect abnormal migration and rollback behavior without alerting on every individual failure.

## Signals

Track anomaly-style alerts across:

- migration failure rate;
- migration blocked rate;
- rollback rate after migration;
- L99 chain latency after migration;
- unsupported-registry block rate;
- concentration by profile tier;
- concentration by registry schema version.

## Alert sequence

1. Detect deviation from recent baseline.
2. Confirm concentration in one schema version, profile tier, command type, or chain.
3. Correlate with migration and rollback events.
4. Emit one `anomaly.alert_triggered` event with a shared `correlation_id`.

## Reduce noise

Do not alert on every single failed migration. Alert when the failure pattern is sustained, concentrated, or linked to rollback / latency degradation.

## Example event

```json
{
  "schema_version": "1.0",
  "event_version": 1,
  "event_id": "evt_anomaly_001",
  "event_type": "anomaly.alert_triggered",
  "timestamp_utc": "2026-07-07T10:30:00Z",
  "tenant_id": "tenant_alpha",
  "namespace": "rivereditor_registry",
  "severity": "sev2",
  "status": "active",
  "source_system": "l99_latency_monitor",
  "reason": "migration_block_rate_exceeded_baseline_for_starter_tier",
  "correlation_id": "inc_registry_alpha_001",
  "registry_schema_version": "1.1.0",
  "profile_tier": "starter"
}
```

## Core invariant

> Alert on concentrated patterns, not isolated noise.
