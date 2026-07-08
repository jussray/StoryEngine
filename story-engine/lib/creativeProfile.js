// lib/creativeProfile.js

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';

const MEDIUMS = new Set(['book', 'picture_book', 'movie', 'tv', 'song', 'short_clip', 'comic', 'game', 'play', 'podcast', 'series']);
const AUDIENCES = new Set(['baby', 'child', 'eli5', 'eli10', 'middle_grade', 'teen', 'young_adult', 'adult', 'expert']);
const GOALS = new Set(['entertain', 'teach', 'inspire', 'inform', 'persuade', 'explore', 'entertain_and_teach']);

const AUDIENCE_RULES = {
  baby: { reading_level: 'pre-reader', sentence_style: 'single-clause', vocabulary: 'very_simple', max_sentence_words: 6, safety: 'gentle' },
  child: { reading_level: 'grades-k-2', sentence_style: 'short', vocabulary: 'simple', max_sentence_words: 10, safety: 'reassuring' },
  eli5: { reading_level: 'grade-1', sentence_style: 'short_with_analogies', vocabulary: 'simple', max_sentence_words: 12, safety: 'reassuring' },
  eli10: { reading_level: 'grades-4-6', sentence_style: 'clear_explanatory', vocabulary: 'moderate', max_sentence_words: 18, safety: 'age_appropriate' },
  middle_grade: { reading_level: 'grades-5-8', sentence_style: 'varied_clear', vocabulary: 'moderate', max_sentence_words: 22, safety: 'age_appropriate' },
  teen: { reading_level: 'grades-8-12', sentence_style: 'emotionally_layered', vocabulary: 'advanced_accessible', max_sentence_words: 28, safety: 'teen_appropriate' },
  young_adult: { reading_level: 'young_adult', sentence_style: 'layered', vocabulary: 'advanced_accessible', max_sentence_words: 32, safety: 'ya_appropriate' },
  adult: { reading_level: 'adult', sentence_style: 'unrestricted', vocabulary: 'advanced', max_sentence_words: 40, safety: 'adult' },
  expert: { reading_level: 'expert', sentence_style: 'technical_precise', vocabulary: 'specialist', max_sentence_words: 48, safety: 'domain_specific' }
};

const MEDIUM_RULES = {
  picture_book: { unit: 'page', default_length: 32, illustration_cues: 'every_page', structure: 'page_turns' },
  book: { unit: 'chapter', default_length: 12, illustration_cues: 'optional', structure: 'three_act' },
  series: { unit: 'episode_or_book', default_length: 8, illustration_cues: 'optional', structure: 'season_arc' },
  movie: { unit: 'scene', default_length: 90, illustration_cues: 'visual_required', structure: 'screenplay_three_act' },
  tv: { unit: 'episode', default_length: 8, illustration_cues: 'visual_required', structure: 'season_and_episode_arcs' },
  song: { unit: 'section', default_length: 6, illustration_cues: 'none', structure: 'verse_chorus_bridge' },
  short_clip: { unit: 'shot', default_length: 8, illustration_cues: 'visual_required', structure: 'hook_build_payoff' },
  comic: { unit: 'panel', default_length: 24, illustration_cues: 'every_panel', structure: 'page_and_panel_beats' },
  game: { unit: 'quest_or_scene', default_length: 10, illustration_cues: 'visual_optional', structure: 'branching_narrative' },
  play: { unit: 'scene', default_length: 12, illustration_cues: 'stage_direction', structure: 'acts_and_scenes' },
  podcast: { unit: 'segment', default_length: 8, illustration_cues: 'none', structure: 'audio_episode' }
};

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function array(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

export function ensureCreativeProfileSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL UNIQUE,
      medium TEXT NOT NULL,
      audience TEXT NOT NULL,
      eli_level TEXT,
      genre TEXT,
      tone TEXT NOT NULL,
      goal TEXT NOT NULL,
      constraints_json TEXT NOT NULL DEFAULT '[]',
      outputs_json TEXT NOT NULL DEFAULT '[]',
      resolved_rules_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creative_profiles_medium ON creative_profiles(medium, audience);
    CREATE INDEX IF NOT EXISTS idx_creative_profiles_updated ON creative_profiles(updated_at);
  `);
}

export function resolveCreativeProfile(input = {}) {
  const medium = text(input.medium, 'book').toLowerCase();
  const audience = text(input.audience, 'adult').toLowerCase();
  const goal = text(input.goal, 'entertain').toLowerCase();
  if (!MEDIUMS.has(medium)) throw new Error(`Unsupported medium: ${medium}.`);
  if (!AUDIENCES.has(audience)) throw new Error(`Unsupported audience: ${audience}.`);
  if (!GOALS.has(goal)) throw new Error(`Unsupported goal: ${goal}.`);

  const eliLevel = text(input.eli_level, audience.startsWith('eli') ? audience : '');
  const audienceRules = AUDIENCE_RULES[audience];
  const mediumRules = MEDIUM_RULES[medium] || MEDIUM_RULES.book;
  const constraints = array(input.constraints);
  const outputs = array(input.outputs).length ? array(input.outputs) : [medium];
  const tone = text(input.tone, audience === 'baby' || audience === 'child' ? 'gentle' : 'engaging');
  const genre = text(input.genre, 'general');

  return {
    medium,
    audience,
    eli_level: eliLevel || null,
    genre,
    tone,
    goal,
    constraints,
    outputs,
    resolved_rules: {
      ...audienceRules,
      ...mediumRules,
      tone,
      genre,
      goal,
      require_human_decision: true,
      redteam_pre_runtime: true,
      redteam_pre_release: true,
      profile_instruction: `Create a ${genre} ${medium} for ${audience}. Use ${audienceRules.vocabulary} vocabulary, ${audienceRules.sentence_style} sentences, a ${tone} tone, and optimize to ${goal}.`
    }
  };
}

function hydrate(row) {
  if (!row) return null;
  const parse = (value, fallback) => {
    try { return JSON.parse(value || ''); } catch { return fallback; }
  };
  return {
    ...row,
    constraints: parse(row.constraints_json, []),
    outputs: parse(row.outputs_json, []),
    resolved_rules: parse(row.resolved_rules_json, {})
  };
}

export function getCreativeProfile(db, workspaceId) {
  ensureCreativeProfileSchema(db);
  return hydrate(db.prepare('SELECT * FROM creative_profiles WHERE workspace_id = ?').get(workspaceId));
}

export function upsertCreativeProfile(db, workspaceId, input = {}) {
  ensureCreativeProfileSchema(db);
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspaceId);
  if (!story) throw new Error('Workspace not found.');
  const resolved = resolveCreativeProfile({ genre: story.genre, ...input });
  const existing = getCreativeProfile(db, workspaceId);
  const now = Date.now();

  if (existing) {
    db.prepare(`
      UPDATE creative_profiles
      SET medium = ?, audience = ?, eli_level = ?, genre = ?, tone = ?, goal = ?,
          constraints_json = ?, outputs_json = ?, resolved_rules_json = ?,
          status = 'active', version = version + 1, updated_at = ?
      WHERE workspace_id = ?
    `).run(
      resolved.medium, resolved.audience, resolved.eli_level, resolved.genre,
      resolved.tone, resolved.goal, JSON.stringify(resolved.constraints),
      JSON.stringify(resolved.outputs), JSON.stringify(resolved.resolved_rules), now, workspaceId
    );
  } else {
    db.prepare(`
      INSERT INTO creative_profiles (
        profile_id, workspace_id, medium, audience, eli_level, genre, tone, goal,
        constraints_json, outputs_json, resolved_rules_json, status, version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
    `).run(
      randomUUID(), workspaceId, resolved.medium, resolved.audience, resolved.eli_level,
      resolved.genre, resolved.tone, resolved.goal, JSON.stringify(resolved.constraints),
      JSON.stringify(resolved.outputs), JSON.stringify(resolved.resolved_rules), now, now
    );
  }

  const profile = getCreativeProfile(db, workspaceId);
  log(db, {
    workspace_id: workspaceId,
    mode: 'creative_profile',
    event_type: existing ? 'creative_profile.updated' : 'creative_profile.created',
    payload: {
      profile_id: profile.profile_id,
      medium: profile.medium,
      audience: profile.audience,
      eli_level: profile.eli_level,
      outputs: profile.outputs,
      version: profile.version
    }
  });
  return profile;
}

export function creativeProfileContext(db, workspaceId) {
  const profile = getCreativeProfile(db, workspaceId);
  if (!profile) return null;
  return {
    profile_id: profile.profile_id,
    version: profile.version,
    medium: profile.medium,
    audience: profile.audience,
    eli_level: profile.eli_level,
    genre: profile.genre,
    tone: profile.tone,
    goal: profile.goal,
    constraints: profile.constraints,
    outputs: profile.outputs,
    instructions: profile.resolved_rules
  };
}

export const CREATIVE_PROFILE_OPTIONS = Object.freeze({
  mediums: [...MEDIUMS],
  audiences: [...AUDIENCES],
  goals: [...GOALS]
});
