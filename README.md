# StoryEngine / L99

> **Copyright © 2024–2026 Juss Ray. All rights reserved.**
> This is proprietary software. No license to use, copy, modify, distribute,
> sublicense, or create derivative works is granted. See [LICENSE](LICENSE).

**StoryEngine is the creator-facing product. L99 is the execution runtime underneath it. They are one product architecture, not separate products.**

StoryEngine is designed to help a creator carry an idea through writing, creation, packaging, release preparation, distribution, commerce handoff, and measurement across formats such as books, picture books, movies, TV, songs, podcasts, games, comics, plays, and short-form media.

L99 supplies the runtime and operations layer that makes that product trustworthy: state integrity, provenance-safe semantic reuse, recovery, shadow validation, observable promotion controls, event truth, creator-control modes, and release gates.

```text
Idea
→ Write
→ Create
→ Package
→ Release gate
→ Publish / distribute through approved channels
→ Sell
→ Measure
```

The product goal is end-to-end creation and publishing. Current capability claims remain bounded by verified runtime evidence: a designed stage is not automatically a production-ready stage, and draft generation is not direct publishing until the publishing path is implemented and proved.

## Product identity

| Surface | Role |
|---|---|
| **StoryEngine** | Customer-facing creator product and market identity |
| **L99** | StoryEngine execution, state, provenance, recovery, orchestration, and evidence runtime |
| **RiverEditor** | Authoring and transformation surface inside StoryEngine |
| **Release gates** | Founder/creator-controlled boundary between generated work and consequential publication or distribution |

Internal `l99_*` runtime names, event types, APIs, telemetry, and operational artifacts intentionally keep the L99 name. Customer-facing surfaces should lead with **StoryEngine** and may identify L99 as the runtime powering the product.

## Code audit status

A repository-wide code audit is in progress. The runtime and promotion-gate foundations are substantial, but the system is not yet verified as production-safe.

Current code implements cryptographic Stripe webhook signature verification and replaces legacy browser-readable API-key persistence with an in-memory bootstrap exchange for a server-issued HttpOnly SameSite session cookie. Those implementation facts do not prove live Stripe delivery or complete production authorization. Remaining release blockers include tightening the browser Content Security Policy, proving workspace authorization on every read and mutation path, attaching immutable exact-head evidence to the canonical capability contract, and proving live provider/runtime outcomes. A valid local signature test is not a live Stripe receipt, and passing isolated tests is not a production-readiness claim.

## AI operating contracts

- [`GLOBAL_AI.md`](GLOBAL_AI.md) — provider-neutral founder contract
- [`CLAUDE.md`](CLAUDE.md) — Claude / Claude Code repository instructions
- [`AGENTS.md`](AGENTS.md) — Codex, ChatGPT, and repository-agent instructions
- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — Claude, Codex, OpenAI, Anthropic, Perplexity, and GitHub boundaries

Shared founder stack:

```text
/garyvee lindymode redteam l99 redteam ooda
```

The first redteam attacks the premise. The second attacks the selected implementation. Provider instructions may become stricter for L99, but they may not weaken isolation, provenance, revocation, evidence, approval, rollback, or truthfulness.

## Current foundation

- `policies/cross_user_leak_detection.md` — structural isolation and incident-response policy.
- `policies/cache_contract.schema.json` — machine-readable semantic cache entry contract.
- `policies/provenance_rules.json` — enforcement order, required matches, and promotion blockers.
- `docs/provenance_engine.md` — Provenance Engine architecture and decision model.
- `policies/multi_tenant_partitioning_strategy.md` — layered tenant/model/policy/namespace/user partitioning strategy.
- `schemas/isolation_envelope.schema.json` — machine-readable isolation envelope contract.
- `policies/cache_revocation_triggers.md` — events that invalidate cache partitions or scopes.
- `policies/semantic_cache_revocation_audit_requirements.md` — required revocation audit chain and dashboard fields.
- `runtime/partition_resolver.py` — deterministic isolation-envelope to partition-id resolver.
- `schemas/shared_event_bus_schema.json` — shared operational event contract with schema versioning, parent links, correlation IDs, trace IDs, Lindymode event types, shell command events, and style-chain telemetry events.
- `docs/shared_event_bus_format.md` — event vocabulary, grouping rules, and event-bus invariants.
- `docs/event_bus_design_notes.md` — tenant-first filtering, severity-second grouping, and correlation-chain strategy.
- `docs/correlation_ids.md` — incident-chain correlation and parent-event rules.
- `docs/events_live_feed_service.md` — append-only NDJSON live-feed service design.
- `docs/lindymode_event_producer_spec.md` — Lindymode producer contract for continuity drift, summary refresh, and recovery events.
- `runtime/lindymode_event_emitter.py` — Lindymode NDJSON event emitter.
- `docs/rivereditor_shell_command_structure.md` — RiverEditor multi-mode command shell design.
- `schemas/rivereditor_command_registry.schema.json` — command registry schema.
- `configs/rivereditor_command_registry.json` — first command registry for authoring, style, review, query, and operator commands.
- `runtime/rivereditor_shell_router.py` — command parser/router skeleton with shell event creation.
- `runtime/rivereditor_handlers.py` — the runtime binding the router intentionally leaves out: resolves, executes, and emits events for `/ghost`, `/caveman`, `/style chain`, `:open episode`, `:emit lindy-event`, and the rest of the registry.
- `docs/rivereditor_l99_latency_monitor.md` — L99 tail-latency monitor spec for style-chain operations.
- `schemas/style_chain_telemetry.schema.json` — telemetry record schema for command and stage latency slices.
- `runtime/style_chain_l99_analyzer.py` — no-dependency reporter for p50, p95, L99, success, rollback, validation, migration, and registry-block rates.
- `runtime/rivereditor_l99_latency_monitor.py` — richer chain-rollup L99 report.
- `runtime/l99_rolling_window.py` — persists successive L99 reports as rolling window snapshots.
- `runtime/l99_event_bus.py` — shared `validate_event`/`append_event` used by every event producer in this repo.
- `runtime/artifact_writer.py` — writes machine-readable decision, revocation, incident, Lindymode, and shell artifacts.
- `runtime/events_feed_server.py` — zero-dependency HTTP service connecting the live events dashboard to the live feed.
- `dashboards/l99_events_dashboard.html` — tenant-first, severity-second, correlation-chain-third live events dashboard.
- `runtime/promotion_gates.py` — CI promotion gates for provenance, revocation, partition-boundary, event-schema, Lindymode drift, shell-command, and L99 latency failures.
- `.github/workflows/l99-promotion-gates.yml` — runs the promotion gates in CI.
- `story-engine/BOOK_TO_SOCIAL_GATE_NOTES.md` — book-to-social creation gate for turning approved source material into TikTok, Instagram, and Facebook-ready draft artifacts without direct publishing.
- `story-engine/schemas/book_to_social_artifact.schema.json` — reduced metadata contract for book-to-social artifacts.

## Core invariants

> Semantic similarity is never proof of authorization.

> Resolve isolation first. Search semantics second.

> Revocation beats TTL.

> The event bus owns operational truth. Dashboards are views.

> Narrative-state drift is an operational event.

> One shell, many modes, one event spine.

> Tail latency is where chain failure hides.

> Draft generation is not publishing.

## Request path

```text
Creator request
→ StoryEngine surface
→ Identity Layer
→ Authorization Layer
→ L99 Provenance Engine
→ Partition Resolver
→ Semantic Cache
→ Model / tool execution
→ Evidence
→ StoryEngine result
```

## Event read model

```text
tenant_id first
severity second
correlation_id third
```

## Producer model

```text
Cache / Revocation / Rollback / Shadow / Lindymode / RiverEditor Shell producers
→ samples/events.ndjson
→ dashboards, CI gates, incident episode views, replay tools, and L99 monitors
```

## RiverEditor shell modes

```text
> action/navigation
/ writing and AI transforms
: operator/system actions
@ agents and personas
? queries and inspection
```

## L99 latency monitor slices

```text
profile tier
cache state
command type
chain id
registry schema version
handler / stage
tenant / workspace
```

## Next implementation targets

1. Add a provenance decision evaluator (`artifact_writer.build_decision_artifact` formats and validates a decision from explicit inputs; it does not yet evaluate live cache candidates).
2. Add boundary and revocation test fixtures beyond the property checks already covered by `runtime/promotion_gates.py`'s `revocation` and `partition_boundary` gates.
3. Add a runtime book-to-social artifact producer that implements `story-engine/BOOK_TO_SOCIAL_GATE_NOTES.md`, validates `story-engine/schemas/book_to_social_artifact.schema.json`, and proves any user-visible preview with Playwright before promotion.
4. Expand the verified StoryEngine release path format by format, preserving the rule that consequential publishing/distribution remains behind explicit authority and outcome evidence.

## License

Copyright © 2024–2026 Juss Ray. All rights reserved.
Proprietary software — see [LICENSE](LICENSE).
