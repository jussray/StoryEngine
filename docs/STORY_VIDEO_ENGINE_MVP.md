# Story Video Engine MVP

**Status:** deterministic founder MVP  
**Provider spend:** $0 by contract  
**Active preview renderer:** animated HTML Motion Book  
**Target render modes:** Motion Book, Cinematic 3D, Cartoon 2D, Anime 2D

## Outcome

The Story Video Engine turns an existing Story Engine workspace into one versioned shot blueprint and a browser-playable cinematic animatic. The same blueprint carries the intended visual mode, continuity locks, camera grammar, timing, source revision, and negative constraints.

This release does **not** claim that Blender, Mixamo, ComfyUI, or a paid video provider rendered a finished movie. Cinematic 3D, Cartoon 2D, and Anime 2D are blueprint-ready target modes. Their current preview is the free deterministic Motion Book renderer.

## Why this is the broke-founder path

A full generative video pipeline would spend money before proving that creators finish, validate, export, or regenerate videos. This MVP proves the durable machine first:

1. Read story, chapters, and locked character memory.
2. Produce a bounded shot plan with a maximum of 12 shots and 60 seconds.
3. Preserve a source revision hash and per-shot continuity requirements.
4. Render an animated HTML artifact with no model or GPU call.
5. Require Playwright validation before the artifact is marked validated.
6. Publish job health and recent evidence in Control Room.

## Source-of-truth boundaries

- Story and chapter state remain authoritative for narrative content.
- Story Memory remains authoritative for locked character continuity.
- `story_video_jobs.blueprint_json` records the adaptation plan, not new canon.
- `story_artifacts` stores the generated preview and its validation evidence.
- The existing `events` table remains the operational event spine.
- Control Room is a view; it does not invent validation state.

## Events

- `video.plan.completed`
- `video.artifact.generated`
- `video.playwright_validated`
- `video.playwright_failed`

## API

```text
GET  /api/video-engine/options
GET  /api/video-engine/control-room
POST /api/video-engine/jobs
GET  /api/video-engine/jobs/:job_id
GET  /api/video-engine/jobs/:job_id/html
POST /api/video-engine/jobs/:job_id/validate
GET  /api/workspaces/:workspace_id/video-jobs
```

All workspace-owned reads and writes use the existing workspace-access contract. The Control Room aggregate endpoint requires the administrator role.

## Renderer contract

Every visual target consumes the same fields:

- source revision ID;
- target mode and preview renderer;
- quality and aspect ratio;
- shot duration, type, camera movement, action, narration, emotion, and intensity;
- character bible;
- `must_preserve` continuity rules;
- negative constraints;
- estimated and actual cost.

Future adapters should replace only rendering, not story planning or authority:

```text
MotionBookHtmlAdapter  — active
Blender3DAdapter       — planned
CartoonPuppetAdapter   — planned
AnimeImageVideoAdapter — planned
```

## Playwright gate

Validation checks:

- exactly one video artifact root;
- the rendered shot count equals the blueprint shot count;
- one timeline exists;
- one shot is active after load;
- the page has a title;
- no browser console errors occur;
- provider cost remains zero;
- required structural markers exist.

CI runs the end-to-end test against the real server and confirms that the validated job appears inside Control Room.

## Red-team limits

- Animated HTML is an animatic, not a downloadable MP4.
- No voice, lip-sync, custom images, Blender render, or provider generation is included.
- Validation proves browser structure and runtime behavior; it does not judge artistic quality.
- Job execution is synchronous because the free renderer is lightweight. Paid or GPU renderers must use resumable queued jobs later.
- Approved-shot immutability is expressed in the blueprint contract but does not yet have a shot-level approval table.

## Rollback

Revert the feature commit. Existing stories, chapters, memory, movie beats, artifacts, events, release gates, and Control Room behavior remain compatible. The new tables are additive and can remain inert without affecting the existing runtime.

## Next gate

Do not add paid generation until usage proves that creators repeatedly generate and validate these previews. The next technical gate is a free local export adapter—FFmpeg or Blender headless—behind the same blueprint, with per-shot retry and deterministic artifact evidence.
