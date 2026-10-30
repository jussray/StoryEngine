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
