// lib/campaignStudio.js

import { randomUUID } from 'node:crypto';
import './sqliteTransaction.js';
import { buildStoryBlueprint, getStoryBlueprint } from './storyBlueprint.js';
import { getProductionPack } from './ipStudio.js';
import { log } from '../models/eventModel.js';

export const CAMPAIGN_PLATFORMS = Object.freeze([
  'tiktok',
  'instagram_reels',
  'facebook_reels',
  'youtube_short'
]);

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_packs (
      campaign_id TEXT PRIMARY KEY,
      source_workspace_id TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      production_pack_id TEXT,
      source_version TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      status TEXT NOT NULL,
      platforms_json TEXT NOT NULL DEFAULT '[]',
      campaign_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_source ON campaign_packs(source_workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_campaign_blueprint ON campaign_packs(blueprint_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS campaign_clips (
      clip_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      source_workspace_id TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      production_pack_id TEXT,
      source_version TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_version TEXT NOT NULL,
      status TEXT NOT NULL,
      clip_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_clips_campaign ON campaign_clips(campaign_id, platform);
    CREATE INDEX IF NOT EXISTS idx_campaign_clips_source ON campaign_clips(source_workspace_id, created_at DESC);
  `);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    platforms: parseJson(row.platforms_json, []),
    campaign: parseJson(row.campaign_json, {})
  };
}

function hydrateClip(row) {
  if (!row) return null;
  return { ...row, clip: parseJson(row.clip_json, {}) };
}

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (normalized === 'instagram') return 'instagram_reels';
  if (normalized === 'facebook') return 'facebook_reels';
  if (normalized === 'youtube' || normalized === 'youtube_shorts') return 'youtube_short';
  return normalized;
}

function normalizePlatforms(value) {
  const requested = Array.isArray(value) && value.length ? value : CAMPAIGN_PLATFORMS;
  return [...new Set(requested.map(normalizePlatform))].filter(item => CAMPAIGN_PLATFORMS.includes(item));
}

function guidelineFor(platform) {
  const guidelines = {
    tiktok: {
      canvas: '1080x1920',
      aspect_ratio: '9:16',
      safe_duration_seconds: [15, 30, 45, 60],
      hook_window_seconds: 2,
      caption_placement: 'keep essential text inside the center-safe vertical area',
      audio: 'voice, music, and effects mixed for mobile-first playback',
      export: 'platform-specific vertical master'
    },
    instagram_reels: {
      canvas: '1080x1920',
      aspect_ratio: '9:16',
      safe_duration_seconds: [15, 30, 45, 60, 90],
      hook_window_seconds: 3,
      caption_placement: 'avoid top and bottom interface zones',
      audio: 'clear dialogue with optional music-safe alternate',
      export: 'Reels master plus cover frame and caption copy'
    },
    facebook_reels: {
      canvas: '1080x1920',
      aspect_ratio: '9:16',
      safe_duration_seconds: [15, 30, 45, 60, 90],
      hook_window_seconds: 3,
      caption_placement: 'large readable captions with center-safe placement',
      audio: 'dialogue-forward mix suitable for sound-on and captioned viewing',
      export: 'Facebook Reels master plus preview frame and post copy'
    },
    youtube_short: {
      canvas: '1080x1920',
      aspect_ratio: '9:16',
      safe_duration_seconds: [15, 30, 45, 60, 90, 180],
      hook_window_seconds: 3,
      caption_placement: 'center-safe captions with lower-interface clearance',
      audio: 'broadcast-clear dialogue and music-safe mix',
      export: 'Shorts master plus title, description, and thumbnail direction'
    }
  };
  return guidelines[platform];
}

function selectSourceBeats(blueprint, productionPack) {
  const production = productionPack?.pack?.production || {};
  const storyboard = production.storyboard || production.visual_plan || production.adaptation_outline || [];
  if (storyboard.length) return storyboard.slice(0, 6);
  return (blueprint.beats || []).slice(0, 6);
}

function clipConcepts(platform, blueprint, versionLabel, sourceBeats) {
  const firstBeat = sourceBeats[0] || {};
  const common = [
    {
      clip_type: 'version_trailer',
      hook: `This story started as ${blueprint.title}.`,
      middle: `Now experience the ${versionLabel}.`,
      payoff: `The same validated world—continued in a new form.`,
      source_anchor: firstBeat.source_excerpt || firstBeat.action || blueprint.pitch || ''
    },
    {
      clip_type: 'character_intro',
      hook: 'Meet the character at the heart of the story.',
      middle: `Use a canon-safe moment from ${blueprint.title}.`,
      payoff: `Follow their next version in ${versionLabel}.`,
      source_anchor: blueprint.characters?.[0]?.name || blueprint.title
    },
    {
      clip_type: 'story_moment',
      hook: 'One moment changes everything.',
      middle: firstBeat.source_excerpt || firstBeat.action || blueprint.pitch || '',
      payoff: `See the full ${versionLabel}.`,
      source_anchor: firstBeat.source_title || blueprint.title
    }
  ];

  if (platform === 'instagram_reels') {
    common.push({
      clip_type: 'book_to_version_transition',
      hook: 'Page one versus the version it became.',
      middle: 'Match a source page or beat to its visual production equivalent.',
      payoff: 'Save this transformation.',
      source_anchor: blueprint.blueprint_id
    });
  }
  if (platform === 'facebook_reels') {
    common.push({
      clip_type: 'story_context',
      hook: `Here is why ${blueprint.title} matters.`,
      middle: blueprint.pitch || 'Explain the emotional promise in one clear sentence.',
      payoff: `Watch or share the ${versionLabel}.`,
      source_anchor: blueprint.emotional_effect
    });
  }
  if (platform === 'youtube_short') {
    common.push({
      clip_type: 'mini_trailer',
      hook: 'The story in under one minute.',
      middle: 'Use three escalating source-faithful beats.',
      payoff: `Continue with the complete ${versionLabel}.`,
      source_anchor: sourceBeats.map(item => item.source_title || item.purpose || item.action).filter(Boolean)
    });
  }
  if (platform === 'tiktok') {
    common.push({
      clip_type: 'fast_hook',
      hook: `Wait until you see what ${blueprint.title} becomes.`,
      middle: 'Move immediately from source image to transformed version.',
      payoff: `Would you watch the ${versionLabel}?`,
      source_anchor: blueprint.title
    });
  }
  return common;
}

function platformCopy(platform, blueprint, versionLabel) {
  const base = {
    tiktok: {
      post_caption: `${blueprint.title} became a ${versionLabel}. Which version should come next?`,
      discoverability: ['title', 'genre', 'character', 'adaptation', 'storytelling']
    },
    instagram_reels: {
      post_caption: `From the validated pages of ${blueprint.title} to the ${versionLabel}. The same canon, carried forward.`,
      cover_text: `${blueprint.title}: ${versionLabel}`,
      companion_assets: ['cover frame', 'carousel adaptation comparison', 'story teaser']
    },
    facebook_reels: {
      post_caption: `See how ${blueprint.title} continues as a ${versionLabel}. Share it with someone who would follow this story.`,
      preview_text: `A new version of ${blueprint.title}`,
      companion_assets: ['preview frame', 'share copy', 'longer context caption']
    },
    youtube_short: {
      title: `${blueprint.title} becomes a ${versionLabel} #Shorts`,
      description: `A source-faithful continuation generated from the validated ${blueprint.title} story blueprint.`,
      thumbnail_text: `BOOK → ${versionLabel.toUpperCase()}`
    }
  };
  return base[platform];
}

function buildPlatformVersion(platform, blueprint, productionPack, campaignId, sourceVersion) {
  const guideline = guidelineFor(platform);
  const sourceBeats = selectSourceBeats(blueprint, productionPack);
  const versionLabel = productionPack ? `${productionPack.target_medium} version` : `${blueprint.source_medium} version`;
  const platformVersion = `${sourceVersion}:${platform}:v1`;
  const concepts = clipConcepts(platform, blueprint, versionLabel, sourceBeats);

  return {
    clip_id: `clip_${randomUUID()}`,
    campaign_id: campaignId,
    platform,
    platform_version: platformVersion,
    lineage: {
      blueprint_id: blueprint.blueprint_id,
      production_pack_id: productionPack?.pack_id || null,
      source_version: sourceVersion,
      platform_version: platformVersion
    },
    guideline,
    render_plan: {
      own_platform_render: true,
      reuse_policy: 'source ideas may be shared, but timing, edit, captions, copy, cover, and CTA must be rendered separately for this platform',
      source_beats: sourceBeats,
      concepts,
      caption_style: blueprint.developmental_profile ? 'simple, warm, readable, parent-safe' : 'clear, audience-matched, mobile-first',
      call_to_action: `Experience ${blueprint.title} as the ${versionLabel}.`
    },
    publishing_copy: platformCopy(platform, blueprint, versionLabel),
    validation: {
      lindymode: ['matches the validated creative profile', 'preserves audience and emotional promise'],
      ooda: ['platform selected for this IP version', 'duration and concept fit the campaign goal'],
      redteam: ['no canon drift', 'no misleading version claims', 'no unsafe child-facing framing', 'no text outside platform-safe composition zones'],
      release_gate_required: true
    }
  };
}

function buildCampaign(blueprint, productionPack, platforms, input, campaignId) {
  const sourceVersion = productionPack?.source_version || `${blueprint.source_medium}:seed`;
  const platformVersions = platforms.map(platform => buildPlatformVersion(platform, blueprint, productionPack, campaignId, sourceVersion));
  const versionLabel = productionPack ? `${productionPack.target_medium} version` : `${blueprint.source_medium} version`;

  return {
    lineage: {
      blueprint_id: blueprint.blueprint_id,
      source_workspace_id: blueprint.source_workspace_id,
      production_pack_id: productionPack?.pack_id || null,
      source_version: sourceVersion,
      source_title: blueprint.title
    },
    campaign_goal: input.goal || 'promote the validated work and each of its versions',
    campaign_message: `One validated story, continued as the ${versionLabel}, with an independently rendered clip version for every selected platform.`,
    consistency_lock: {
      preserve: blueprint.conversion_rules?.preserve || [],
      never: blueprint.conversion_rules?.never || [],
      character_identity: blueprint.characters || [],
      audience: blueprint.audience,
      developmental_profile: blueprint.developmental_profile || null
    },
    platform_versions: platformVersions,
    shared_inputs_not_shared_renders: [
      'validated canon',
      'source characters and environments',
      'production-pack storyboard or visual beats',
      'emotional promise',
      'campaign goal'
    ],
    required_unique_outputs_per_platform: [
      'edited clip timeline',
      'caption placement and timing',
      'platform post copy',
      'cover or thumbnail frame',
      'call to action',
      'platform-version lineage ID'
    ],
    validation_order: ['lindymode campaign fit', 'ooda platform and version selection', 'redteam canon/audience/platform challenge', 'release gate']
  };
}

export function buildCampaignPack(db, sourceWorkspaceId, input = {}) {
  ensureSchema(db);
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  if (!row.validation?.passed || !row.blueprint?.seed_gate?.conversion_ready) {
    throw new Error('Campaign Studio is blocked until the source becomes a validated seed.');
  }

  const platforms = normalizePlatforms(input.platforms);
  if (!platforms.length) throw new Error('At least one supported campaign platform is required.');

  const productionPack = input.production_pack_id ? getProductionPack(db, input.production_pack_id) : null;
  if (input.production_pack_id && !productionPack) throw new Error('Production Pack not found.');
  if (productionPack && productionPack.source_workspace_id !== sourceWorkspaceId) {
    throw new Error('Production Pack does not belong to this validated source.');
  }

  const campaignId = `campaign_${randomUUID()}`;
  const campaign = buildCampaign(row.blueprint, productionPack, platforms, input, campaignId);
  const campaignName = String(input.campaign_name || `${row.blueprint.title} — ${productionPack?.target_medium || row.blueprint.source_medium} campaign`).trim();
  const sourceVersion = campaign.lineage.source_version;
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO campaign_packs (
        campaign_id, source_workspace_id, blueprint_id, production_pack_id,
        source_version, campaign_name, status, platforms_json, campaign_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ready_for_review', ?, ?, ?, ?)
    `).run(
      campaignId,
      sourceWorkspaceId,
      row.blueprint_id,
      productionPack?.pack_id || null,
      sourceVersion,
      campaignName,
      JSON.stringify(platforms),
      JSON.stringify(campaign),
      now,
      now
    );

    const insertClip = db.prepare(`
      INSERT INTO campaign_clips (
        clip_id, campaign_id, source_workspace_id, blueprint_id, production_pack_id,
        source_version, platform, platform_version, status, clip_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready_for_review', ?, ?, ?)
    `);

    for (const clip of campaign.platform_versions) {
      insertClip.run(
        clip.clip_id,
        campaignId,
        sourceWorkspaceId,
        row.blueprint_id,
        productionPack?.pack_id || null,
        sourceVersion,
        clip.platform,
        clip.platform_version,
        JSON.stringify(clip),
        now,
        now
      );
    }
  })();

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'campaign_studio',
    event_type: 'campaign_studio.versioned_platform_clips_built',
    payload: {
      campaign_id: campaignId,
      blueprint_id: row.blueprint_id,
      production_pack_id: productionPack?.pack_id || null,
      platforms,
      source_version: sourceVersion,
      platform_versions: campaign.platform_versions.map(item => item.platform_version)
    }
  });

  return {
    ...hydrate(db.prepare('SELECT * FROM campaign_packs WHERE campaign_id=?').get(campaignId)),
    clips: listCampaignClips(db, campaignId)
  };
}

export function listCampaignPacks(db, sourceWorkspaceId) {
  ensureSchema(db);
  return db.prepare(`SELECT * FROM campaign_packs WHERE source_workspace_id=? ORDER BY created_at DESC`).all(sourceWorkspaceId).map(hydrate);
}

export function getCampaignPack(db, campaignId) {
  ensureSchema(db);
  const campaign = hydrate(db.prepare('SELECT * FROM campaign_packs WHERE campaign_id=?').get(campaignId));
  return campaign ? { ...campaign, clips: listCampaignClips(db, campaignId) } : null;
}

export function listCampaignClips(db, campaignId) {
  ensureSchema(db);
  return db.prepare(`SELECT * FROM campaign_clips WHERE campaign_id=? ORDER BY platform, created_at`).all(campaignId).map(hydrateClip);
}

export function getCampaignClip(db, clipId) {
  ensureSchema(db);
  return hydrateClip(db.prepare('SELECT * FROM campaign_clips WHERE clip_id=?').get(clipId));
}

export function campaignStudioOverview(db) {
  ensureSchema(db);
  const total = db.prepare('SELECT COUNT(*) AS count FROM campaign_packs').get();
  const clips = db.prepare('SELECT COUNT(*) AS count FROM campaign_clips').get();
  const byPlatform = db.prepare(`SELECT platform, COUNT(*) AS count FROM campaign_clips GROUP BY platform ORDER BY platform`).all();
  const latest = db.prepare(`SELECT campaign_id, source_workspace_id, campaign_name, source_version, status, platforms_json, created_at FROM campaign_packs ORDER BY created_at DESC LIMIT 20`).all()
    .map(row => ({ ...row, platforms: parseJson(row.platforms_json, []) }));
  return {
    total_campaigns: Number(total?.count || 0),
    total_versioned_clips: Number(clips?.count || 0),
    supported_platforms: CAMPAIGN_PLATFORMS,
    clips_by_platform: byPlatform,
    latest
  };
}
