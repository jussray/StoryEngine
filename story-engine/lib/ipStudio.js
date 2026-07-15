// lib/ipStudio.js
// IP Studio supports validated production packs and provider-backed format conversions.

import { randomUUID } from 'node:crypto';
import { buildStoryBlueprint, getStoryBlueprint, listBlueprintConversions } from './storyBlueprint.js';
import { complete } from './llmClient.js';
import { log } from '../models/eventModel.js';

export const IP_STUDIO_PACK_TYPES = Object.freeze([
  'movie',
  'tv',
  'animated_short',
  'youtube_short',
  'short_clip',
  'comic',
  'podcast',
  'song',
  'game',
  'picture_book'
]);

export const CONVERSION_PATHS = Object.freeze([
  { from: 'book', to: 'movie', label: 'Book → Screenplay', output_format: 'fountain_screenplay', ghost_task: 'ip_conversion', description: 'Condense and restructure the story as a feature film screenplay opening. INT/EXT slug lines, action blocks, dialogue.', unit: 'opening 10-page screenplay segment' },
  { from: 'book', to: 'tv', label: 'Book → TV Series Bible', output_format: 'series_bible', ghost_task: 'ip_conversion', description: 'Expand the story into a multi-season TV series bible: logline, season arc, episode breakdown for S1, character breakdowns.', unit: 'series bible document' },
  { from: 'any', to: 'picture_book', label: 'Story → Picture Book', output_format: 'picture_book_spread', ghost_task: 'ip_conversion', description: 'Condense the story into a 32-spread picture book structure with text and illustration direction for each spread.', unit: '32-spread picture book outline with text' },
  { from: 'any', to: 'comic', label: 'Story → Graphic Novel', output_format: 'comic_script', ghost_task: 'ip_conversion', description: 'Break the opening into comic script pages: panel descriptions, dialogue, caption boxes.', unit: 'opening 5-page comic script' },
  { from: 'any', to: 'game', label: 'Story → Game Concept', output_format: 'game_design_document', ghost_task: 'ip_conversion', description: 'Extract the world, characters, and conflict into a game design document: genre, core loop, opening quest beat.', unit: 'game concept document' },
  { from: 'any', to: 'song', label: 'Story → Song Seed', output_format: 'song_prompt', ghost_task: 'ip_conversion', description: 'Extract the emotional core as a song prompt: verse concept, chorus hook, genre direction, reference artists.', unit: 'song seed prompt' }
]);

function ensureProductionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_production_packs (
      pack_id TEXT PRIMARY KEY,
      source_workspace_id TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      conversion_id TEXT,
      target_workspace_id TEXT,
      source_version TEXT NOT NULL,
      target_medium TEXT NOT NULL,
      status TEXT NOT NULL,
      pack_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_production_source ON ip_production_packs(source_workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ip_production_blueprint ON ip_production_packs(blueprint_id, created_at DESC);
  `);
}

function ensureConversionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_conversions (
      conversion_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_medium TEXT,
      target_format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_text TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_conversions_workspace ON ip_conversions(workspace_id, created_at DESC);
  `);
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function hydratePack(row) {
  if (!row) return null;
  return { ...row, pack: parseJson(row.pack_json, {}) };
}

function normalizeTarget(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function visualBeat(beat, index, targetMedium) {
  return {
    beat_number: index + 1,
    source_position: beat.source_position,
    source_title: beat.source_title,
    narrative_job: beat.emotional_job,
    source_excerpt: beat.source_excerpt,
    visual_direction: `Show the visible action and emotional change from ${beat.source_title}.`,
    continuity_requirements: ['preserve canon', 'preserve character identity', 'preserve audience fit'],
    target_unit: targetMedium === 'comic' ? `page ${index + 1}` : targetMedium.includes('short') ? `shot ${index + 1}` : `scene ${index + 1}`
  };
}

function screenplayPack(blueprint, targetMedium) {
  const beats = (blueprint.beats || []).map((beat, index) => visualBeat(beat, index, targetMedium));
  const format = targetMedium === 'tv' ? 'episodic teleplay' : targetMedium === 'animated_short' ? 'animated short screenplay' : 'feature screenplay';
  return {
    format,
    screenplay: {
      title_page: { title: blueprint.title, based_on: `Validated seed ${blueprint.blueprint_id}` },
      logline: blueprint.pitch || blueprint.emotional_effect || '',
      structure: targetMedium === 'tv'
        ? ['cold open', 'act one', 'act two', 'act three', 'episode button']
        : targetMedium === 'animated_short'
          ? ['visual hook', 'setup', 'turn', 'payoff']
          : ['act one', 'act two-a', 'midpoint', 'act two-b', 'act three'],
      scene_blueprint: beats.map(beat => ({
        heading: `INT./EXT. LOCATION — TIME — ${beat.target_unit.toUpperCase()}`,
        purpose: beat.narrative_job,
        action: beat.visual_direction,
        dialogue_goal: `Express the emotional meaning of ${beat.source_title} without contradicting the source.`,
        source_excerpt: beat.source_excerpt
      }))
    },
    storyboard: beats.map(beat => ({
      panel: beat.beat_number,
      composition: `Frame the key action for ${beat.source_title}.`,
      camera: beat.beat_number === 1 ? 'establishing wide' : 'medium-to-close emotional coverage',
      motion: 'character-led movement',
      continuity: beat.continuity_requirements
    })),
    shot_list: beats.flatMap(beat => [
      { scene: beat.beat_number, shot: 'A', type: 'wide', purpose: 'establish space and action' },
      { scene: beat.beat_number, shot: 'B', type: 'medium', purpose: 'capture character action' },
      { scene: beat.beat_number, shot: 'C', type: 'close-up', purpose: 'capture emotional payoff' }
    ]),
    audio_plan: {
      dialogue: 'Use source-faithful dialogue and age-appropriate performance direction.',
      music: `Support the validated emotional promise: ${blueprint.emotional_effect || 'mixed'}.`,
      sound_design: 'Create cues from visible source actions; avoid adding canon-changing events.'
    }
  };
}

function shortFormPack(blueprint, targetMedium) {
  const beat = blueprint.beats?.[0] || {};
  return {
    format: targetMedium === 'youtube_short' ? 'vertical YouTube Short' : 'vertical short-form clip',
    duration_seconds: targetMedium === 'short_clip' ? 30 : 45,
    aspect_ratio: '9:16',
    script: [
      { time: '0-2s', role: 'hook', text: `What if ${blueprint.pitch || blueprint.title}?` },
      { time: '2-10s', role: 'setup', text: beat.source_excerpt || `Meet the world of ${blueprint.title}.` },
      { time: '10-30s', role: 'story beat', text: `Show the central change while preserving ${blueprint.emotional_effect || 'the emotional promise'}.` },
      { time: 'final', role: 'payoff', text: `Discover ${blueprint.title}.` }
    ],
    visual_plan: (blueprint.beats || []).slice(0, 4).map((item, index) => visualBeat(item, index, targetMedium)),
    captions: {
      burned_in: true,
      reading_level: blueprint.audience,
      max_words_per_card: blueprint.developmental_profile ? 8 : 12
    },
    thumbnail: { headline: blueprint.title, image_direction: 'Use the strongest source-faithful character/emotional image.' }
  };
}

function generalPack(blueprint, targetMedium) {
  return {
    format: targetMedium,
    adaptation_outline: (blueprint.beats || []).map((beat, index) => visualBeat(beat, index, targetMedium)),
    canon_bible: blueprint.canon,
    character_requirements: blueprint.characters,
    production_notes: [
      'Preserve the validated seed canon.',
      'Preserve Lindymode audience and tone constraints.',
      'Run OODA and Redteam before release.',
      'Keep all generated assets traceable to this blueprint.'
    ]
  };
}

function buildPackBody(blueprint, targetMedium) {
  const production = ['movie', 'tv', 'animated_short'].includes(targetMedium)
    ? screenplayPack(blueprint, targetMedium)
    : ['youtube_short', 'short_clip'].includes(targetMedium)
      ? shortFormPack(blueprint, targetMedium)
      : generalPack(blueprint, targetMedium);

  return {
    lineage: {
      blueprint_id: blueprint.blueprint_id,
      source_workspace_id: blueprint.source_workspace_id,
      source_title: blueprint.title,
      source_medium: blueprint.source_medium,
      target_medium: targetMedium,
      validation_seed: true
    },
    creative_lock: {
      audience: blueprint.audience,
      developmental_profile: blueprint.developmental_profile,
      emotional_effect: blueprint.emotional_effect,
      preserve: blueprint.conversion_rules?.preserve || [],
      never: blueprint.conversion_rules?.never || []
    },
    production,
    asset_manifest: ['script', 'character references', 'environment references', 'storyboard or visual beat map', 'audio direction', 'release-gate checklist'],
    release_pipeline: ['lindymode', 'ooda', 'redteam', 'playwright_or_artifact_validation', 'release_gate']
  };
}

export function buildProductionPack(db, sourceWorkspaceId, input = {}) {
  ensureProductionSchema(db);
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  if (!row.validation?.passed || !row.blueprint?.seed_gate?.conversion_ready) {
    throw new Error('Production Pack is blocked until the source becomes a validated, conversion-ready seed.');
  }

  const targetMedium = normalizeTarget(input.target_medium || input.target || 'movie');
  if (!IP_STUDIO_PACK_TYPES.includes(targetMedium)) throw new Error(`Unsupported IP Studio target: ${targetMedium}.`);

  const conversions = listBlueprintConversions(db, row.blueprint_id);
  const conversion = input.conversion_id
    ? conversions.find(item => item.conversion_id === input.conversion_id)
    : conversions.find(item => item.target_medium === targetMedium);
  const sourceVersion = conversion ? `${targetMedium}:${conversion.conversion_id}` : `${row.blueprint.source_medium}:seed`;
  const pack = buildPackBody(row.blueprint, targetMedium);
  const packId = `production_pack_${randomUUID()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO ip_production_packs (
      pack_id, source_workspace_id, blueprint_id, conversion_id, target_workspace_id,
      source_version, target_medium, status, pack_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready_for_review', ?, ?, ?)
  `).run(
    packId,
    sourceWorkspaceId,
    row.blueprint_id,
    conversion?.conversion_id || null,
    conversion?.target_workspace_id || null,
    sourceVersion,
    targetMedium,
    JSON.stringify(pack),
    now,
    now
  );

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'ip_studio',
    event_type: 'ip_studio.production_pack_built',
    payload: { pack_id: packId, blueprint_id: row.blueprint_id, target_medium: targetMedium, source_version: sourceVersion }
  });

  return hydratePack(db.prepare('SELECT * FROM ip_production_packs WHERE pack_id=?').get(packId));
}

export function listProductionPacks(db, sourceWorkspaceId) {
  ensureProductionSchema(db);
  return db.prepare('SELECT * FROM ip_production_packs WHERE source_workspace_id=? ORDER BY created_at DESC').all(sourceWorkspaceId).map(hydratePack);
}

export function getProductionPack(db, packId) {
  ensureProductionSchema(db);
  return hydratePack(db.prepare('SELECT * FROM ip_production_packs WHERE pack_id=?').get(packId));
}

export function ipStudioOverview(db) {
  ensureProductionSchema(db);
  const rows = db.prepare('SELECT target_medium, status, COUNT(*) AS count FROM ip_production_packs GROUP BY target_medium, status').all();
  return {
    total_packs: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    by_target: rows,
    supported_targets: IP_STUDIO_PACK_TYPES
  };
}

function findPath(targetFormat) {
  return CONVERSION_PATHS.find(path => path.to === targetFormat) || null;
}

export async function convertStoryFormat(db, { workspace_id, story_vision, source_medium = 'book', target_format, audience = 'adult' }) {
  ensureConversionSchema(db);
  const path = findPath(target_format);
  if (!path) throw new Error(`No conversion path found for target format: ${target_format}`);

  const conversionId = `ipc_${randomUUID()}`;
  const createdAt = Date.now();
  db.prepare(`INSERT INTO ip_conversions (conversion_id, workspace_id, source_medium, target_format, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)`)
    .run(conversionId, workspace_id, source_medium, target_format, createdAt, createdAt);

  const prompt = [
    `Story vision: ${story_vision}`,
    `Source medium: ${source_medium}`,
    `Target format: ${path.label}`,
    `Audience: ${audience}`,
    `Output unit: ${path.unit}`,
    '',
    `Task: ${path.description}`,
    '',
    'Requirements:',
    '- Start immediately in the format. No preamble.',
    '- Use the exact structural conventions of the target format.',
    '- Preserve the emotional core of the original story.',
    '- Return only the converted output.'
  ].join('\n');

  try {
    const raw = await complete(prompt, { task: 'ip_conversion', maxTokens: 2000, temperature: 0.65 });
    db.prepare("UPDATE ip_conversions SET status='complete', output_text=?, updated_at=? WHERE conversion_id=?")
      .run(raw, Date.now(), conversionId);
    log(db, { workspace_id, mode: 'ip_studio', event_type: 'ip.conversion.complete', payload: { conversion_id: conversionId, target_format, chars: raw.length } });
    return { conversion_id: conversionId, workspace_id, target_format, status: 'complete', output: raw, path };
  } catch (error) {
    db.prepare("UPDATE ip_conversions SET status='error', error=?, updated_at=? WHERE conversion_id=?")
      .run(error.message, Date.now(), conversionId);
    log(db, { workspace_id, mode: 'ip_studio', event_type: 'ip.conversion.error', payload: { conversion_id: conversionId, target_format, error: error.message } });
    return { conversion_id: conversionId, workspace_id, target_format, status: 'error', error: error.message, path };
  }
}

export function listConversions(db, workspaceId) {
  ensureConversionSchema(db);
  return db.prepare('SELECT conversion_id, target_format, status, created_at, updated_at FROM ip_conversions WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20').all(workspaceId);
}

export function getConversion(db, conversionId) {
  ensureConversionSchema(db);
  return db.prepare('SELECT * FROM ip_conversions WHERE conversion_id=?').get(conversionId) || null;
}

export function ipStudioOptions() {
  return {
    conversion_paths: CONVERSION_PATHS,
    supported_targets: CONVERSION_PATHS.map(path => path.to),
    production_pack_targets: IP_STUDIO_PACK_TYPES
  };
}
