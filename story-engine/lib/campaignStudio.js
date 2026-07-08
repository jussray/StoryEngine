// lib/campaignStudio.js

import { randomUUID } from 'node:crypto';
import { buildStoryBlueprint, getStoryBlueprint } from './storyBlueprint.js';
import { getProductionPack } from './ipStudio.js';
import { log } from '../models/eventModel.js';

export const CAMPAIGN_PLATFORMS = Object.freeze(['tiktok', 'instagram', 'youtube_short']);

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

function normalizePlatforms(value) {
  const requested = Array.isArray(value) && value.length ? value : CAMPAIGN_PLATFORMS;
  return [...new Set(requested.map(item => String(item || '').trim().toLowerCase().replaceAll('-', '_')))]
    .filter(item => CAMPAIGN_PLATFORMS.includes(item));
}

function platformSpec(platform, blueprint, versionLabel) {
  const child = Boolean(blueprint.developmental_profile);
  const shared = {
    source_title: blueprint.title,
    source_version: versionLabel,
    blueprint_id: blueprint.blueprint_id,
    audience: blueprint.audience,
    canon_lock: true,
    call_to_action: `Experience ${blueprint.title}.`
  };

  if (platform === 'tiktok') {
    return {
      ...shared,
      platform,
      aspect_ratio: '9:16',
      clip_length_seconds: [15, 30, 45],
      concepts: [
        { type: 'hook', script: `You need to see what happens in ${blueprint.title}.`, visual: 'Open on the strongest emotional image.' },
        { type: 'character_intro', script: `Meet the character at the heart of ${blueprint.title}.`, visual: 'Character-led reveal with burned-in captions.' },
        { type: 'story_moment', script: blueprint.beats?.[0]?.source_excerpt || blueprint.pitch || '', visual: 'Recreate one validated story beat.' },
        { type: 'version_tease', script: `The ${versionLabel} version is coming to life.`, visual: 'Show book-to-version transition.' }
      ],
      caption_style: child ? 'simple, warm, parent-safe' : 'fast, clear, curiosity-led',
      discoverability: ['title keyword', 'genre keyword', 'character keyword', 'version keyword']
    };
  }

  if (platform === 'instagram') {
    return {
      ...shared,
      platform,
      aspect_ratio: '9:16 for Reels; 4:5 for feed',
      reel_length_seconds: [15, 30, 45],
      assets: [
        { type: 'reel', purpose: 'trailer or emotional story beat' },
        { type: 'carousel', purpose: 'book-to-version visual progression' },
        { type: 'quote_card', purpose: 'shareable line tied to canon' },
        { type: 'story', purpose: 'countdown, poll, or behind-the-scenes prompt' },
        { type: 'character_card', purpose: 'introduce a source-faithful character' }
      ],
      captions: [
        `From the pages of ${blueprint.title} to ${versionLabel}.`,
        `The same story. A new way to experience it.`,
        `Built from the validated world of ${blueprint.title}.`
      ]
    };
  }

  return {
    ...shared,
    platform: 'youtube_short',
    aspect_ratio: '9:16',
    clip_length_seconds: [30, 45, 60],
    scripts: [
      { type: 'book_hook', hook: `This story started as ${blueprint.title}.`, body: blueprint.pitch || '', close: shared.call_to_action },
      { type: 'version_trailer', hook: `Now watch the ${versionLabel} version take shape.`, body: 'Show source beat, visual conversion, and emotional payoff.', close: shared.call_to_action },
      { type: 'character_short', hook: 'Meet the character who changes everything.', body: 'Use one canon-safe character moment.', close: shared.call_to_action }
    ],
    thumbnail_rules: ['one focal character or object', 'three-to-five word headline', 'high visual contrast', 'no canon-breaking imagery']
  };
}

function buildCampaign(blueprint, productionPack, platforms, input) {
  const versionLabel = productionPack
    ? `${productionPack.target_medium} version`
    : `${blueprint.source_medium} version`;
  const platformPacks = platforms.map(platform => platformSpec(platform, blueprint, versionLabel));

  return {
    lineage: {
      blueprint_id: blueprint.blueprint_id,
      source_workspace_id: blueprint.source_workspace_id,
      production_pack_id: productionPack?.pack_id || null,
      source_version: productionPack?.source_version || `${blueprint.source_medium}:seed`,
      source_title: blueprint.title
    },
    campaign_goal: input.goal || 'promote the validated work and its versions',
    campaign_message: `One validated story, continued across ${versionLabel} and platform-native promotion.`,
    consistency_lock: {
      preserve: blueprint.conversion_rules?.preserve || [],
      never: blueprint.conversion_rules?.never || [],
      character_identity: blueprint.characters || [],
      audience: blueprint.audience,
      developmental_profile: blueprint.developmental_profile || null
    },
    platforms: platformPacks,
    shared_asset_manifest: [
      'vertical master clips',
      'clean master without captions',
      'burned-caption variants',
      'platform caption copy',
      'thumbnail or cover frames',
      'canon-safe character and environment references',
      'campaign lineage metadata'
    ],
    validation_order: ['lindymode campaign fit', 'ooda platform selection', 'redteam canon and audience challenge', 'release gate']
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

  const campaign = buildCampaign(row.blueprint, productionPack, platforms, input);
  const campaignId = `campaign_${randomUUID()}`;
  const campaignName = String(input.campaign_name || `${row.blueprint.title} — ${productionPack?.target_medium || row.blueprint.source_medium} campaign`).trim();
  const sourceVersion = campaign.lineage.source_version;
  const now = Date.now();

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

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'campaign_studio',
    event_type: 'campaign_studio.pack_built',
    payload: { campaign_id: campaignId, blueprint_id: row.blueprint_id, production_pack_id: productionPack?.pack_id || null, platforms, source_version: sourceVersion }
  });

  return hydrate(db.prepare('SELECT * FROM campaign_packs WHERE campaign_id=?').get(campaignId));
}

export function listCampaignPacks(db, sourceWorkspaceId) {
  ensureSchema(db);
  return db.prepare(`SELECT * FROM campaign_packs WHERE source_workspace_id=? ORDER BY created_at DESC`).all(sourceWorkspaceId).map(hydrate);
}

export function getCampaignPack(db, campaignId) {
  ensureSchema(db);
  return hydrate(db.prepare('SELECT * FROM campaign_packs WHERE campaign_id=?').get(campaignId));
}

export function campaignStudioOverview(db) {
  ensureSchema(db);
  const total = db.prepare('SELECT COUNT(*) AS count FROM campaign_packs').get();
  const latest = db.prepare(`SELECT campaign_id, source_workspace_id, campaign_name, source_version, status, platforms_json, created_at FROM campaign_packs ORDER BY created_at DESC LIMIT 20`).all()
    .map(row => ({ ...row, platforms: parseJson(row.platforms_json, []) }));
  return { total_campaigns: Number(total?.count || 0), supported_platforms: CAMPAIGN_PLATFORMS, latest };
}
