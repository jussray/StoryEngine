// lib/storyArchitect.js

import { randomUUID } from 'node:crypto';
import * as Outline from '../models/outlineModel.js';
import { enqueueRuntime } from './runtimeDispatcher.js';
import { log } from '../models/eventModel.js';
import { getIdea } from './ideaForge.js';

const ACT_BLUEPRINTS = [
  { act: 1, name: 'Setup', purpose: 'Establish the promise, protagonist, stakes, and first irreversible disturbance.' },
  { act: 2, name: 'Escalation', purpose: 'Increase pressure, deepen relationships, reveal costs, and force adaptation.' },
  { act: 3, name: 'Resolution', purpose: 'Trigger the decisive confrontation, transformation, and earned final image.' }
];

const CHAPTER_BEATS = [
  'Opening image and emotional promise',
  'Normal world under pressure',
  'Inciting disturbance',
  'Refusal, doubt, or failed first response',
  'Commitment into the central conflict',
  'Early progress with a hidden cost',
  'Relationship test and new information',
  'Midpoint reversal or false victory',
  'Consequences tighten the trap',
  'Lowest point and identity challenge',
  'Final strategy and decisive choice',
  'Climax, aftermath, and transformed final image'
];

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function chapterCount(value) {
  const number = Number(value || 12);
  if (!Number.isFinite(number)) return 12;
  return Math.max(6, Math.min(Math.floor(number), 40));
}

function distribute(count) {
  const actOne = Math.max(2, Math.round(count * 0.25));
  const actThree = Math.max(2, Math.round(count * 0.25));
  return [actOne, count - actOne - actThree, actThree];
}

function slug(value) {
  return text(value, 'story')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'story';
}

function buildChapter(index, total, act, source) {
  const beat = CHAPTER_BEATS[Math.round((index / Math.max(1, total - 1)) * (CHAPTER_BEATS.length - 1))];
  const ordinal = index + 1;
  const tension = Math.min(100, Math.round(35 + (ordinal / total) * 55 + (act === 2 ? 8 : 0)));
  return {
    chapter_number: ordinal,
    chapter_id: `chapter-${String(ordinal).padStart(2, '0')}`,
    act,
    title: `${beat}: ${source.title}`,
    purpose: beat,
    key_points: [
      `Advance the central promise of ${source.title}.`,
      `Create a concrete change the reader or protagonist cannot ignore.`,
      `End with a question, cost, revelation, or decision that pulls forward.`
    ],
    emotional_hook: act === 1
      ? 'Curiosity mixed with recognition.'
      : act === 2 ? 'Pressure, uncertainty, and rising personal cost.' : 'Release, consequence, and earned transformation.',
    tension_score: tension,
    status: 'planned'
  };
}

export function generateArchitecture(input = {}, idea = null, story = null) {
  const count = chapterCount(input.chapter_count);
  const title = text(input.title, idea?.title || story?.title || 'Untitled Story');
  const genre = text(input.genre, story?.genre || idea?.niche || 'general');
  const audience = text(input.audience, idea?.target_audience || idea?.audience || 'general readers');
  const premise = text(input.premise, idea?.premise || story?.pitch || `A compelling exploration of ${title}.`);
  const theme = text(input.theme, `Transformation through pressure, choice, and consequence in ${genre}.`);
  const distributions = distribute(count);
  const acts = [];
  let cursor = 0;

  for (let index = 0; index < ACT_BLUEPRINTS.length; index += 1) {
    const blueprint = ACT_BLUEPRINTS[index];
    const chapters = Array.from({ length: distributions[index] }, () => {
      const chapter = buildChapter(cursor, count, blueprint.act, { title, premise });
      cursor += 1;
      return chapter;
    });
    acts.push({ ...blueprint, chapters });
  }

  return {
    architecture_id: randomUUID(),
    title,
    genre,
    audience,
    premise,
    format: text(input.format, 'book'),
    target_chapter_count: count,
    acts,
    character_arcs: [
      {
        arc_id: `${slug(title)}-primary-arc`,
        role: 'primary',
        starting_state: 'Limited by the central problem or false belief.',
        pressure_path: 'Repeated choices expose the cost of remaining unchanged.',
        ending_state: 'Makes a visible, consequential choice that proves transformation.'
      }
    ],
    theme_map: [
      { theme, introduction: 'Act I', complication: 'Act II', resolution: 'Act III' }
    ],
    timeline: acts.flatMap(act => act.chapters.map(chapter => ({
      position: chapter.chapter_number,
      event_label: chapter.purpose,
      act: chapter.act,
      chapter_id: chapter.chapter_id
    }))),
    hooks: {
      opening: acts[0].chapters[0].emotional_hook,
      midpoint: acts[1].chapters[Math.floor(acts[1].chapters.length / 2)]?.purpose || 'Midpoint reversal',
      climax: acts[2].chapters.at(-2)?.purpose || 'Decisive confrontation',
      closing: acts[2].chapters.at(-1)?.purpose || 'Transformed final image'
    },
    generated_at: Date.now()
  };
}

export function validateArchitecture(architecture) {
  const issues = [];
  const chapters = architecture.acts.flatMap(act => act.chapters || []);
  if (architecture.acts.length !== 3) issues.push('Architecture must contain three acts.');
  if (chapters.length !== architecture.target_chapter_count) issues.push('Chapter count does not match the target.');
  if (!chapters.some(chapter => /midpoint/i.test(chapter.purpose))) issues.push('Midpoint beat is missing.');
  if (!chapters.some(chapter => /climax/i.test(chapter.purpose))) issues.push('Climax beat is missing.');
  if (!architecture.theme_map?.length) issues.push('Theme map is missing.');
  if (!architecture.character_arcs?.length) issues.push('Character arc is missing.');

  const tension = chapters.map(chapter => Number(chapter.tension_score || 0));
  const finalTension = tension.at(-2) || tension.at(-1) || 0;
  if (finalTension < 70) issues.push('Climax tension is too low.');

  return {
    passed: issues.length === 0,
    confidence: Math.max(0, 100 - issues.length * 15),
    issues,
    checks: {
      three_act_structure: architecture.acts.length === 3,
      chapter_count: chapters.length === architecture.target_chapter_count,
      midpoint: chapters.some(chapter => /midpoint/i.test(chapter.purpose)),
      climax: chapters.some(chapter => /climax/i.test(chapter.purpose)),
      theme_map: Boolean(architecture.theme_map?.length),
      character_arc: Boolean(architecture.character_arcs?.length)
    }
  };
}

export function architectureToOutline(architecture) {
  const lines = [
    `# ${architecture.title}`,
    '',
    `Genre: ${architecture.genre}`,
    `Audience: ${architecture.audience}`,
    `Premise: ${architecture.premise}`,
    ''
  ];
  for (const act of architecture.acts) {
    lines.push(`## Act ${act.act}: ${act.name}`, act.purpose, '');
    for (const chapter of act.chapters) {
      lines.push(
        `### Chapter ${chapter.chapter_number}: ${chapter.title}`,
        `Purpose: ${chapter.purpose}`,
        `Emotional hook: ${chapter.emotional_hook}`,
        ...chapter.key_points.map(point => `- ${point}`),
        ''
      );
    }
  }
  return lines.join('\n');
}

function upsertArchitecture(db, workspaceId, ideaId, architecture, validation) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM studio_architectures WHERE workspace_id = ?').get(workspaceId);
  if (existing) {
    db.prepare(`
      UPDATE studio_architectures
      SET idea_id = ?, title = ?, genre = ?, audience = ?, structure_json = ?,
          validation_json = ?, status = ?, version = version + 1, updated_at = ?
      WHERE workspace_id = ?
    `).run(
      ideaId || null, architecture.title, architecture.genre, architecture.audience,
      JSON.stringify(architecture), JSON.stringify(validation), validation.passed ? 'validated' : 'needs_review',
      now, workspaceId
    );
  } else {
    db.prepare(`
      INSERT INTO studio_architectures (
        architecture_id, workspace_id, idea_id, title, genre, audience,
        structure_json, validation_json, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      architecture.architecture_id, workspaceId, ideaId || null, architecture.title,
      architecture.genre, architecture.audience, JSON.stringify(architecture),
      JSON.stringify(validation), validation.passed ? 'validated' : 'needs_review', now, now
    );
  }
  return getArchitecture(db, workspaceId);
}

function seedGenome(db, workspaceId, architecture) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM story_genomes WHERE workspace_id = ?').get(workspaceId);
  const current = existing ? JSON.parse(existing.genome_json || '{}') : {};
  const genome = {
    ...current,
    architecture: {
      title: architecture.title,
      genre: architecture.genre,
      audience: architecture.audience,
      premise: architecture.premise,
      target_chapter_count: architecture.target_chapter_count,
      hooks: architecture.hooks,
      theme_map: architecture.theme_map,
      character_arcs: architecture.character_arcs,
      timeline: architecture.timeline
    }
  };
  if (existing) {
    db.prepare(`UPDATE story_genomes SET genome_json = ?, version = version + 1, updated_at = ? WHERE workspace_id = ?`)
      .run(JSON.stringify(genome), now, workspaceId);
  } else {
    db.prepare(`INSERT INTO story_genomes (workspace_id, genome_json, version, updated_at) VALUES (?, ?, 1, ?)`)
      .run(workspaceId, JSON.stringify(genome), now);
  }
  return genome;
}

export function buildStoryArchitecture(db, input = {}) {
  const workspaceId = text(input.workspace_id);
  if (!workspaceId) throw new Error('workspace_id is required.');
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspaceId);
  if (!story) throw new Error('Workspace not found.');
  const idea = input.idea_id ? getIdea(db, input.idea_id) : null;
  if (input.idea_id && !idea) throw new Error('Idea not found.');

  const startedAt = Date.now();
  const architecture = generateArchitecture(input, idea, story);
  const validation = validateArchitecture(architecture);
  const saved = upsertArchitecture(db, workspaceId, input.idea_id, architecture, validation);
  Outline.upsert(db, workspaceId, architectureToOutline(architecture));
  const genome = seedGenome(db, workspaceId, architecture);
  const dispatch = enqueueRuntime(db, workspaceId, 'story_architect_generated');

  log(db, {
    workspace_id: workspaceId,
    mode: 'studio',
    event_type: validation.passed ? 'story_architect.validated' : 'story_architect.needs_review',
    payload: {
      architecture_id: saved.architecture_id,
      idea_id: input.idea_id || null,
      chapter_count: architecture.target_chapter_count,
      confidence: validation.confidence,
      issues: validation.issues,
      dispatch_id: dispatch?.dispatch_id || null
    },
    duration_ms: Date.now() - startedAt,
    rollback: validation.passed ? 0 : 1
  });

  return { architecture: saved, validation, genome, dispatch };
}

export function getArchitecture(db, workspaceId) {
  const row = db.prepare('SELECT * FROM studio_architectures WHERE workspace_id = ?').get(workspaceId);
  if (!row) return null;
  let structure = {};
  let validation = {};
  try { structure = JSON.parse(row.structure_json || '{}'); } catch {}
  try { validation = JSON.parse(row.validation_json || '{}'); } catch {}
  return { ...row, structure, validation };
}
