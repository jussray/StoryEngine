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

Follow-up required because of GitHub write conflicts during implementation:

- Re-fetch latest `server.js` and register `artifactRoutes(router, db)` if not already present.
- Re-fetch latest `routes/storyEngine.js` and ensure async `getStoryEngineRun()` is awaited in GET/resume routes.
- Add/adjust tests for the inserted pipeline order.
