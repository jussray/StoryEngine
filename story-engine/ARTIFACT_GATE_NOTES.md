# Artifact Gate Notes

The Artifact + Playwright validation stage has been added to the L99 OS Alpha pipeline.

Current implemented pieces:

- `lib/artifactValidation.js`
  - Generates a reviewable HTML artifact from the workspace/story output.
  - Stores artifacts in `story_artifacts`.
  - Performs structural checks.
  - Attempts Playwright browser validation when `playwright` is installed.
  - Records validation as required before `redteam_pre_release`.

- `lib/storyEngineOrchestrator.js`
  - Pipeline order now includes:
    - `artifacts`
    - `playwright_validation`
    - `redteam_pre_release`
    - `release_gate`
  - Pre-release redteam receives artifact validation and blocks if validation fails.

- `routes/artifacts.js`
  - Adds artifact read, HTML render, validation, and workspace artifact list routes.

- `package.json`
  - Adds optional `playwright` dependency.
  - Adds `test:playwright` script.

## Book-to-social gate extension

The next Story Engine content surface is book-to-social draft generation: approved book/source material becomes reviewable TikTok, Instagram, and Facebook-ready draft artifacts.

This work belongs in this repository, not in Se'kret Bip and not in Founder Control Room.

The gate is documented in:

- `BOOK_TO_SOCIAL_GATE_NOTES.md`
- `schemas/book_to_social_artifact.schema.json`

Boundary:

- Playground / Meta Model API may help create draft scripts, hooks, captions, carousels, voiceovers, and content-calendar entries from approved book material.
- Story Engine / Meta social APIs are a separate future distribution surface for Facebook and Instagram.
- TikTok requires a separate TikTok developer/API path for posting or account connection.
- Draft generation is not publishing.
- No model key, social token, page token, TikTok token, webhook secret, raw book dump, or private teen data belongs in committed artifacts, logs, issues, PRs, or long-lived telemetry.

Before runtime implementation, add tests proving:

1. source-rights metadata is required;
2. the reduced artifact schema validates generated metadata;
3. draft artifacts cannot mark themselves as published;
4. Playwright preview validation covers any user-visible book-to-social artifact;
5. platform handoff is explicit for TikTok, Instagram, and Facebook.

Follow-up required because of GitHub write conflicts during implementation:

- Re-fetch latest `server.js` and register `artifactRoutes(router, db)` if not already present.
- Re-fetch latest `routes/storyEngine.js` and ensure async `getStoryEngineRun()` is awaited in GET/resume routes.
- Add/adjust tests for the inserted pipeline order.
- Add the book-to-social runtime producer only after the gate/spec above is reviewed.
