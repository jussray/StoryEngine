# LEEVIZE self-hosted/open-weight renderer

## Product goal

StoryEngine must be able to create actual playable video without making a paid generation vendor the only render authority. Vendor credit exhaustion is therefore not a valid project blocker.

The production route is:

`canon -> provider-neutral shot plan -> self-hosted/open-weight render -> technical QA -> continuity QA -> deterministic assembly -> paid fallback only for a named failed shot`

## Runtime contract

The implementation in `story-engine/lib/openVideoRenderer.js` submits ComfyUI API workflows to a founder-controlled GPU worker. It does not embed provider credentials, model weights, or private runtime URLs in repository receipts.

Required runtime configuration:

- `LEEVIZE_COMFYUI_URL`: HTTP(S) origin of the ComfyUI worker. Do not include credentials in the URL.
- `LEEVIZE_COMFYUI_WORKFLOW_PATH`: repository-local ComfyUI API workflow JSON.
- `LEEVIZE_MODEL_ID`: informational model identifier for render receipts.
- `LEEVIZE_MODEL_LICENSE_STATUS=verified-commercial`: explicit license/commercial-use review result. Missing review fails closed.
- `LEEVIZE_RENDER_WORKER_ID`: non-secret worker identity label.
- optional `LEEVIZE_OPEN_VIDEO_OUTPUT_DIR`: server-side render output directory.

`ffmpeg` and `ffprobe` must also be available, using the existing `L99_VIDEO_FFMPEG_BINARY` and `L99_VIDEO_FFPROBE_BINARY` overrides when needed.

## ComfyUI workflow tokens

Export a ComfyUI workflow in API format and replace the values that LEEVIZE owns with these tokens:

- `__LEEVIZE_PROMPT__`
- `__LEEVIZE_NEGATIVE_PROMPT__`
- `__LEEVIZE_SEED__`
- `__LEEVIZE_WIDTH__`
- `__LEEVIZE_HEIGHT__`
- `__LEEVIZE_FPS__`
- `__LEEVIZE_FRAMES__`
- `__LEEVIZE_SHOT_ID__`
- `__LEEVIZE_CONTINUITY_COOKIE__`

The renderer recursively replaces tokens before submitting the workflow. The model graph therefore remains replaceable while the shot contract remains authoritative.

For Wan-family use, start from the current official ComfyUI Wan image-to-video or text-to-video workflow, export its API form, then bind these tokens to the prompt, seed, dimensions and frame-length inputs. Do not assume a model is commercially usable merely because weights are downloadable; preserve the explicit license gate.

## Continuity and proof cookies

`videoContinuity.js` creates non-secret SHA-256-derived markers:

- `lvz_cc_*`: binds source revision, character/world canon and shot plan.
- `lvz_pc_*`: binds verified render evidence to the current continuity cookie.

They are bidirectional state markers only. They never grant merge, publish, provider, workspace or execution authority.

Editing canon or the shot plan changes the continuity cookie. Old render receipts then classify as `STALE` rather than staying falsely green.

## Failure truth

Open-render failures are classified independently from paid-vendor state. Expected blockers include:

- `OPEN_RENDER_COMPUTE_UNCONFIGURED`
- `OPEN_RENDER_COMPUTE_UNREACHABLE`
- `OPEN_RENDER_WORKFLOW_UNAVAILABLE`
- `BLOCKED_LICENSE_REVIEW`
- `OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE`
- `OPEN_RENDER_MEDIA_INVALID`
- `OPEN_RENDER_SHOTS_INCOMPLETE`

A paid vendor at zero credits is not one of them.

## Product surface

Story Video Studio displays the open-render runtime state separately from the Playwright plan gate and from actual rendered-shot evidence. This prevents a validated storyboard or preview from being presented as a finished movie.


## Delivery-frame chaining and repair dependencies

For a cinematic-profile shot, the renderer decodes and counts real frames and
extracts the last **delivery** frame, not the last model-padding frame. The
media probe stores the boundary PNG SHA-256, delivered frame count, decoded
frame count and dimensions. The PNG itself is not stored in the public receipt.

On the existing authenticated single-shot open-render submit route, explicitly
set `chain_from_previous: true` and omit `reference_image_data_url` to use the
immediately preceding approved, current shot's decoded delivery frame as
ComfyUI's LoadImage conditioning input. An independent cut instead uses the
ordinary explicit reference. The renderer rejects a missing or changed parent
and the assembly gate invalidates a changed tail or delivery-frame count
transitively until an independent cut. Existing files are preserved; this
does not authorize automatic GPU retries. Earlier cinematic-profile artifacts
without decoded boundary evidence cannot satisfy this new assembly gate.

Picture-lock normalization trims model padding. It remains silent, with
release readiness false, until audio, captions and final master verification.

### Verification boundaries

```sh
cd story-engine
node --test test/renderGraphContract.test.js test/shotArtifactContract.test.js
npm test
```

The focused tests exercise schema/repair selection with fixtures and real
FFmpeg boundary extraction. They do not prove worker inference, quality
similarity, or actual peak VRAM. For live promotion, configure the existing
worker, approved model and license; obtain its exact node contract fingerprint
and independently verify model weight hashes on the worker; submit a single
approved short shot through the existing route and read back its decoded output
and render ledger. Record hardware identity, frame count, resolution, steps,
peak VRAM and elapsed time before establishing a calibrated envelope. Do not
substitute a guessed hash, synthetic GPU receipt, or CPU FFmpeg fixture for
that live evidence.


## Operator single-shot smoke command

Run from the trusted operator environment against the already configured,
authorized StoryEngine deployment. The default is a read-only status check:

```sh
cd story-engine
LEEVIZE_SMOKE_ORIGIN=https://YOUR-STORYENGINE-ORIGIN node scripts/leevize-smoke.mjs
```

To execute exactly one existing approved short shot (1–5 seconds), set
`LEEVIZE_SMOKE_APPROVAL=one-shot-existing-worker`,
`LEEVIZE_SMOKE_JOB_ID`, `LEEVIZE_SMOKE_SHOT_ID`,
`LEEVIZE_SMOKE_REFERENCE` (rights-cleared local PNG/JPEG/WebP), and
`LEEVIZE_SMOKE_COOKIE` through the trusted local environment. Do not put
session credentials into source, chat, or shell history. Then run:

```sh
node scripts/leevize-smoke.mjs --submit
```

The script refuses unready workers and existing in-flight renders, sends a
single submission, polls with a deadline, downloads the actual media from
the authenticated route, compares SHA-256 against the stored receipt, counts
decoded frames and checks dimensions, then fully decodes video. It does not
resubmit, approve, publish, buy compute, or establish exact deployed source
SHA or peak VRAM. The latter two remain separate evidence gates. A timeout
requires reconciling the existing render ID before another attempt.


## Locked pre-GPU fixture and weight integrity

Run the worker verifier **on the actual ComfyUI host** with Node 24+ and the
trusted models root. It reads the three files, compares their SHA-256 against
the pinned Comfy Org release revision, and checks local FFmpeg/FFprobe:

```sh
cd story-engine
LEEVIZE_MODELS_ROOT=/path/to/ComfyUI/models node scripts/verify-leevize-worker.mjs
node scripts/prepare-leevize-smoke.mjs ./new-smoke-fixture
node --test test/renderGraphContract.test.js test/shotArtifactContract.test.js test/modelWeightIntegrity.test.js test/leevizeSmokeFixture.test.js
```

The generated reference is a synthetic amber sphere on a blue background.
Use fixture.json's exact action in an existing approved five-second 16:9
shot. Set LEEVIZE_SMOKE_FIXTURE_MANIFEST to the generated fixture.json and
LEEVIZE_SMOKE_REFERENCE to reference.png, alongside the previously documented
operator settings. Expected resolution is 832x480, 24 fps, 20 sampling steps,
121 model frames and 120 delivered frames. The submit runner checks the
reference hash, action and delivery contract.

The published hashes are expected values, not actual installation proof.
The worker verifier is a separate operator preflight; the remote StoryEngine
status endpoint does not attest worker filesystem bytes or prove that a
running ComfyUI process loaded them. Use a trusted immutable worker model
mount and retain the local verification evidence. Automatic repair execution,
live GPU telemetry and full repository CI remain independent gates.


## Direct Wan worker diagnostic (before the authenticated application smoke)

Use only on the dedicated, authorized GPU host with an approved commercial
model, an immutable trusted model mount, and a reviewed node-contract pin.
The direct diagnostic uses the existing StoryEngine graph compiler, not a
second renderer. It generates only the synthetic reference fixture.

Set the following in the trusted operator environment:
`LEEVIZE_MODELS_ROOT`, `LEEVIZE_RENDER_WORKER_ID`,
`LEEVIZE_MODEL_LICENSE_STATUS=verified-commercial`,
`LEEVIZE_NODE_CONTRACT_SHA256` (independently reviewed worker schema hash),
`LEEVIZE_WORKER_SMOKE_OUT` (new local directory),
`LEEVIZE_WORKER_SMOKE_APPROVAL=one-shot-local-worker`.
The worker URL defaults to http://127.0.0.1:8188; remote origins are rejected.
The optional existing worker token stays in the operator environment.

```sh
cd story-engine
node scripts/smoke-wan22.mjs --submit
```

The diagnostic verifies the three local weight files, checks GPU enumeration,
uploads a fresh synthetic PNG, compiles and validates the exact graph, compares
the node-contract pin, submits once, and requires successful terminal history
from its SaveVideo node. It accepts video artifacts in videos, animated, or
images, rejects ambiguous output and path traversal, bounds response sizes and
request time, and preserves the submission correlation ID for reconciliation.
It checks 121 decoded frames at 832x480 and 24 fps, extracts delivery frame
120, and exports and re-decodes the 120-frame MP4. Original output, delivery
MP4, boundary PNG, and evidence remain in the new local directory.

This is worker-level evidence only. It neither creates nor approves a
StoryEngine job, verifies the deployed application SHA, attests weights loaded
by the running process, nor measures peak VRAM. Do not retry automatically
after transport ambiguity; reconcile the existing client/prompt ID first.
Follow a successful diagnostic with the authenticated application smoke.

Focused output-selection tests:
```sh
node --test test/wan22SmokeOutput.test.js
```
