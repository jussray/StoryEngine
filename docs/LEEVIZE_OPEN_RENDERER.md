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

## Proposed multimodal extension (review candidate, not runtime proof)

This section extends the existing ComfyUI and LEEVIZE contracts. It is a specification only. The existing locked `story-engine/config/leevize-model-manifest.json` and renderer remain the implementation authority until a reviewed code change and real render prove additional modes. Do not add another execution ledger or replace the existing continuity cookies.

### Mode and adapter contract

| Mode | Candidate path | Evidence state |
| --- | --- | --- |
| Text-to-video | Existing Wan 2.2 TI2V-5B workflow | Source implementation; live render unverified here |
| Image-to-video | Existing Wan 2.2 TI2V-5B workflow with authorized reference | Source implementation; live render unverified here |
| Text-to-image | Separate versioned ComfyUI image workflow and reviewed image model | Specified |
| Image-to-image | Separate versioned image workflow and authorized input | Specified |
| Joint audio/video or multishot | Optional version-pinned LTX adapter | Specified; license and runtime gate pending |

Each adapter must declare its exact model/revision, workflow digest, supported mode, dimensions, frame rate, duration or frame limits, input formats, required node and weight revisions, license record, and output media type. Reject unsupported combinations before submitting. Do not use a video adapter as proof of image generation. Do not commit model weights, private reference assets, provider credentials or private worker URLs.

### License and custody

The existing Wan manifest declares Apache-2.0 for its pinned intended model; independently check the exact downloaded weights, workflow nodes and any auxiliary components before activation. Review model-family claims against the specific version, not the product name. LTX self-hosted use requires review of the applicable Community License, commercial threshold and acceptance for the exact version. Keep HunyuanVideo disabled unless the applicable territorial and other license conditions are reviewed. No provider license is a release approval.

Official research entry points:
- https://github.com/Wan-Video/Wan2.2
- https://docs.ltx.io/open-source-model/getting-started/overview/
- https://huggingface.co/tencent/HunyuanVideo-1.5/blob/main/LICENSE

Record license source, revision or immutable license digest, observation date, applicable use and territory, reviewer and decision. A gated or missing license record blocks activation. A manifest flag alone does not prove the running weights.

### Cinematic and continuity contracts

Bind the existing job/shot continuity cookie to authorized character and environment references, reference hashes, seed, approved palette, shot duration, subject action, camera movement, environmental movement and a timeline revision. Separate camera presets from subject and environmental motion. A new reference or shot-plan revision invalidates prior render proof. A LoRA, voice or likeness reference needs rights and consent appropriate to its use; do not infer them from file availability.

Keep Playwright deterministic frame capture for actual HTML/CSS/SVG compositions (titles, captions, motion graphics and interface sequences), with fixed frame times and viewport. A browser-rendered animation is not a model-generated scene; distinguish its evidence. Use one rational frame timebase for video, narration, music, sound effects and captions. Track exact start/end times, rights, asset hashes and approved mix settings. A declared timing tolerance must be tested against real media, not inferred from a storyboard.

### Acceptance and failure gates

1. Unit and integration tests reject unknown modes, unsupported settings, invalid workflow tokens, missing weights or nodes, unapproved licenses, unauthorized assets and stale continuity.
2. A deterministic local composition test measures frame counts and cue timing, and confirms that captions and audio align with the selected frame timebase.
3. Each actual model mode must produce a stored image or playable video through its real adapter, with a digest, exact workflow/model identity and media probe evidence. Validate still dimensions/format or video codec, dimensions, duration, frame rate, audio stream and timing; screen for frozen/black frames and perform visual/continuity review. Technical validation alone is not creative acceptance.
4. Retry only a bounded, named failed shot; do not retry an ambiguous paid submission. Paid fallback remains off until independently authorized for the exact job, shot, provider and cost ceiling.
5. Record `specified`, `implemented` and `rendered` separately. Rendered requires actual output, verified media evidence and current continuity; production release and publication are separate founder gates.

Rollback: remove this proposed specification extension to restore the prior documentation; no existing renderer, model selection, deployment, billing or publication behavior is changed by this document.
