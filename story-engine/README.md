# L99 Story Engine

StoryEngine is the creator-facing L99 narrative runtime: create a workspace, plan and write a book, preserve continuity/provenance, generate derived artifacts such as Story Video, and pass explicit release gates before an output is promoted.

This README describes the **current source/runtime boundary**. It is not a launch-readiness claim.

## Runtime

```bash
npm ci
npm start
```

Then open `http://localhost:3000`.

- Requires **Node 24+** (`package.json` is authoritative).
- Runtime data is currently backed by Node's built-in `node:sqlite`.
- In production, `config/db.js` requires `L99_DB_PATH`; the canonical Railway service mounts persistent `/data`.
- Playwright is a development/test dependency and is required for the repository's browser proof gates.

## Current authority boundaries

StoryEngine is no longer an unauthenticated single-user local prototype.

- API/bootstrap identities are scoped through `L99_API_KEYS_JSON`.
- Browser sessions use an opaque `HttpOnly`, `SameSite=Strict` `l99_session` cookie.
- Tenant/workspace access is enforced server-side through `securityContext.js` and workspace memberships.
- Global mission-control operations are administrator-only; creator runtime processing is workspace-scoped.
- Current server sessions are process-memory sessions. A public account-signup/recovery layer is still a separate launch gate and must not be inferred from the existing bootstrap/session mechanism.

## Persistence authority

### Current production truth

SQLite remains the active StoryEngine runtime persistence layer until a Supabase cutover is explicitly migrated and proven.

### Supabase candidate

The repository contains a `supabase/` migration carrier for the founder-selected StoryEngine Supabase project. That carrier defines the existing durable StoryEngine content concepts rather than a parallel product model:

- `stories`
- `workspace_memberships`
- `outlines`
- `chapters`
- `story_artifacts`

The migration is server-only by default: RLS is enabled and forced, `anon` and `authenticated` direct access is revoked, and no browser policy is created. Do **not** call Supabase production persistence until the provider project association, migration result, credentials, data cutover, and real runtime path are separately proven.

## Main creator path

The current launch-critical path is:

1. establish an authorized creator session;
2. create or enter an isolated workspace;
3. choose the StoryEngine mode/assist authority;
4. write or generate the manuscript through the runtime queue;
5. persist chapters and continuity/provenance state;
6. package an artifact;
7. validate the artifact through the real authenticated route with Playwright;
8. pass release gates;
9. only then promote/publish through an authorized provider path.

The Autonomous Studio book path materializes a six-chapter first-draft manuscript, persists the chapters, exposes a real artifact route, and refuses release when required artifact proof is absent. Test doubles used in CI are not live-provider evidence.

## Key source areas

```text
server.js                         HTTP server, auth middleware, route mounting, runtime scheduler
config/db.js                     SQLite authority + production path checks
lib/securityContext.js           sessions, roles, tenant/workspace access
lib/runtimeDispatcher.js         queued/scoped autonomous runtime processing
lib/autonomousBookProducer.js    Autonomous Studio manuscript materialization
lib/artifactValidation.js        persisted artifact + real-route validation state
lib/proseQuality.js              prose quality fingerprints/continuity cookie
routes/storyEngine.js            creator StoryEngine run surface
routes/missionControl.js         admin/global vs creator/scoped runtime authority
models/                          SQLite-backed story/outline/chapter/event models
db/schema.sql                    current SQLite runtime schema
public/                          creator and operations browser surfaces
e2e/                             real-path Playwright proof
../supabase/                     proposed durable content-plane migration carrier
```

## OODA / evidence loop

StoryEngine records operational events and promotion evidence rather than treating a green unit test as production proof. Runtime/release work is expected to keep separate receipts for:

- source correctness;
- tenant/workspace authority;
- browser behavior;
- provider/API behavior;
- deployment identity;
- persistence and migration state;
- rollback/recovery.

Old proof becomes historical when its exact subject moves.

## SQLite performance

`config/db.js` applies WAL/performance settings to the active SQLite database, including WAL journal mode, bounded busy timeout, cache configuration, and startup schema application. Production uses the configured persistent path rather than an in-memory or temporary database.

## Known launch gates

These are separate receipts, not one generic "not ready" state:

- public account signup/recovery is not yet equivalent to the existing scoped bootstrap/session mechanism;
- Supabase provider association and schema/runtime cutover require live provider proof before becoming persistence authority;
- Cloudflare's attached `storyengine` build lane must be reconciled against the canonical Railway runtime instead of being treated as green or ignored;
- exact-head CI/Playwright evidence is required after any candidate head changes;
- production deployment identity must match the exact promoted `main` SHA before release is called complete.

See the repository root documentation, open issues, and current PR receipts for the exact live gate state.
