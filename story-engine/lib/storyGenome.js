// lib/storyGenome.js

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

  const current = db.prepare('SELECT version FROM story_genomes WHERE workspace_id = ?').get(workspaceId);
  const version = Number(current?.version || 0) + 1;
  db.prepare(`
    INSERT INTO story_genomes (workspace_id, genome_json, version, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      genome_json = excluded.genome_json,
      version = excluded.version,
      updated_at = excluded.updated_at
  `).run(workspaceId, JSON.stringify(genome), version, Date.now());

  log(db, {
    workspace_id: workspaceId,
    mode: 'lindymode',
    event_type: 'story_genome.refreshed',
    payload: { version, chapter_count: chapters.length, total_words: totalWords }
  });

  return { ...genome, version };
}

export function getStoryGenome(db, workspaceId) {
  const row = db.prepare('SELECT * FROM story_genomes WHERE workspace_id = ?').get(workspaceId);
  if (!row) return null;
  return { ...JSON.parse(row.genome_json || '{}'), version: row.version, updated_at: row.updated_at };
}
