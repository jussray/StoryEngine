// lib/ipStudio.js
// IP Studio — converts a story workspace into other formats.
// Each conversion path has a real Ghost prompt and a structured output spec.

import { complete } from './llmClient.js';
import { log } from '../models/eventModel.js';
import { randomUUID } from 'node:crypto';

export const CONVERSION_PATHS = Object.freeze([
  {
    from: 'book',
    to: 'movie',
    label: 'Book → Screenplay',
    output_format: 'fountain_screenplay',
    ghost_task: 'ip_conversion',
    description: 'Condense and restructure the story as a feature film screenplay opening. INT/EXT slug lines, action blocks, dialogue.',
    unit: 'opening 10-page screenplay segment'
  },
  {
    from: 'book',
    to: 'tv',
    label: 'Book → TV Series Bible',
    output_format: 'series_bible',
    ghost_task: 'ip_conversion',
    description: 'Expand the story into a multi-season TV series bible: logline, season arc, episode breakdown for S1, character breakdowns.',
    unit: 'series bible document'
  },
  {
    from: 'any',
    to: 'picture_book',
    label: 'Story → Picture Book',
    output_format: 'picture_book_spread',
    ghost_task: 'ip_conversion',
    description: 'Condense the story into a 32-spread picture book structure with text and illustration direction for each spread.',
    unit: '32-spread picture book outline with text'
  },
  {
    from: 'any',
    to: 'comic',
    label: 'Story → Graphic Novel',
    output_format: 'comic_script',
    ghost_task: 'ip_conversion',
    description: 'Break the opening into comic script pages: panel descriptions, dialogue, caption boxes.',
    unit: 'opening 5-page comic script'
  },
  {
    from: 'any',
    to: 'game',
    label: 'Story → Game Concept',
    output_format: 'game_design_document',
    ghost_task: 'ip_conversion',
    description: 'Extract the world, characters, and conflict into a game design document: genre, core loop, opening quest beat.',
    unit: 'game concept document'
  },
  {
    from: 'any',
    to: 'song',
    label: 'Story → Song Seed',
    output_format: 'song_prompt',
    ghost_task: 'ip_conversion',
    description: 'Extract the emotional core as a song prompt: verse concept, chorus hook, genre direction, reference artists.',
    unit: 'song seed prompt'
  }
]);

function findPath(target_format) {
  return CONVERSION_PATHS.find(p => p.to === target_format) || null;
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

export async function convertStoryFormat(db, { workspace_id, story_vision, source_medium = 'book', target_format, audience = 'adult' }) {
  ensureConversionSchema(db);
  const path = findPath(target_format);
  if (!path) throw new Error(`No conversion path found for target format: ${target_format}`);

  const conversion_id = `ipc_${randomUUID()}`;
  const t = Date.now();
  db.prepare(
    `INSERT INTO ip_conversions (conversion_id, workspace_id, source_medium, target_format, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`
  ).run(conversion_id, workspace_id, source_medium, target_format, t, t);

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
    db.prepare(
      `UPDATE ip_conversions SET status='complete', output_text=?, updated_at=? WHERE conversion_id=?`
    ).run(raw, Date.now(), conversion_id);
    log(db, { workspace_id, mode: 'ip_studio', event_type: 'ip.conversion.complete', payload: { conversion_id, target_format, chars: raw.length } });
    return { conversion_id, workspace_id, target_format, status: 'complete', output: raw, path };
  } catch (err) {
    db.prepare(
      `UPDATE ip_conversions SET status='error', error=?, updated_at=? WHERE conversion_id=?`
    ).run(err.message, Date.now(), conversion_id);
    log(db, { workspace_id, mode: 'ip_studio', event_type: 'ip.conversion.error', payload: { conversion_id, target_format, error: err.message } });
    return { conversion_id, workspace_id, target_format, status: 'error', error: err.message, path };
  }
}

export function listConversions(db, workspace_id) {
  ensureConversionSchema(db);
  return db.prepare(
    'SELECT conversion_id, target_format, status, created_at, updated_at FROM ip_conversions WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20'
  ).all(workspace_id);
}

export function getConversion(db, conversion_id) {
  ensureConversionSchema(db);
  return db.prepare('SELECT * FROM ip_conversions WHERE conversion_id=?').get(conversion_id) || null;
}

export function ipStudioOptions() {
  return {
    conversion_paths: CONVERSION_PATHS,
    supported_targets: CONVERSION_PATHS.map(p => p.to)
  };
}
