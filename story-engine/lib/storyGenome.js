// lib/storyGenome.js

import { createHash } from 'node:crypto';
import { log } from '../models/eventModel.js';

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function sentences(text) {
  return String(text || '').split(/[.!?]+/).map(item => item.trim()).filter(Boolean);
}

function dialogueRatio(text) {
  const source = String(text || '');
  if (!source.length) return 0;
  const quoted = [...source.matchAll(/[“"][^”"]+[”"]/g)].reduce((sum, match) => sum + match[0].length, 0);
  return Number((quoted / source.length).toFixed(3));
}

function povMarkers(text) {
  const source = String(text || '').toLowerCase();
  const first = (source.match(/\b(i|me|my|mine|we|our|ours)\b/g) || []).length;
  const third = (source.match(/\b(he|she|they|him|her|them|his|hers|their)\b/g) || []).length;
  return { first, third };
}

function ensureGenomeHistorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_genome_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      genome_hash TEXT NOT NULL,
      genome_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      UNIQUE(workspace_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_story_genome_versions_workspace
      ON story_genome_versions(workspace_id, version DESC);
  `);
}

function hashGenomeJson(genomeJson) {
  return `sha256:${createHash('sha256').update(genomeJson).digest('hex')}`;
}

function hydrateGenome(row) {
  if (!row) return null;
  const genome = JSON.parse(row.genome_json || '{}');
  return {
    ...genome,
    version: Number(row.version),
    genome_hash: row.genome_hash || hashGenomeJson(row.genome_json || '{}'),
    updated_at: row.updated_at ?? row.created_at
  };
}

export function persistStoryGenome(db, workspaceId, genome, { source = 'story_genome' } = {}) {
  ensureGenomeHistorySchema(db);
  const current = db.prepare(
    'SELECT workspace_id, genome_json, version, updated_at FROM story_genomes WHERE workspace_id = ?'
  ).get(workspaceId);
  const version = Number(current?.version || 0) + 1;
  const updatedAt = Date.now();
  const genomeJson = JSON.stringify(genome || {});
  const genomeHash = hashGenomeJson(genomeJson);

  db.transaction(() => {
    if (current) {
      const currentJson = current.genome_json || '{}';
      db.prepare(`
        INSERT OR IGNORE INTO story_genome_versions (
          workspace_id, version, genome_hash, genome_json, source, created_at
        ) VALUES (?, ?, ?, ?, 'legacy_current_backfill', ?)
      `).run(
        workspaceId,
        Number(current.version),
        hashGenomeJson(currentJson),
        currentJson,
        Number(current.updated_at || updatedAt)
      );
    }

    db.prepare(`
      INSERT INTO story_genomes (workspace_id, genome_json, version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        genome_json = excluded.genome_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(workspaceId, genomeJson, version, updatedAt);

    db.prepare(`
      INSERT INTO story_genome_versions (
        workspace_id, version, genome_hash, genome_json, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, version, genomeHash, genomeJson, source, updatedAt);
  })();

  return { ...genome, version, genome_hash: genomeHash, updated_at: updatedAt };
}

export function buildStoryGenome(db, workspaceId) {
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspaceId);
  if (!story) return null;

  const chapters = db.prepare(`
    SELECT id, title, content, position, updated_at
    FROM chapters
    WHERE workspace_id = ?
    ORDER BY position ASC, id ASC
  `).all(workspaceId);

  const state = db.prepare('SELECT * FROM lindymode_state WHERE workspace_id = ?').get(workspaceId);
  const incidents = db.prepare(`
    SELECT event_type, severity, status, drift_score, recovery_action
    FROM lindymode_incidents
    WHERE workspace_id = ?
  `).all(workspaceId);

  const chapterProfiles = chapters.map(chapter => {
    const chapterWords = words(chapter.content);
    const chapterSentences = sentences(chapter.content);
    const markers = povMarkers(chapter.content);
    return {
      chapter_id: chapter.id,
      title: chapter.title,
      words: chapterWords.length,
      average_sentence_words: chapterSentences.length
        ? Number((chapterWords.length / chapterSentences.length).toFixed(2))
        : 0,
      dialogue_ratio: dialogueRatio(chapter.content),
      pov_markers: markers
    };
  });

  const totalWords = chapterProfiles.reduce((sum, chapter) => sum + chapter.words, 0);
  const averageChapterWords = chapterProfiles.length ? totalWords / chapterProfiles.length : 0;
  const averageSentenceWords = chapterProfiles.length
    ? chapterProfiles.reduce((sum, chapter) => sum + chapter.average_sentence_words, 0) / chapterProfiles.length
    : 0;
  const averageDialogueRatio = chapterProfiles.length
    ? chapterProfiles.reduce((sum, chapter) => sum + chapter.dialogue_ratio, 0) / chapterProfiles.length
    : 0;
  const firstMarkers = chapterProfiles.reduce((sum, chapter) => sum + chapter.pov_markers.first, 0);
  const thirdMarkers = chapterProfiles.reduce((sum, chapter) => sum + chapter.pov_markers.third, 0);

  const incidentTypes = {};
  const recoveryPatterns = {};
  for (const incident of incidents) {
    incidentTypes[incident.event_type] = (incidentTypes[incident.event_type] || 0) + 1;
    if (incident.recovery_action) {
      recoveryPatterns[incident.recovery_action] = (recoveryPatterns[incident.recovery_action] || 0) + 1;
    }
  }

  const genome = {
    workspace_id: workspaceId,
    identity: {
      title: story.title,
      genre: story.genre || '',
      pitch: story.pitch || ''
    },
    narrative: {
      canonical_pov: state?.pov || '',
      arc_stage: state?.arc_stage || '',
      chapter_count: chapters.length,
      total_words: totalWords,
      average_chapter_words: Number(averageChapterWords.toFixed(2)),
      average_sentence_words: Number(averageSentenceWords.toFixed(2)),
      average_dialogue_ratio: Number(averageDialogueRatio.toFixed(3)),
      dominant_pov_signal: firstMarkers === thirdMarkers ? 'mixed' : firstMarkers > thirdMarkers ? 'first_person' : 'third_person'
    },
    operations: {
      incident_count: incidents.length,
      active_incidents: incidents.filter(item => item.status === 'active').length,
      average_drift: incidents.length
        ? Number((incidents.reduce((sum, item) => sum + Number(item.drift_score || 0), 0) / incidents.length).toFixed(3))
        : 0,
      incident_types: incidentTypes,
      recovery_patterns: recoveryPatterns
    },
    chapters: chapterProfiles,
    generated_at: Date.now()
  };

  const persisted = persistStoryGenome(db, workspaceId, genome, { source: 'story_genome.refresh' });

  log(db, {
    workspace_id: workspaceId,
    mode: 'lindymode',
    event_type: 'story_genome.refreshed',
    payload: {
      version: persisted.version,
      genome_hash: persisted.genome_hash,
      chapter_count: chapters.length,
      total_words: totalWords
    }
  });

  return persisted;
}

export function getStoryGenome(db, workspaceId) {
  ensureGenomeHistorySchema(db);
  const row = db.prepare('SELECT * FROM story_genomes WHERE workspace_id = ?').get(workspaceId);
  if (!row) return null;
  const history = db.prepare(`
    SELECT genome_hash FROM story_genome_versions
    WHERE workspace_id = ? AND version = ?
  `).get(workspaceId, Number(row.version));
  return hydrateGenome({ ...row, genome_hash: history?.genome_hash || null });
}

export function getStoryGenomeVersion(db, workspaceId, version) {
  ensureGenomeHistorySchema(db);
  const row = db.prepare(`
    SELECT workspace_id, version, genome_hash, genome_json, source, created_at
    FROM story_genome_versions
    WHERE workspace_id = ? AND version = ?
  `).get(workspaceId, Number(version));
  return hydrateGenome(row);
}

export function listStoryGenomeVersions(db, workspaceId, limit = 50) {
  ensureGenomeHistorySchema(db);
  const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
  return db.prepare(`
    SELECT workspace_id, version, genome_hash, genome_json, source, created_at
    FROM story_genome_versions
    WHERE workspace_id = ?
    ORDER BY version DESC
    LIMIT ?
  `).all(workspaceId, bounded).map(row => ({ ...hydrateGenome(row), source: row.source }));
}
