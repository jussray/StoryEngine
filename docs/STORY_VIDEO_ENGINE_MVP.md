# Story Video Engine MVP

**Status:** deterministic founder MVP  
**Provider spend:** $0 by contract  
**Active preview renderer:** animated HTML Motion Book  
**Render modes:** Motion Book, Cinematic 3D, 2D Animation, Stop Motion  
**Built-in visual styles:** Cinematic Realism, Stylized Family 3D, Hand-Drawn Cartoon, Anime, Comic Ink, Watercolor Storybook, Soft Cinematic Bookish, Clay Stop Motion, Paper Cutout, Pixel Art, Neon Noir, Vintage Animation, plus Custom Art Direction

## Outcome

The Story Video Engine turns an existing Story Engine workspace into one versioned shot blueprint and a browser-playable cinematic animatic. The same blueprint carries continuity locks, camera grammar, timing, source revision, negative constraints, render mode, and visual style.

**Render mode and visual style are separate decisions.** Anime is one optional look, not the engine architecture. A creator can target Cinematic 3D with Cinematic Realism, 2D Animation with Hand-Drawn Cartoon, Motion Book with Watercolor Storybook, Stop Motion with Clay, or use an experimental cross-combination without forking story truth.

This release does **not** claim that Blender, Mixamo, ComfyUI, or a paid video provider rendered a finished movie. Cinematic 3D, 2D Animation, and Stop Motion are blueprint-ready render modes. Their current proof artifact is the free deterministic Motion Book renderer.

## Why this is the broke-founder path

A full generative video pipeline would spend money before proving that creators finish, validate, export, or regenerate videos. This MVP proves the durable machine first:

1. Read story, chapters, and locked character memory.
2. Produce a bounded shot plan with a maximum of 12 shots and 60 seconds.
3. Preserve a source revision hash and per-shot continuity requirements.
4. Select render technology independently from art direction.
5. Render an animated HTML artifact with no model or GPU call.
6. Require Playwright validation before the artifact is marked validated.
7. Publish job health, style coverage, and recent evidence in Control Room.

## Source-of-truth boundaries

- Story and chapter state remain authoritative for narrative content.
- Story Memory remains authoritative for locked character continuity.
- Visual style is an adaptation instruction, not canon.
- `story_video_jobs.blueprint_json` records the adaptation plan, not new canon.
- `story_artifacts` stores the generated preview and its validation evidence.
- The existing `events` table remains the operational event spine.
- Control Room is a view; it does not invent validation state.

## Events

- `video.plan.completed`
- `video.artifact.generated`
- `video.playwright_validated`
- `video.playwright_failed`

Every event includes both `target_mode` and `visual_style` where applicable.

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

## Job input

```json
{
  "workspace_id": "workspace_...",
  "mode": "cinematic_3d",
  "visual_style": "cinematic_realism",
  "quality": "draft",
  "aspect_ratio": "16:9"
}
```

Legacy inputs remain compatible:

- `cartoon_2d` resolves to `animation_2d` + `hand_drawn_cartoon`.
- `anime_2d` resolves to `animation_2d` + `anime`.

## Renderer and style contract

Every target consumes the same fields:

- source revision ID;
- render mode and preview renderer;
- visual style, style fit, and optional custom art direction;
- quality and aspect ratio;
- shot duration, type, camera movement, action, narration, emotion, and intensity;
- character bible;
- `must_preserve` continuity rules;
- negative constraints from both the renderer and style;
- estimated and actual cost.

Future adapters should replace only rendering, not story planning or authority:

```text
MotionBookHtmlAdapter — active
Blender3DAdapter      — planned
Animation2DAdapter    — planned
StopMotionAdapter     — planned
```

Visual styles stay provider-independent. A Blender, local diffusion, or future paid adapter reads the same style contract.

## Playwright gate

Validation checks:

- exactly one video artifact root;
- the rendered shot count equals the blueprint shot count;
- one timeline exists;
- one shot is active after load;
- render-mode and visual-style labels match the blueprint;
- the visual-style marker exists on the artifact;
- the page has a title;
- no browser console errors occur;
- provider cost remains zero;
- required structural markers exist.

The isolated Story Video Engine workflow validates multiple **non-anime** looks: Cinematic Realism and Watercolor Storybook. It then confirms both styles appear inside Control Room.

## Red-team limits

- Animated HTML is an animatic, not a downloadable MP4.
- No voice, lip-sync, custom images, Blender render, or provider generation is included.
- Style presets provide production direction and preview theming; they do not create final style-faithful frames yet.
- Validation proves browser structure and runtime behavior; it does not judge artistic quality.
- Job execution is synchronous because the free renderer is lightweight. Paid or GPU renderers must use resumable queued jobs later.
- Approved-shot immutability is expressed in the blueprint contract but does not yet have a shot-level approval table.

## Rollback

Revert the feature commit. Existing stories, chapters, memory, movie beats, artifacts, events, release gates, and Control Room behavior remain compatible. The new table column is additive and can remain inert without affecting the existing runtime.

## Next gate

Do not add paid generation until usage proves that creators repeatedly generate and validate these previews. The next technical gate is a free local export adapter—FFmpeg or Blender headless—behind the same blueprint, with per-shot retry and deterministic artifact evidence.
