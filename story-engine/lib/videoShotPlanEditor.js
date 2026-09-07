// lib/videoShotPlanEditor.js
// Creator-facing editing for an existing deterministic Story Video shot plan.

import { createHash } from 'node:crypto';
import { compileShotDirection, SHOT_COMMANDS } from './shotGrammar.js';
import { ensureVideoEngineSchema, getStoryVideoJob } from './videoEngine.js';
import { log } from '../models/eventModel.js';

const COMMAND_TEMPLATES = Object.freeze([
  '/establish',
  '/dolly-in subject',
  '/whip-pan subject',
  '/rack-focus subject -> target',
  '/hyperlapse place',
  '/reaction subject',
  '/insert story detail',
  '/close subject'
]);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function hasCompletedExport(db, jobId) {
  if (!tableExists(db, 'story_video_exports')) return false;
  return Boolean(db.prepare("SELECT 1 FROM story_video_exports WHERE job_id=? AND status='complete' LIMIT 1").get(jobId));
}

function articleMarkup(shot, index) {
  const previewMove = shot.preview_camera_move || shot.shot_direction?.preview_camera_move || shot.camera_move;
  return `<article class="shot ${index === 0 ? 'active' : ''}" data-testid="video-shot" data-duration="${shot.duration_seconds}" data-shot-command="${html(shot.shot_command || '')}"><div class="camera ${html(previewMove)}"><small>${html(shot.shot_command || shot.shot_type)} · ${html(shot.camera_move)}</small><h2>${html(shot.source_chapter_title)}</h2><p>${html(shot.narration)}</p><footer>${html(shot.emotion)} · ${html(shot.intensity)} · ${shot.duration_seconds}s</footer></div></article>`;
}

function rebuildArtifactHtml(sourceHtml, shots) {
  let index = 0;
  const htmlValue = String(sourceHtml || '').replace(/<article class="shot [\s\S]*?<\/article>/g, match => {
    if (index >= shots.length) return match;
    return articleMarkup(shots[index], index++);
  });
  if (index !== shots.length) throw new Error('Video artifact shot markup does not match the blueprint.');
  return htmlValue;
}

function compileEditedShot(original, requested) {
  const command = clean(requested?.command);
  if (!command) throw new Error(`Shot ${original.shot_id} requires a command.`);
  const direction = compileShotDirection({
    command,
    action: original.action,
    emotion: original.emotion,
    duration_seconds: original.duration_seconds,
    style_prompt: original.style_prompt,
    must_preserve: original.must_preserve,
    negative_constraints: original.negative_constraints
  });
  return {
    ...original,
    shot_command: direction.command,
    shot_type: direction.shot_type,
    camera_move: direction.camera_move,
    preview_camera_move: direction.preview_camera_move,
    shot_direction: direction,
    provider_prompt: direction.provider_prompt
  };
}

function requestedShots(job, input) {
  const originals = Array.isArray(job.blueprint?.shots) ? job.blueprint.shots : [];
  const requested = Array.isArray(input?.shots) ? input.shots : [];
  if (!originals.length) throw new Error('Video job has no editable shots.');
  if (requested.length !== originals.length) throw new Error('Shot plan edits must preserve the existing shot count.');

  const byId = new Map(originals.map(shot => [shot.shot_id, shot]));
  const seen = new Set();
  return requested.map(item => {
    const shotId = clean(item?.shot_id);
    if (!shotId || !byId.has(shotId)) throw new Error(`Unknown shot_id: ${shotId || '(missing)'}.`);
    if (seen.has(shotId)) throw new Error(`Duplicate shot_id: ${shotId}.`);
    seen.add(shotId);
    return compileEditedShot(byId.get(shotId), item);
  });
}

export function storyVideoShotEditorOptions() {
  return {
    editable: true,
    reorderable: true,
    immutable_after_export: true,
    commands: COMMAND_TEMPLATES.map((template, index) => ({
      template,
      command_name: Object.keys(SHOT_COMMANDS)[index] || null
    }))
  };
}

export function updateStoryVideoShotPlan(db, jobId, input = {}) {
  ensureVideoEngineSchema(db);
  const job = getStoryVideoJob(db, jobId);
  if (!job) throw new Error('Video job not found.');
  if (hasCompletedExport(db, jobId)) throw new Error('Exported shot plans are immutable. Create a new video job to change direction.');

  const artifact = db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
  if (!artifact) throw new Error('Video artifact not found.');

  const shots = requestedShots(job, input);
  const editedAt = Date.now();
  const blueprint = {
    ...job.blueprint,
    shot_plan_revision: Number(job.blueprint?.shot_plan_revision || 0) + 1,
    shot_plan_edited_at: editedAt,
    shots,
    shot_grammar: {
      ...(job.blueprint?.shot_grammar || {}),
      provider_neutral: true,
      compiler: 'deterministic_shot_grammar',
      command_count: shots.length,
      commands: shots.map(shot => shot.shot_command),
      creator_editable: true,
      last_edited_at: editedAt
    }
  };
  const artifactHtml = rebuildArtifactHtml(artifact.html, shots);
  const contentHash = createHash('sha256').update(artifactHtml).digest('hex');

  db.transaction(() => {
    db.prepare(`UPDATE story_video_jobs SET status='ready_for_validation',blueprint_json=?,validation_json='{}',updated_at=? WHERE job_id=?`)
      .run(JSON.stringify(blueprint), editedAt, jobId);
    db.prepare(`UPDATE story_artifacts SET status='generated',content_hash=?,html=?,validation_json='{}',updated_at=? WHERE artifact_id=?`)
      .run(contentHash, artifactHtml, editedAt, artifact.artifact_id);
    log(db, {
      workspace_id: job.workspace_id,
      mode: 'video_engine',
      event_type: 'video.shot_plan.edited',
      payload: {
        job_id: jobId,
        artifact_id: artifact.artifact_id,
        shot_plan_revision: blueprint.shot_plan_revision,
        shot_order: shots.map(shot => shot.shot_id),
        commands: shots.map(shot => shot.shot_command),
        validation_reset: true,
        provider_generation: false
      }
    });
  })();

  return getStoryVideoJob(db, jobId);
}
