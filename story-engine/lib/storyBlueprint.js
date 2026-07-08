// lib/storyBlueprint.js

import { randomUUID } from 'node:crypto';
import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { creativeProfileContext, upsertCreativeProfile } from './creativeProfile.js';
import { getStoryGenome, buildStoryGenome } from './storyGenome.js';
import { getChildrenBookProfile } from './childrenBookProfile.js';
import { evaluateAudienceFit } from './audienceLens.js';
import { log } from '../models/eventModel.js';

export const BLUEPRINT_TARGETS = Object.freeze([
  'picture_book',
  'short_clip',
  'youtube_short',
  'movie',
  'tv',
  'comic',
  'song',
  'podcast',
  'game',
  'ip_deck'
]);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function clean(value) {
  return String(value || '').trim();
}

function ensureBlueprintSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_blueprints (
      blueprint_id TEXT PRIMARY KEY,
      source_workspace_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source_medium TEXT NOT NULL,
      audience TEXT NOT NULL,
      story_kind TEXT NOT NULL,
      blueprint_json TEXT NOT NULL DEFAULT '{}',
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_blueprints_source ON story_blueprints(source_workspace_id);

    CREATE TABLE IF NOT EXISTS blueprint_conversions (
      conversion_id TEXT PRIMARY KEY,
      blueprint_id TEXT NOT NULL,
      source_workspace_id TEXT NOT NULL,
      target_workspace_id TEXT NOT NULL,
      target_medium TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      conversion_json TEXT NOT NULL DEFAULT '{}',
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blueprint_conversions_blueprint ON blueprint_conversions(blueprint_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_blueprint_conversions_target ON blueprint_conversions(target_workspace_id);
  `);
}

function sourceText(chapters) {
  return chapters.map((chapter, index) => `${chapter.title || `Part ${index + 1}`}\n${chapter.content || chapter.text || ''}`).join('\n\n');
}

function extractNames(text) {
  const matches = [...String(text || '').matchAll(/\b[A-Z][a-z]{2,}\b/g)].map(match => match[0]);
  return [...new Set(matches)].filter(name => !['The', 'And', 'But', 'For', 'This', 'That'].includes(name)).slice(0, 12);
}

function pageOrChapterBeats(chapters) {
  return chapters.map((chapter, index) => ({
    source_position: index + 1,
    source_title: chapter.title || `Story Unit ${index + 1}`,
    source_excerpt: clean(chapter.content || chapter.text).slice(0, 400),
    emotional_job: index === 0 ? 'open the promise' : index === chapters.length - 1 ? 'resolve the promise' : 'advance the promise',
    adaptation_anchor: `Preserve the meaning of ${chapter.title || `unit ${index + 1}`}.`
  }));
}

function validateBlueprint(profile, chapters, text) {
  const findings = [];
  const childProfile = profile?.instructions?.children_book_profile || null;
  const audienceFit = evaluateAudienceFit(text, profile?.audience);
  if (!chapters.length) findings.push({ severity: 'critical', code: 'blueprint_no_source_units', message: 'A blueprint needs at least one source story unit.' });
  if (!childProfile) findings.push({ severity: 'warning', code: 'blueprint_no_children_profile', message: 'Source does not have a children-book production profile.' });
  if (audienceFit.active && !audienceFit.passed) findings.push(...audienceFit.findings);
  return {
    passed: !findings.some(finding => finding.severity === 'critical'),
    findings,
    audience_fit: audienceFit,
    child_profile: childProfile
  };
}

function hydrateBlueprint(row) {
  if (!row) return null;
  return {
    ...row,
    blueprint: parseJson(row.blueprint_json, {}),
    validation: parseJson(row.validation_json, {})
  };
}

function hydrateConversion(row) {
  if (!row) return null;
  return {
    ...row,
    conversion: parseJson(row.conversion_json, {}),
    validation: parseJson(row.validation_json, {})
  };
}

export function buildStoryBlueprint(db, sourceWorkspaceId) {
  ensureBlueprintSchema(db);
  const story = Story.get(db, sourceWorkspaceId);
  if (!story) throw new Error('Source workspace not found.');
  const chapters = Chapter.list(db, sourceWorkspaceId);
  const profile = creativeProfileContext(db, sourceWorkspaceId);
  const genome = getStoryGenome(db, sourceWorkspaceId) || buildStoryGenome(db, sourceWorkspaceId);
  const fullText = sourceText(chapters);
  const validation = validateBlueprint(profile, chapters, fullText);
  const childProfile = profile?.instructions?.children_book_profile || getChildrenBookProfile(profile?.audience, profile?.medium);
  const now = Date.now();
  const existing = db.prepare('SELECT blueprint_id FROM story_blueprints WHERE source_workspace_id=?').get(sourceWorkspaceId);
  const blueprintId = existing?.blueprint_id || `blueprint_${randomUUID()}`;

  const blueprint = {
    blueprint_id: blueprintId,
    source_workspace_id: sourceWorkspaceId,
    title: story.title,
    pitch: story.pitch || '',
    source_medium: profile?.medium || 'book',
    audience: profile?.audience || 'child',
    story_kind: profile?.story_kind || story.genre || 'other',
    emotional_effect: profile?.emotional_effect || 'mixed',
    developmental_profile: childProfile,
    canon: genome,
    characters: extractNames(fullText).map(name => ({ name, source: 'heuristic', preserve: true })),
    beats: pageOrChapterBeats(chapters),
    proof: {
      validated_book_source: validation.passed,
      audience_fit_score: validation.audience_fit?.score ?? null,
      source_unit_count: chapters.length,
      generated_at: now
    },
    conversion_rules: {
      preserve: ['core lesson', 'emotional promise', 'main characters', 'canon facts', 'age appropriateness'],
      adapt: ['length', 'format conventions', 'visual rhythm', 'dialogue density', 'platform pacing'],
      never: ['contradict source canon', 'raise emotional intensity beyond child profile', 'erase the lesson that made the book work']
    }
  };

  db.prepare(`
    INSERT INTO story_blueprints (
      blueprint_id, source_workspace_id, title, source_medium, audience,
      story_kind, blueprint_json, validation_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_workspace_id) DO UPDATE SET
      title=excluded.title,
      source_medium=excluded.source_medium,
      audience=excluded.audience,
      story_kind=excluded.story_kind,
      blueprint_json=excluded.blueprint_json,
      validation_json=excluded.validation_json,
      updated_at=excluded.updated_at
  `).run(
    blueprintId,
    sourceWorkspaceId,
    story.title,
    blueprint.source_medium,
    blueprint.audience,
    blueprint.story_kind,
    JSON.stringify(blueprint),
    JSON.stringify(validation),
    now,
    now
  );

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'story_blueprint',
    event_type: 'story_blueprint.built',
    payload: { blueprint_id: blueprintId, passed: validation.passed, target_options: BLUEPRINT_TARGETS }
  });

  return hydrateBlueprint(db.prepare('SELECT * FROM story_blueprints WHERE blueprint_id=?').get(blueprintId));
}

export function getStoryBlueprint(db, sourceWorkspaceId) {
  ensureBlueprintSchema(db);
  return hydrateBlueprint(db.prepare('SELECT * FROM story_blueprints WHERE source_workspace_id=?').get(sourceWorkspaceId));
}

export function listBlueprintConversions(db, blueprintId) {
  ensureBlueprintSchema(db);
  return db.prepare(`
    SELECT * FROM blueprint_conversions
    WHERE blueprint_id=?
    ORDER BY created_at DESC
  `).all(blueprintId).map(hydrateConversion);
}

function conversionPlan(blueprint, targetMedium) {
  const beatCount = blueprint.beats?.length || 1;
  const map = {
    short_clip: { unit: 'shot', length: '30-60 seconds', structure: ['hook', 'one clear beat', 'visual payoff', 'soft call-to-action'] },
    youtube_short: { unit: 'shot', length: '30-60 seconds', structure: ['0-2s hook', 'problem', 'tiny transformation', 'memorable final image'] },
    movie: { unit: 'scene', length: 'feature outline', structure: ['Act I setup', 'Act II escalation', 'Act III resolution'] },
    tv: { unit: 'episode', length: 'season seed', structure: ['pilot promise', 'repeatable engine', 'season question'] },
    comic: { unit: 'panel', length: 'page sequence', structure: ['establishing panel', 'action panel', 'reaction panel', 'turn panel'] },
    song: { unit: 'section', length: 'song draft', structure: ['verse', 'chorus', 'verse', 'bridge', 'chorus'] },
    podcast: { unit: 'segment', length: 'episode outline', structure: ['intro', 'story retell', 'lesson discussion', 'closing prompt'] },
    game: { unit: 'quest', length: 'narrative prototype', structure: ['goal', 'choice', 'challenge', 'reward', 'reflection'] },
    ip_deck: { unit: 'slide', length: 'professional package', structure: ['one-pager', 'series bible', 'characters', 'adaptation notes', 'comparables'] },
    picture_book: { unit: 'page', length: `${blueprint.developmental_profile?.page_count || 32} pages`, structure: ['cover promise', 'page turns', 'visual beats', 'read-aloud ending'] }
  };
  const selected = map[targetMedium] || map.short_clip;
  return {
    target_medium: targetMedium,
    source_blueprint_id: blueprint.blueprint_id,
    length: selected.length,
    unit: selected.unit,
    structure: selected.structure,
    beat_mapping: (blueprint.beats || []).map((beat, index) => ({
      source_position: beat.source_position,
      source_title: beat.source_title,
      target_unit: `${selected.unit} ${index + 1}`,
      target_job: selected.structure[index % selected.structure.length],
      preserve: beat.emotional_job,
      source_excerpt: beat.source_excerpt
    })),
    validation_promises: [
      'preserve core lesson',
      'preserve child-development profile unless target explicitly changes audience',
      'preserve canon and character identity',
      'adapt pacing to target medium',
      'route through Release Gate before publish'
    ],
    proof_note: `Converted from validated source book with ${beatCount} source unit(s).`
  };
}

function createConvertedWorkspace(db, blueprint, plan, targetMedium) {
  const targetTitle = `${blueprint.title} — ${targetMedium.replaceAll('_', ' ')}`;
  const targetWorkspaceId = Story.create(db, {
    title: targetTitle,
    genre: blueprint.story_kind,
    pitch: `Adaptation of ${blueprint.title}: ${blueprint.pitch || blueprint.conversion_rules?.preserve?.join(', ')}`
  });

  upsertCreativeProfile(db, targetWorkspaceId, {
    story_vision: `Adapt ${blueprint.title} into ${targetMedium} using source blueprint ${blueprint.blueprint_id}.`,
    story_kind: blueprint.story_kind,
    emotional_effect: blueprint.emotional_effect || 'mixed',
    medium: targetMedium === 'youtube_short' ? 'short_clip' : targetMedium === 'ip_deck' ? 'book' : targetMedium,
    audience: blueprint.audience,
    goal: targetMedium === 'ip_deck' ? 'inform' : 'entertain_and_teach',
    constraints: [
      `source_blueprint:${blueprint.blueprint_id}`,
      'preserve validated book canon',
      'do not exceed child-development profile'
    ],
    outputs: [targetMedium]
  });

  const content = [
    `Source Blueprint: ${blueprint.blueprint_id}`,
    `Target: ${targetMedium}`,
    `Length: ${plan.length}`,
    '',
    'Conversion Plan:',
    ...plan.structure.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Beat Map:',
    ...plan.beat_mapping.map(item => `- ${item.target_unit}: ${item.target_job} from ${item.source_title}`),
    '',
    'Validation Promises:',
    ...plan.validation_promises.map(item => `- ${item}`)
  ].join('\n');
  Chapter.create(db, targetWorkspaceId, { title: `${targetMedium.replaceAll('_', ' ')} adaptation plan`, content, position: 0 });
  return targetWorkspaceId;
}

export function convertBlueprint(db, sourceWorkspaceId, targetMedium) {
  ensureBlueprintSchema(db);
  const target = String(targetMedium || '').toLowerCase();
  if (!BLUEPRINT_TARGETS.includes(target)) throw new Error(`Unsupported blueprint target: ${target}.`);
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  if (!row.validation.passed) throw new Error('Source book blueprint is not valid enough to convert yet.');
  const blueprint = row.blueprint;
  const plan = conversionPlan(blueprint, target);
  const targetWorkspaceId = createConvertedWorkspace(db, blueprint, plan, target);
  const conversionId = `conversion_${randomUUID()}`;
  const now = Date.now();
  const validation = {
    passed: true,
    source_blueprint_id: row.blueprint_id,
    target_medium: target,
    checks: [
      { check: 'source_blueprint_exists', passed: true },
      { check: 'source_book_validated', passed: true },
      { check: 'canon_preservation_rules_attached', passed: true },
      { check: 'child_development_profile_preserved', passed: Boolean(blueprint.developmental_profile) }
    ]
  };

  db.prepare(`
    INSERT INTO blueprint_conversions (
      conversion_id, blueprint_id, source_workspace_id, target_workspace_id,
      target_medium, status, conversion_json, validation_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)
  `).run(conversionId, row.blueprint_id, sourceWorkspaceId, targetWorkspaceId, target, JSON.stringify(plan), JSON.stringify(validation), now, now);

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'story_blueprint',
    event_type: 'story_blueprint.converted',
    payload: { conversion_id: conversionId, blueprint_id: row.blueprint_id, target_medium: target, target_workspace_id: targetWorkspaceId }
  });
  log(db, {
    workspace_id: targetWorkspaceId,
    mode: 'story_blueprint',
    event_type: 'story_blueprint.adaptation_workspace_created',
    payload: { conversion_id: conversionId, source_workspace_id: sourceWorkspaceId, blueprint_id: row.blueprint_id, target_medium: target }
  });

  return hydrateConversion(db.prepare('SELECT * FROM blueprint_conversions WHERE conversion_id=?').get(conversionId));
}
