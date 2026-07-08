// lib/ideaForge.js

import { randomUUID, createHash } from 'node:crypto';
import { log } from '../models/eventModel.js';

const ANGLES = [
  'The hidden cost of',
  'The beginner-friendly guide to',
  'The emotional survival manual for',
  'The no-fluff playbook for',
  'The quiet revolution inside',
  'The seven-day reset for',
  'The field guide to',
  'The modern blueprint for',
  'The anti-burnout method for',
  'The story-driven roadmap for'
];

const PROMISES = [
  'building confidence without pretending life is easy',
  'turning confusion into a simple repeatable system',
  'making better decisions under pressure',
  'escaping overwhelm without losing ambition',
  'creating momentum when motivation disappears',
  'protecting your energy while still growing',
  'building a life that feels honest and sustainable',
  'finding clarity in a noisy world',
  'recovering from setbacks without starting over',
  'turning small habits into visible transformation'
];

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function boundedCount(value) {
  const number = Number(value || 10);
  if (!Number.isFinite(number)) return 10;
  return Math.max(1, Math.min(Math.floor(number), 25));
}

function score(seed, offset) {
  const hash = createHash('sha256').update(`${seed}:${offset}`).digest('hex');
  return 70 + (parseInt(hash.slice(offset, offset + 2), 16) % 30);
}

function titleCase(value) {
  return value.replace(/\w\S*/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

export function generateIdeas(input = {}) {
  const niche = normalizeText(input.niche, 'personal growth');
  const audience = normalizeText(input.audience, `readers interested in ${niche}`);
  const tone = normalizeText(input.tone, 'commercial, emotionally engaging, practical');
  const count = boundedCount(input.count);
  const seed = `${niche}|${audience}|${tone}`.toLowerCase();

  return Array.from({ length: count }, (_, index) => {
    const angle = ANGLES[index % ANGLES.length];
    const promise = PROMISES[(index * 3) % PROMISES.length];
    const core = titleCase(`${angle} ${niche}`);
    const title = index % 3 === 0 ? core : `${core}: ${titleCase(promise)}`;
    const marketScore = score(seed, index + 1);
    const originalityScore = score(seed, index + 6);
    const seriesPotential = score(seed, index + 11);
    const moviePotential = score(seed, index + 16);

    return {
      idea_id: randomUUID(),
      niche,
      audience,
      title,
      premise: `${title} helps ${audience} understand ${niche} through a clear promise: ${promise}.`,
      target_audience: audience,
      problem_solved: `Readers feel stuck around ${niche}; this book gives them a concrete path forward.`,
      why_it_sells: `It combines a high-demand niche with a practical transformation, emotional hook, and clear reader outcome.`,
      market_score: marketScore,
      originality_score: originalityScore,
      series_potential: seriesPotential,
      movie_potential: moviePotential,
      metadata: {
        tone,
        rank: index + 1,
        prompt_family: 'book_idea_generator_v1',
        average_score: Math.round((marketScore + originalityScore + seriesPotential + moviePotential) / 4)
      }
    };
  }).sort((a, b) => b.metadata.average_score - a.metadata.average_score);
}

function hydrate(row) {
  if (!row) return null;
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json || '{}'); } catch {}
  return { ...row, metadata };
}

export function saveIdeas(db, workspaceId, ideas) {
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO studio_ideas (
      idea_id, workspace_id, niche, audience, title, premise,
      target_audience, problem_solved, why_it_sells,
      market_score, originality_score, series_potential, movie_potential,
      metadata_json, selected, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const run = db.transaction(items => {
    for (const idea of items) {
      insert.run(
        idea.idea_id,
        workspaceId || null,
        idea.niche,
        idea.audience,
        idea.title,
        idea.premise,
        idea.target_audience,
        idea.problem_solved,
        idea.why_it_sells,
        idea.market_score,
        idea.originality_score,
        idea.series_potential,
        idea.movie_potential,
        JSON.stringify(idea.metadata || {}),
        now
      );
    }
  });
  run(ideas);
  return ideas.map(idea => getIdea(db, idea.idea_id));
}

export function forgeIdeas(db, input = {}) {
  const startedAt = Date.now();
  const workspaceId = normalizeText(input.workspace_id, null);
  const ideas = saveIdeas(db, workspaceId, generateIdeas(input));
  log(db, {
    workspace_id: workspaceId || 'studio',
    mode: 'studio',
    event_type: 'idea_forge.generated',
    payload: {
      niche: input.niche,
      audience: input.audience,
      count: ideas.length
    },
    duration_ms: Date.now() - startedAt
  });
  return ideas;
}

export function listIdeas(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  if (options.workspace_id) {
    return db.prepare(`
      SELECT * FROM studio_ideas
      WHERE workspace_id = ?
      ORDER BY selected DESC, market_score DESC, created_at DESC
      LIMIT ?
    `).all(options.workspace_id, limit).map(hydrate);
  }
  return db.prepare(`
    SELECT * FROM studio_ideas
    ORDER BY selected DESC, market_score DESC, created_at DESC
    LIMIT ?
  `).all(limit).map(hydrate);
}

export function getIdea(db, ideaId) {
  return hydrate(db.prepare('SELECT * FROM studio_ideas WHERE idea_id = ?').get(ideaId));
}

export function selectIdea(db, ideaId) {
  const idea = getIdea(db, ideaId);
  if (!idea) return null;
  db.prepare('UPDATE studio_ideas SET selected = 1 WHERE idea_id = ?').run(ideaId);
  log(db, {
    workspace_id: idea.workspace_id || 'studio',
    mode: 'studio',
    event_type: 'idea_forge.selected',
    payload: { idea_id: ideaId, title: idea.title }
  });
  return getIdea(db, ideaId);
}
