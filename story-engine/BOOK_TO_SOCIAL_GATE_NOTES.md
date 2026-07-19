# Book-to-social creation gate notes

This repository is the correct L99 Story Engine surface for the book-to-social work.

The product goal is to transform approved book/source material into reviewable content drafts for TikTok, Instagram, and Facebook without turning the runtime into an uncontrolled publisher, credential vault, or raw-content warehouse.

## Product answer

Yes: a model API surface such as Playground / Muse Spark can help with the creation layer.

It can support:

- extracting themes, scenes, lessons, pull quotes, audience promises, and emotional beats from approved source material;
- generating short-form video hooks, scripts, voiceover drafts, caption packs, carousel outlines, thumbnail prompts, and content-calendar entries;
- adapting one approved source passage into platform-shaped drafts for TikTok, Instagram, and Facebook;
- creating operator metadata such as content pillar, audience intent, platform fit, call to action, risk flags, and approval status.

It does not publish content by itself. Publishing, account connection, comments, insights, and webhooks remain separate platform integration work.

## External surface split

| Surface | Role | Boundary |
|---|---|---|
| Playground / Meta Model API | Creation layer for transforming approved book material into draft artifacts | Uses `MODEL_API_KEY` server-side only; no raw secret in client bundles, commits, issues, or PRs |
| Story Engine / Meta social APIs | Future Facebook and Instagram distribution/account-management layer | Separate Meta app credentials and app-review gates |
| TikTok developer/API path | Future TikTok posting or account-connection layer | Separate TikTok app, scopes, and review path |

Do not mix their secrets, scopes, proof gates, or operational evidence.

## Proposed L99 pipeline

```text
Approved source material
→ source-rights gate
→ reduced passage selection
→ content atom extraction
→ platform draft generation
→ artifact rendering
→ Playwright artifact validation
→ founder/human approval
→ platform handoff/export
→ separate publishing integration, if approved later
```

## Draft artifact kinds

The first implementation should produce reviewable artifacts, not publish directly:

- `short_video_script`
- `voiceover_draft`
- `caption_pack`
- `carousel_outline`
- `thumbnail_prompt`
- `platform_post_variant`
- `content_calendar_item`

Every artifact should be tied to a source hash, not an unbounded raw source dump.

## Platform outputs

### TikTok

- Hook options.
- Short video script variants.
- Voiceover draft.
- Caption.
- Hashtag set.
- On-screen text beats.
- Platform handoff notes.

### Instagram

- Reel script.
- Carousel outline.
- Caption variants.
- Alt-text draft.
- Hashtag set.
- Platform handoff notes.

### Facebook

- Short video caption.
- Longer community-style post.
- Quote card copy.
- Link/CTA variant.
- Platform handoff notes.

## Hard blockers

Block generation or promotion if any of these are true:

- source ownership, license, or approval state is missing;
- raw book text is being stored in logs, issue comments, PR bodies, telemetry, or long-lived event payloads;
- `MODEL_API_KEY`, social tokens, page tokens, TikTok tokens, or webhook secrets appear in committed files;
- teen/private Se'kret Bip data is included;
- a generated artifact implies posting happened when only drafting occurred;
- a runtime path attempts to publish directly before a separate platform integration gate exists;
- Playwright artifact validation is required but missing for user-visible output.

## Metadata contract

Book-to-social artifacts should carry reduced metadata like:

```json
{
  "source_hash": "sha256-of-approved-source-slice",
  "source_rights_state": "founder_owned | licensed | public_domain | approved_external",
  "platform": "tiktok | instagram | facebook",
  "artifact_kind": "short_video_script",
  "content_pillar": "string",
  "audience_intent": "string",
  "approval_status": "draft | needs_review | approved | rejected",
  "generated_by_surface": "playground_meta_model_api",
  "publishing_status": "not_published"
}
```

## Evidence requirements before implementation

A future runtime PR must include:

1. explicit founder approval;
2. a source-rights policy for the book/material being transformed;
3. reduced prompt/input policy;
4. server-only secret storage and rotation plan;
5. fail-closed handling for missing, invalid, exhausted, or rate-limited model credentials;
6. output validation for TikTok, Instagram, and Facebook draft shapes;
7. Playwright artifact preview evidence for any user-visible generation UI;
8. event-bus metadata that stores hashes and statuses, not raw book dumps;
9. separate handoff boundaries for TikTok, Instagram, and Facebook;
10. no direct publishing unless a separate approved integration PR adds and proves it.

## Current status

- Correct repository: `jussray/l99-StoryEngine`.
- Current change type: documentation/spec scaffold only.
- Runtime generation: not implemented.
- Platform publishing: not implemented.
- Secret configuration: not added.
