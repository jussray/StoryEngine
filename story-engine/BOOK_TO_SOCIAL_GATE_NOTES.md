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

## Circle Social Entry boundary

The Facebook/Instagram/TikTok idea must not change how Circle Core works.

Circle Core remains the Se'kret-owned community layer where feelings are validated, users can share in circle-safe ways, Bip Crew members and trusted friends still work as intended, and private Se'kret boundaries remain protected.

Circle Social Entry is only the familiar-app doorway:

```text
TikTok / Instagram / Facebook prompt, reel, carousel, or post
→ familiar-app discovery
→ approved Circle entry link or handoff
→ Se'kret-owned Circle experience
→ feeling validation, circle-safe sharing, Bip Crew/friend support, and moderation rules stay inside Se'kret
```

Required product rule:

- External platforms may help people discover or enter Circle.
- External platforms must not replace Circle's validation model, trusted-friend/Bip Crew flows, moderation rules, identity rules, or private Se'kret data boundary.
- A generated social artifact may invite someone into Circle, but it must not imply that the full Circle experience happens on Meta or TikTok.
- Feeling validation is a Circle behavior, not a public-platform comment-thread obligation.
- Familiar-app entry should reduce friction without importing follower pressure, stranger-DM behavior, public diary pressure, or platform-native clout loops.

## External surface split

| Surface | Role | Boundary |
|---|---|---|
| Playground / Meta Model API | Creation layer for transforming approved book material into draft artifacts | Uses `MODEL_API_KEY` server-side only; no raw secret in client bundles, commits, issues, or PRs |
| Story Engine / Meta social APIs | Future Facebook and Instagram distribution/account-management layer | Separate Meta app credentials and app-review gates |
| TikTok developer/API path | Future TikTok posting or account-connection layer | Separate TikTok app, scopes, and review path |
| Circle Social Entry | Familiar-app doorway into Se'kret Circle | Discovery and handoff only; Circle Core behavior stays inside Se'kret |

Do not mix their secrets, scopes, proof gates, or operational evidence.

## Proposed L99 pipeline

```text
Approved source material
→ source-rights gate
→ reduced passage selection
→ content atom extraction
→ platform draft generation
→ Circle Social Entry classification, when applicable
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
- `circle_entry_prompt`

Every artifact should be tied to a source hash, not an unbounded raw source dump.

## Platform outputs

### TikTok

- Hook options.
- Short video script variants.
- Voiceover draft.
- Caption.
- Hashtag set.
- On-screen text beats.
- Circle entry prompt, when approved.
- Platform handoff notes.

### Instagram

- Reel script.
- Carousel outline.
- Caption variants.
- Alt-text draft.
- Hashtag set.
- Circle entry prompt, when approved.
- Platform handoff notes.

### Facebook

- Short video caption.
- Longer community-style post.
- Quote card copy.
- Link/CTA variant.
- Parent/community Circle entry prompt, when approved.
- Platform handoff notes.

## Hard blockers

Block generation or promotion if any of these are true:

- source ownership, license, or approval state is missing;
- raw book text is being stored in logs, issue comments, PR bodies, telemetry, or long-lived event payloads;
- `MODEL_API_KEY`, social tokens, page tokens, TikTok tokens, or webhook secrets appear in committed files;
- teen/private Se'kret Bip data is included;
- a generated artifact implies posting happened when only drafting occurred;
- a generated artifact implies Circle Core runs on TikTok, Instagram, or Facebook;
- a generated artifact imports public follower counts, open stranger DMs, clout loops, or public diary pressure into Circle;
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
  "circle_entry_mode": "none | prompt | parent_prompt | community_prompt",
  "circle_core_changed": false,
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
7. Circle Social Entry validation proving Circle Core behavior, feeling validation, Bip Crew/friend flows, identity rules, and moderation rules are unchanged;
8. Playwright artifact preview evidence for any user-visible generation UI;
9. event-bus metadata that stores hashes and statuses, not raw book dumps;
10. separate handoff boundaries for TikTok, Instagram, and Facebook;
11. no direct publishing unless a separate approved integration PR adds and proves it.

## Current status

- Correct repository: `jussray/l99-StoryEngine`.
- Current change type: documentation/spec scaffold only.
- Runtime generation: not implemented.
- Circle Core changes: not implemented and not intended by this gate.
- Platform publishing: not implemented.
- Secret configuration: not added.
