// lib/videoShotContinuityGate.js
// Structural shot-to-shot continuity gate. This is separate from LEEVIZE proof cookies:
// it validates shot-plan anchors, while proof cookies bind rendered evidence to current canon.

import { createHash } from 'node:crypto';
import { buildShotContinuityGate, compileShotDirection } from './shotGrammar.js';

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map(item => clean(item)).filter(Boolean) : [];
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function getJob(db, jobId) {
  const row = db.prepare('SELECT * FROM story_video_jobs WHERE job_id=?').get(jobId);
  return row ? { ...row, blueprint: safeJson(row.blueprint_json, {}), validation: safeJson(row.validation_json, {}) } : null;
}

function fingerprintFor(shots) {
  return createHash('sha256').update(JSON.stringify(shots.map(shot => ({
    shot_id: shot.shot_id,
    command: shot.shot_direction?.command || shot.shot_command || null,
    opening_frame: shot.shot_direction?.opening_frame || null,
    ending_frame: shot.shot_direction?.ending_frame || null,
    subject_state: shot.subject_state || null,
    environment_state: shot.environment_state || null,
    must_preserve: list(shot.must_preserve || shot.shot_direction?.continuity_constraints)
  })))).digest('hex');
}

function normalizeShotsForContinuity(shots = []) {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error('Video job has no shots available for continuity verification.');
  }

  const normalized = [];
  for (const [index, shot] of shots.entries()) {
    const previousExit = normalized.at(-1)?.shot_direction?.ending_frame || '';
    const currentDirection = shot?.shot_direction || {};
    const command = clean(shot?.shot_command || currentDirection.command);
    if (!command) throw new Error(`Shot ${shot?.shot_id || index + 1} has no shot command.`);

    const direction = compileShotDirection({
      command,
      action: shot?.action || shot?.narration,
      emotion: shot?.emotion,
      duration_seconds: shot?.duration_seconds,
      style_prompt: shot?.style_prompt,
      must_preserve: shot?.must_preserve || currentDirection.continuity_constraints,
      negative_constraints: shot?.negative_constraints || currentDirection.negative_constraints,
      opening_frame: index === 0 ? currentDirection.opening_frame : previousExit,
      ending_frame: currentDirection.ending_frame
    });

    normalized.push({
      ...shot,
      shot_direction: direction,
      subject_state: clean(
        shot?.subject_state,
        `${direction.subject || 'story subject'} remains bound to the declared character and product canon for this beat.`
      ),
      environment_state: clean(
        shot?.environment_state,
        shot?.style_prompt || 'Preserve the established environment, geography, lighting logic, and visible product state.'
      )
    });
  }
  return normalized;
}

export function deriveShotContinuityGate(shots = [], options = {}) {
  const normalized = normalizeShotsForContinuity(shots);
  const gate = buildShotContinuityGate(normalized, {
    evidence_plane: options.evidence_plane || 'GENERATED_VISUALIZATION'
  });
  return Object.freeze({
    ...gate,
    source_fingerprint: fingerprintFor(normalized)
  });
}

export function ensureStoryVideoShotContinuityGate(db, jobId) {
  const job = getJob(db, jobId);
  if (!job) throw new Error('Video job not found.');

  const derived = deriveShotContinuityGate(job.blueprint?.shots || []);
  const existing = job.blueprint?.shot_continuity_gate;
  if (
    existing?.ready_for_render === true
    && existing?.source_fingerprint
    && existing.source_fingerprint === derived.source_fingerprint
  ) {
    return { job, gate: existing, migrated: false };
  }

  if (!derived.ready_for_render) {
    const error = new Error('Shot Continuity Contract blocked render planning.');
    error.code = 'SHOT_CONTINUITY_CONTRACT_BLOCKED';
    error.failures = derived.failures;
    throw error;
  }

  const migratedAt = Date.now();
  const blueprint = {
    ...job.blueprint,
    shot_continuity_gate: derived,
    continuity_gate_migration: {
      source_schema_version: clean(job.blueprint?.schema_version, 'legacy'),
      reason: existing ? 'stale_or_unfingerprinted_gate' : 'legacy_missing_gate',
      migrated_at: migratedAt
    }
  };
  db.prepare('UPDATE story_video_jobs SET blueprint_json=?,updated_at=? WHERE job_id=?')
    .run(JSON.stringify(blueprint), migratedAt, jobId);

  return { job: getJob(db, jobId), gate: derived, migrated: true };
}
