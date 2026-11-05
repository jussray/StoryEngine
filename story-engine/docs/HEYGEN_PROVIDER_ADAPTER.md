# HeyGen avatar-video fallback — source contract (v1)

**Status:** Feature-branch implementation; NOT deployed and NOT provider-verified.
The LEEVIZE self-hosted/open-weight render lane remains primary.
The fallback supports ONE speaking-avatar shot per request, not general text-to-video.

## Backend runtime credentials

The chargeable API call executes only in the Story Engine Node runtime behind
the Cloudflare front door. Keys stored in FCR, Cloudflare, or MakeVideo do not
automatically become available to this separate runtime.

Private backend-only environment configuration:
- HEYGEN_API_KEY: private HeyGen API key.
- HEYGEN_SUBMISSIONS_ENABLED: must be exactly true to activate paid submission.

Default is disabled. Never commit keys or place them in the browser, logs,
public Cloudflare variables, git receipts or ChatGPT conversations.

## Admin-only endpoints

All routes require Story Engine administrator identity, and per-job routes
also check the workspace access boundary.

- GET /api/video-engine/heygen/status: configuration booleans only.
- POST /api/video-engine/jobs/:job_id/heygen: submit a single speaking-avatar
  shot after production-plan validation with all of:
  shot_id, avatar_id, voice_id, current continuity_cookie,
  approve_provider_spend=true.
- GET /api/video-engine/jobs/:job_id/heygen/:attempt_id: read local status.
- POST /api/video-engine/jobs/:job_id/heygen/:attempt_id/refresh: read provider
  status for a confirmed provider video ID; never submits a new generation.

The fixed provider API endpoints (verified against HeyGen documentation on October 20, 2026) are:
POST https://api.heygen.com/v3/videos
GET https://api.heygen.com/v3/videos/{video_id}

This uses HeyGen v3 avatar+voice text input, 720p and the approved shot aspect ratio. The fixed, persisted attempt ID is sent as HeyGen's Idempotency-Key. This provides additional provider-side protection within its documented 24-hour window. Arbitrary provider URLs are rejected
because the API origin is fixed in the adapter.

## Cost, consent and provider uncertainty

HeyGen jobs may consume credits. This adapter CANNOT enforce a provider dollar
price ceiling or estimate final charges. Spend acknowledgement is NOT a price
estimate or budget limit. Explicitly inspect the HeyGen account credit and plan
terms before activating the backend switch and sending each requested shot.
No automatic multi-shot submission is implemented.
Presenter/avatar permissions and creator rights remain a separate review.

A SQLite reservation occurs BEFORE network submission, guarded by a unique
job+shot+continuity key. Concurrent identical requests and replays reuse the existing attempt rather than spending credits twice. A changed avatar or voice for the same job, shot and continuity is rejected with HEYGEN_REQUEST_CONFLICT rather than silently reusing the old media.

If a network timeout or ambiguous provider response occurs, the attempt becomes
needs_reconcile. Never automatically retry an uncertain submission: it might
already have been accepted or charged. Reconcile manually in the provider
account before creating new jobs. HTTP 4xx requests are marked rejected without
automatically retrying either.

Each attempt retains a SHA-256 digest of submitted request bytes, continuity
marker, provider video ID when available, and immutable hash-linked events.
Raw API keys, provider responses, private media links and media bytes are NEVER
persisted in event records. Provider completion is classified as
provider_completed_unverified, not a rendered/approved/published asset.

This event history is NOT complete ACTUAL-FLOW V4 source-byte verification.
Media-byte digest, independent video playback inspection, asset rights,
receipt replay, and separate FCR release approval remain necessary.

## Offline verification and rollback

From story-engine at the exact feature-branch SHA:

    npm ci
    node --test test/heygenProvider.test.js
    npm test

GitHub Actions and Playwright evidence are separate from deployment or provider
acceptance. A live HeyGen job is not part of these offline tests.

Rollback: disable HEYGEN_SUBMISSIONS_ENABLED first. Revert the feature changes
if needed. Preserve evidence rows and in-flight provider IDs for reconciliation;
do not destroy records or automatically delete previously charged videos.

MakeVideo integration and FCR provider-capability registration remain distinct
workstreams. Neither is claimed complete by this adapter.

Official v3 schemas: https://developers.heygen.com/reference/create-video and https://developers.heygen.com/reference/get-video
