---
name: makevideo
description: Renderer-neutral, evidence-aware video production protocol for turning ordinary-language intent into verified multi-shot video while preserving canon, continuity, provenance, cost, and release truth.
version: 2.1
owner: Juss
trigger:
  - /MAKEVIDEO
  - /makevideo
  - /LEEVIZE
  - /video
---
# /MAKEVIDEO v2.1

## Mission

Turn ordinary-language creative intent into the closest possible verified finished video using capabilities that actually exist. `/MAKEVIDEO` defines the protocol. `/LEEVIZE` is the configured StoryEngine implementation. Renderers are replaceable workers.

Do not stop at ideation or storyboards when execution capability exists. Do not claim rendering, verification, publication, or product truth without receipts.

## Governing invariant

No renderer owns canon, evidence, approvals, budget, release authority, or durable production state.

Every external action leaves durable evidence before another action depends on it. Every released byte has provenance. Every paid action has accounting. Every retry has a reason. Every release has a receipt.

Short rule: **never convert “the tool said it worked” into “it worked.”**

## Authority split

- `/MAKEVIDEO`: protocol, object types, legal transitions, fingerprint rules, receipt requirements, approval levels.
- `/LEEVIZE`: adapters, queues, storage, QA tooling, budget policy values, and operator surfaces.
- Human or explicitly authorized reviewer: scoped creative, truth, rights, timeline, and release approvals.
- Renderer/worker: bounded byte production only.

Fingerprints and proof cookies are non-secret continuity markers. They never grant action, publishing, billing, deployment, or approval authority.

## Three state scopes

Never collapse these into one lifecycle:

1. `ShotObjective`: `OPEN -> SATISFIED | ABANDONED`. A rejected render attempt does not kill the shot objective.
2. `JobAttempt`: bounded execution attempt. Attempts may become `APPROVED`, `REJECTED`, `SUPERSEDED`, or `PERMANENTLY_FAILED` without rewriting history.
3. `Release`: `DRAFT -> ASSEMBLED -> QA_PENDING -> RELEASE_CANDIDATE -> VERIFIED -> PUBLISH_APPROVED -> PUBLISHING -> PUBLISHED` with `BLOCKED` as an evidenced hold state. Approval to publish is not proof of publication.

Executable transition rules live in `story-engine/lib/makevideoProtocol.js`.

## Canon split

Keep three independent authorities:

- `CreativeCanon`: characters, wardrobe, locations, props, visual language, story state.
- `EvidenceCanon`: source footage, documents, product behavior, claims, known unknowns.
- `ReleaseCanon`: permitted claims, rights state, disclosures, platform constraints, approved/blocked assets.

A renderer cannot promote a claim merely because generated media looks persuasive.

Claim classes:

`VERIFIED`, `DEMONSTRATED`, `DOCUMENTED`, `TESTIMONIAL`, `ILLUSTRATIVE`, `DRAMATIZED`, `SIMULATED`, `INFERRED`, `UNKNOWN`.

Only exact-scope verified/demonstrated/documented evidence may serve as factual proof. Testimonial remains attributable testimony, not independent proof.

## Fingerprints and cookies

Canonical fingerprints use SHA-256 over canonical JSON with recursively sorted keys, Unicode NFC normalization, normalized UTC timestamps, finite-number enforcement, and transient provider state excluded from idempotency.

Required production fingerprints include, when applicable:

- intent/objective fingerprint
- source revision fingerprint
- creative canon fingerprint
- evidence canon fingerprint
- release canon fingerprint
- shot-plan fingerprint
- bounded-input asset fingerprints
- job-spec/idempotency fingerprint
- renderer/adapter version fingerprint
- continuity packet fingerprint
- output asset fingerprint
- receipt-event fingerprint
- review fingerprint
- release fingerprint

LEEVIZE continuity cookie:

- compact public-safe marker for current source/canon/shot-plan state
- accompanied by full `sha256:` fingerprints
- stale when any bound state changes
- never a browser auth cookie
- never contains credentials
- never authorizes action or publication

LEEVIZE proof cookie:

- binds rendered output evidence to the current continuity fingerprint
- preserves output/workflow/media-probe identity
- stale continuity invalidates old green proof
- never authorizes action or publication

## Jobs and retries

A `JobSpec` is immutable. Mutable provider status does not belong in the job spec. Current views are derived from append-only state/receipt events.

Idempotency binds protocol version, job kind, objective, immutable job spec, canon versions, adapter identity/version, bounded input hashes, expected outputs, cost ceiling, retry ordinal, and repair specification.

Distinguish:

- provider reconciliation: resume the same accepted external job, no new render;
- infrastructure retry: repeat the same semantic request only when provider idempotency/reconciliation proves duplication is controlled;
- creative repair: new attempt with changed repair spec or inputs and therefore a new fingerprint.

## Receipts

Receipts are append-only event chains. At minimum preserve:

`SUBMITTED -> PROVIDER_COMPLETED -> ASSET_PERSISTED -> QA_RECORDED`

The accepted provider job ID must become durable local state before the system can safely release control and retry elsewhere.

Each receipt event binds its payload fingerprint and previous event hash. Never mutate history to make a failed attempt look green.

## Continuity

Every approved generated shot should leave a `ContinuityPacket` carrying the actual end-frame asset identity plus character, camera, environment, prop, story-clock, dialogue/audio-tail, and next-shot constraints needed by the next worker.

Use actual pixels/reference assets where supported. Prose continuity alone is not enough for long-form work.

## QA

Separate:

- `MachineValidation`: decode, duration, codec, resolution, frame extraction, checksums, file existence, syntax/loudness checks. Deterministic failures block automatically.
- `MachineSignals`: similarity, detected text, face count, frozen-frame probability, clipping risk. Signals route review; they do not grant approval.
- `HumanReview`: identity, performance, continuity, product truth, story function, rights/release fit.

Never let a similarity threshold automatically approve narrative identity or truth.

## Product/documentary truth

Prefer real browser/device capture for real product behavior. Generated UI is `SIMULATED` or `ILLUSTRATIVE`, never demonstrated product proof.

Generated cinematic material may surround evidence but must not silently replace evidence.

## Cost

Reserve budget before paid execution. Commit actual provider cost from accounting evidence. Release only the unused reservation. Failure state alone never determines billing state. If cost is unknown, keep the reservation held pending reconciliation.

## Publication

`VERIFIED` means the finished media passed release gates. `PUBLISH_APPROVED` means publication is authorized. `PUBLISHED` requires a real publish receipt with platform result and platform identifier/URL. Never turn approval into publication proof.

## Execution order

```text
intent
-> classify truth
-> lock creative/evidence/release canon
-> create shot objectives
-> compile immutable bounded jobs
-> fingerprint + reserve
-> capability-match worker
-> durably record submission
-> render
-> persist + hash artifacts
-> machine validate
-> inspect/review
-> create continuity packet
-> approve or repair
-> satisfy objective
-> assemble approved assets
-> full QA
-> release receipt
-> publish approval
-> publish action
-> publish receipt
```

## Done

`FINAL_VIDEO = VERIFIED` only when story, continuity, visual, audio, truth, technical, intent, rights, and delivery requirements pass for the requested release.

`PUBLISHED` is a separate proven state.

If blocked, return the exact missing capability/evidence/authority and the next executable action. Never manufacture green state.
