# LEEVIZE product design truth states

The creator-facing video product must never collapse planning, rendering, proof, and release into one green badge.

## Required user-visible states

1. `PLAN_DRAFT` — shot plan exists; no Playwright proof yet.
2. `PLAN_VERIFIED` — product/UI plan passed Playwright; this is not finished footage.
3. `RENDER_BLOCKED_INFRASTRUCTURE` — self-hosted GPU/workflow/license preflight is not ready. Vendor credits do not control this state.
4. `RENDERING` — real shot generation is executing on the selected worker.
5. `SHOT_PARTIAL` — some current-continuity shots are verified while others remain missing or failed. Preserve successful shots.
6. `FOOTAGE_VERIFIED` — every intended shot has playable-media proof bound to the current continuity cookie.
7. `MASTER_VERIFIED` — deterministic assembly produced a verified playable master.
8. `RELEASE_BLOCKED` or `RELEASE_READY` — release authority and platform proof are evaluated separately from render success.

## Product interaction rules

- Show the primary lane as **Self-hosted / open-weight**.
- Show GPU reachability, workflow configuration, and license review as separate facts.
- Display the continuity cookie as a shortened, non-secret marker labeled **marker only, never authority**.
- Editing canon or the shot plan invalidates old render proof by changing the continuity cookie.
- A failed shot never removes already verified neighboring shots.
- `Render Actual Video` is unavailable until the production plan is verified and the runtime preflight is genuinely ready.
- `Assemble Master` is unavailable until all intended shots for the current continuity cookie have verified outputs.
- Paid renderers are repair/fallback options, never the only route or the source of canon.
- Publishing remains a separate approval and provider-outcome gate.

## Failure receipts

Distinct failures remain distinct. Compute, workflow, license, media verification, continuity drift, assembly, platform publishing, analytics, and provider-model failures may never be collapsed into one generic blocked state.
