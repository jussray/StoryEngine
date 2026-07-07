# RiverEditor / LindyMode L99 Latency Monitor

## Goal

Treat L99 as tail-latency monitoring for RiverEditor style-chain operations and LindyMode shell workflows.

Averages hide the slowest user experiences. L99-style monitoring exists to catch the slow chain breakdowns, migrations, registry blocks, validation failures, and timeout pain that a blended average can hide.

## What to track

Track these as first-class metrics:

- chain end-to-end latency;
- stage latency by handler;
- rollback rate;
- validation failure rate;
- migration-applied rate;
- unsupported-registry block rate;
- timeout rate;
- retry rate;
- chain success rate.

## L99 slices

Slice L99 by:

- profile tier;
- cache state;
- command type;
- chain ID;
- registry schema version;
- agent or handler;
- tenant or workspace;
- project;
- pipeline name;
- runtime version;
- platform: shell, UI, CLI, API.

## Monitor panes

### Performance

- p50 / p95 / L99 chain latency;
- stage latency;
- queue wait;
- execution time;
- cache hit rate.

### Registry

- schema version distribution;
- migration success rate;
- unsupported registry blocks;
- validation failures.

### Reliability

- rollback rate;
- retry rate;
- command failures;
- timeout rate.

### Style chain health

- Ghost profile stage duration;
- Caveman rewrite stage duration;
- proofread stage duration;
- style-chain completion rate;
- continuity drift score.

### Operations

- active chains;
- commands per minute;
- events per second;
- producer health.

## Alert guidance

Prefer windowed SLO alerts over single-run alerts:

- L99 latency above threshold for a configured window;
- rollback rate above threshold;
- validation failure rate above threshold;
- migration failure rate above threshold;
- unsupported registry block rate above threshold;
- style-chain completion rate below threshold.

## Core metric

```text
chain_success_rate = completed_chains / started_chains
```

A fast chain that fails often is not healthy.

## Event model

Every command or stage should emit telemetry events:

```text
shell.command_started
style_chain.started
ghost.completed
caveman.completed
proofread.completed
style_chain.completed
shell.command_completed
```

The monitor derives chain latency and stage latency from those events.

## Core invariant

> Tail latency is where chain failure hides.
