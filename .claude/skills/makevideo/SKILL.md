---
name: makevideo
description: Use StoryEngine's existing MAKEVIDEO v2.1 protocol and its own video-engine/LEEVIZE implementation. Use for /MAKEVIDEO, /makevideo, /LEEVIZE, /video, or ordinary requests such as "make this video" when the requested output belongs to StoryEngine/L99.
---

# StoryEngine MAKEVIDEO entrypoint

The canonical protocol already lives at `skills/makevideo/SKILL.md`. Read and follow that file first. This adapter exists only to make the repository-native skill discoverable from the standard `.claude/skills` surface; it does not duplicate or supersede the protocol.

## Execute

1. Preserve CreativeCanon, EvidenceCanon, ReleaseCanon, fingerprints, continuity packets, append-only receipts, and bounded job authority from `skills/makevideo/SKILL.md`.
2. Use StoryEngine's own `/api/video-engine/*` routes and local renderer adapters. Do not route execution through Chief, FCR, or Bip.
3. For deterministic export, require the existing ffmpeg/ffprobe verification receipt.
4. Run the real StoryEngine Playwright path before calling the browser/API flow verified:

```bash
cd story-engine
npm run test:playwright -- e2e/video_engine.spec.js
```

5. Treat `VERIFIED`, `PUBLISH_APPROVED`, and `PUBLISHED` as separate states exactly as the canonical protocol defines them.

## Stop conditions

Stop on missing canon/evidence authority, stale fingerprints, unverified renderer capability, failed media probe, failed Playwright proof, unresolved rights/release state, or absent publish authority.
