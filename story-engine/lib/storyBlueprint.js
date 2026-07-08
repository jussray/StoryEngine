// lib/storyBlueprint.js

import { randomUUID } from 'node:crypto';
import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { creativeProfileContext, upsertCreativeProfile } from './creativeProfile.js';
import { getStoryGenome, buildStoryGenome } from './storyGenome.js';
import { getChildrenBookProfile } from './childrenBookProfile.js';
import { evaluateAudienceFit } from './audienceLens.js';
import { evaluateWorkspace, persistDecision } from './decisionEngine.js';
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

const TARGET_PRIORITY = Object.freeze({
  picture_book: 80,
  short_clip: 98,
  youtube_short: 100,
  movie: 84,
  tv: 78,
  comic: 88,
  song: 75,
  podcast: 72,
  game: 70,
  ip_deck: 82
});

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

function validateLindymodeSeed(profile, chapters, text) {
  const findings = [];
  const childProfile = profile?.instructions?.children_book_profile || null;
  const audienceFit = evaluateAudienceFit(text, profile?.audience);
  const genomeSignals = {
    source_unit_count: chapters.length,
    total_words: text.split(/\s+/).filter(Boolean).length,
    audience: profile?.audience || null,
    medium: profile?.medium || null,
    child_profile_active: Boolean(childProfile)
  };

  if (!chapters.length) findings.push({ severity: 'critical', code: 'seed_no_source_units', message: 'A seed needs at least one completed source story unit.' });
  if (!profile) findings.push({ severity: 'critical', code: 'seed_missing_creative_profile', message: 'Seed cannot be validated without a Creative Profile.' });
  if (childProfile && chapters.length < 1) findings.push({ severity: 'critical', code: 'seed_children_book_incomplete', message: 'Children’s-book seed needs story units before conversion.' });
  if (!childProfile && ['baby', 'child', 'eli5', 'eli10', 'middle_grade'].includes(profile?.audience)) {
    findings.push({ severity: 'warning', code: 'seed_no_children_profile', message: 'Child-facing source does not have a children’s-book production profile.' });
  }
  if (audienceFit.active && !audienceFit.passed) findings.push(...audienceFit.findings.map(finding => ({ ...finding, source: 'lindymode_seed_validation' })));

  return {
    stage: 'lindymode_validation',
    passed: !findings.some(finding => finding.severity === 'critical'),
    preset: childProfile || profile?.instructions || null,
    findings,
    audience_fit: audienceFit,
    genome_signals: genomeSignals
  };
}

function runOodaSeedDecision(db, workspaceId, lindymodeValidation) {
  const decision = persistDecision(db, evaluateWorkspace(db, workspaceId));
  const blockers = [];
  if (!lindymodeValidation.passed) blockers.push('lindymode_seed_validation_failed');
  if (decision.action === 'BLOCK') blockers.push('ooda_blocked_source_seed');
  return {
    stage: 'ooda_decision',
    passed: blockers.length === 0,
    decision_id: decision.decision_id,
    action: decision.action,
    readiness: decision.readiness,
    confidence_score: decision.confidence_score,
    reasons: decision.reasons,
    blockers
  };
}

function redteamSeedCheck(blueprintDraft, lindymodeValidation, oodaDecision) {
  const findings = [];
  const childProfile = blueprintDraft.developmental_profile;
  if (!lindymodeValidation.passed) {
    findings.push({ severity: 'critical', code: 'redteam_lindymode_seed_failed', message: 'Do not unlock conversions until Lindymode validates the source against its preset.' });
  }
  if (!oodaDecision.passed) {
    findings.push({ severity: 'critical', code: 'redteam_ooda_seed_blocked', message: 'OODA did not clear this source as a safe seed.' });
  }
  if (!blueprintDraft.beats?.length) {
    findings.push({ severity: 'critical', code: 'redteam_no_adaptation_beats', message: 'Seed has no beat map to continue from.' });
  }
  if (childProfile && !blueprintDraft.conversion_rules?.never?.includes('raise emotional intensity beyond child profile')) {
    findings.push({ severity: 'critical', code: 'redteam_missing_child_safety_rule', message: 'Child-facing seed must preserve the original emotional ceiling during conversions.' });
  }
  if (blueprintDraft.characters?.length === 0) {
    findings.push({ severity: 'warning', code: 'redteam_weak_character_signal', message: 'Seed has weak character extraction; conversions may need manual review.' });
  }
  return {
    stage: 'redteam_seed_check',
    passed: !findings.some(finding => finding.severity === 'critical'),
    findings,
    challenged_at: Date.now()
  };
}

function seedStatus(lindymodeValidation, oodaDecision, redteam) {
  if (!lindymodeValidation.passed) return 'blocked_lindymode';
  if (!oodaDecision.passed) return 'blocked_ooda';
  if (!redteam.passed) return 'blocked_redteam';
  return 'conversion_ready';
}

function continuationOptions(blueprint, seedGate) {
  if (seedGate.status !== 'conversion_ready') return [];
  const child = Boolean(blueprint.developmental_profile);
  const ranked = BLUEPRINT_TARGETS.map(target => {
    let score = TARGET_PRIORITY[target] || 50;
    if (child && ['youtube_short', 'short_clip', 'comic', 'song', 'picture_book'].includes(target)) score += 12;
    if (child && ['game', 'tv', 'movie'].includes(target)) score -= 8;
    if (target === blueprint.source_medium) score -= 20;
    return {
      target_medium: target,
      score,
      continuation_type: child ? 'child-safe continuation' : 'source-faithful continuation',
      reason: child
        ? `Continues the validated ${blueprint.audience} book while preserving its developmental profile.`
        : `Continues the validated ${blueprint.source_medium} while preserving canon and audience promise.`
    };
  }).sort((a, b) => b.score - a.score);
  return ranked;
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
  const lindymodeValidation = validateLindymodeSeed(profile, chapters, fullText);
  const childProfile = profile?.instructions?.children_book_profile || getChildrenBookProfile(profile?.audience, profile?.medium);
  const now = Date.now();
  const existing = db.prepare('SELECT blueprint_id FROM story_blueprints WHERE source_workspace_id=?').get(sourceWorkspaceId);
  const blueprintId = existing?.blueprint_id || `blueprint_${randomUUID()}`;

  const blueprintDraft = {
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
    conversion_rules: {
      preserve: ['core lesson', 'emotional promise', 'main characters', 'canon facts', 'age appropriateness'],
      adapt: ['length', 'format conventions', 'visual rhythm', 'dialogue density', 'platform pacing'],
      never: ['contradict source canon', 'raise emotional intensity beyond child profile', 'erase the lesson that made the book work']
    }
  };
  const oodaDecision = runOodaSeedDecision(db, sourceWorkspaceId, lindymodeValidation);
  const redteam = redteamSeedCheck(blueprintDraft, lindymodeValidation, oodaDecision);
  const status = seedStatus(lindymodeValidation, oodaDecision, redteam);
  const seedGate = {
    required_order: ['book', 'lindymode_validation', 'ooda_decision', 'redteam_seed_check', 'conversion_ready'],
    status,
    conversion_ready: status === 'conversion_ready',
    lindymode_validation: lindymodeValidation,
    ooda_decision: oodaDecision,
    redteam_seed_check: redteam
  };
  const blueprint = {
    ...blueprintDraft,
    proof: {
      validated_seed_source: seedGate.conversion_ready,
      lindymode_validated: lindymodeValidation.passed,
      ooda_cleared: oodaDecision.passed,
      redteam_cleared: redteam.passed,
      audience_fit_score: lindymodeValidation.audience_fit?.score ?? null,
      source_unit_count: chapters.length,
      generated_at: now
    },
    seed_gate: seedGate,
    continuation_options: continuationOptions(blueprintDraft, seedGate)
  };
  const validation = {
    passed: seedGate.conversion_ready,
    status,
    seed_gate: seedGate,
    findings: [
      ...lindymodeValidation.findings,
      ...oodaDecision.blockers.map(code => ({ severity: 'critical', code, message: 'OODA blocked seed conversion.' })),
      ...redteam.findings
    ],
    audience_fit: lindymodeValidation.audience_fit,
    child_profile: childProfile
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
    event_type: 'story_blueprint.seed_gate_completed',
    payload: {
      blueprint_id: blueprintId,
      status,
      lindymode_validated: lindymodeValidation.passed,
      ooda_cleared: oodaDecision.passed,
      redteam_cleared: redteam.passed,
      continuation_options: blueprint.continuation_options.map(option => option.target_medium)
    }
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

export function getBlueprintContinuationOptions(db, sourceWorkspaceId) {
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  return {
    blueprint_id: row.blueprint_id,
    source_workspace_id: sourceWorkspaceId,
    seed_gate: row.blueprint.seed_gate,
    options: row.blueprint.continuation_options || []
  };
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
    proof_note: `Converted from Lindymode/OODA/Redteam-cleared seed with ${beatCount} source unit(s).`
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
    story_vision: `Continue ${blueprint.title} into ${targetMedium} using seed blueprint ${blueprint.blueprint_id}.`,
    story_kind: blueprint.story_kind,
    emotional_effect: blueprint.emotional_effect || 'mixed',
    medium: targetMedium === 'youtube_short' ? 'short_clip' : targetMedium === 'ip_deck' ? 'book' : targetMedium,
    audience: blueprint.audience,
    goal: targetMedium === 'ip_deck' ? 'inform' : 'entertain_and_teach',
    constraints: [
      `source_blueprint:${blueprint.blueprint_id}`,
      'preserve validated seed canon',
      'preserve Lindymode preset validation',
      'preserve OODA seed decision',
      'preserve Redteam seed check',
      'do not exceed child-development profile'
    ],
    outputs: [targetMedium]
  });

  const content = [
    `Source Blueprint: ${blueprint.blueprint_id}`,
    `Target: ${targetMedium}`,
    `Length: ${plan.length}`,
    '',
    'Seed Gate:',
    `- Lindymode: ${blueprint.seed_gate?.lindymode_validation?.passed ? 'passed' : 'blocked'}`,
    `- OODA: ${blueprint.seed_gate?.ooda_decision?.passed ? 'passed' : 'blocked'}`,
    `- Redteam: ${blueprint.seed_gate?.redteam_seed_check?.passed ? 'passed' : 'blocked'}`,
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
  Chapter.create(db, targetWorkspaceId, { title: `${targetMedium.replaceAll('_', ' ')} continuation plan`, content, position: 0 });
  return targetWorkspaceId;
}

export function convertBlueprint(db, sourceWorkspaceId, targetMedium) {
  ensureBlueprintSchema(db);
  const target = String(targetMedium || '').toLowerCase();
  if (!BLUEPRINT_TARGETS.includes(target)) throw new Error(`Unsupported blueprint target: ${target}.`);
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  if (!row.validation.passed || !row.blueprint.seed_gate?.conversion_ready) {
    throw new Error('Seed is not conversion-ready. Required order: Book → Lindymode Validation → OODA → Redteam Seed Check → Convert.');
  }
  const blueprint = row.blueprint;
  const option = (blueprint.continuation_options || []).find(item => item.target_medium === target);
  if (!option) throw new Error(`Target ${target} is not unlocked for this seed.`);
  const plan = conversionPlan(blueprint, target);
  const targetWorkspaceId = createConvertedWorkspace(db, blueprint, plan, target);
  const conversionId = `conversion_${randomUUID()}`;
  const now = Date.now();
  const validation = {
    passed: true,
    source_blueprint_id: row.blueprint_id,
    target_medium: target,
    seed_gate: blueprint.seed_gate,
    continuation_option: option,
    checks: [
      { check: 'source_blueprint_exists', passed: true },
      { check: 'lindymode_seed_validated', passed: blueprint.seed_gate.lindymode_validation.passed },
      { check: 'ooda_seed_cleared', passed: blueprint.seed_gate.ooda_decision.passed },
      { check: 'redteam_seed_checked', passed: blueprint.seed_gate.redteam_seed_check.passed },
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
    event_type: 'story_blueprint.converted_after_seed_gate',
    payload: { conversion_id: conversionId, blueprint_id: row.blueprint_id, target_medium: target, target_workspace_id: targetWorkspaceId }
  });
  log(db, {
    workspace_id: targetWorkspaceId,
    mode: 'story_blueprint',
    event_type: 'story_blueprint.continuation_workspace_created',
    payload: { conversion_id: conversionId, source_workspace_id: sourceWorkspaceId, blueprint_id: row.blueprint_id, target_medium: target }
  });

  return hydrateConversion(db.prepare('SELECT * FROM blueprint_conversions WHERE conversion_id=?').get(conversionId));
}
