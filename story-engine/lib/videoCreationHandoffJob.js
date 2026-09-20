// lib/videoCreationHandoffJob.js
// Consume the bounded FCR Video Creation OS handoff without granting execution authority.

import { log } from '../models/eventModel.js';
import { compileShotDirection } from './shotGrammar.js';
import { createStoryVideoJob, getStoryVideoJob } from './videoEngine.js';
import { consumeFcrVideoCreationHandoff } from './videoCreationOS.js';

const LIVE_ACTION_MARKER = '\nLIVE ACTION DELIVERY:';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function deliverySuffix(shot) {
  const prompt = String(shot?.provider_prompt || '');
  const marker = prompt.indexOf(LIVE_ACTION_MARKER);
  return marker >= 0 ? prompt.slice(marker) : '';
}

function decorateShot(shot, handoff) {
  const continuity = unique([...(Array.isArray(shot.must_preserve) ? shot.must_preserve : []), ...handoff.continuity]);
  const direction = compileShotDirection({
    command: shot.shot_command,
    action: shot.action,
    emotion: shot.emotion,
    duration_seconds: shot.duration_seconds,
    style_prompt: shot.style_prompt,
    must_preserve: continuity,
    negative_constraints: shot.negative_constraints,
    video_os: {
      subject: handoff.subject,
      scene: handoff.scene,
      output_intent: handoff.output_intent,
      selections: handoff.selections
    }
  });
  return {
    ...shot,
    must_preserve: continuity,
    shot_direction: direction,
    provider_prompt: `${direction.provider_prompt}${deliverySuffix(shot)}`
  };
}

function artifactMetadata(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function createStoryVideoJobFromHandoff(db, input = {}) {
  // Validate first. A malformed or authority-expanding handoff must create no job or artifact.
  const handoff = consumeFcrVideoCreationHandoff(input.video_creation_handoff);
  if (!handoff) return createStoryVideoJob(db, input);

  const job = createStoryVideoJob(db, input);
  const shots = (job.blueprint?.shots || []).map(shot => decorateShot(shot, handoff));
  const handoffReceipt = Object.freeze({
    contract: handoff.contract,
    video_creation_os_contract: handoff.video_creation_os_contract,
    workflow: handoff.workflow,
    target: handoff.target,
    subject: handoff.subject,
    scene: handoff.scene,
    output_intent: handoff.output_intent,
    selections: handoff.selection_list,
    continuity: handoff.continuity,
    authority: handoff.authority
  });
  const blueprint = {
    ...job.blueprint,
    production_contract: {
      ...(job.blueprint?.production_contract || {}),
      video_creation_handoff_consumed: true,
      video_creation_handoff_contract: handoff.contract,
      video_creation_os_contract: handoff.video_creation_os_contract,
      creative_handoff_grants_execution_authority: false
    },
    video_creation_handoff: handoffReceipt,
    shots
  };
  const artifact = db.prepare('SELECT metadata_json FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
  const metadata = artifactMetadata(artifact?.metadata_json);
  metadata.production_contract = blueprint.production_contract;
  metadata.video_creation_handoff = handoffReceipt;
  const now = Date.now();

  db.transaction(() => {
    db.prepare('UPDATE story_video_jobs SET blueprint_json=?,updated_at=? WHERE job_id=?')
      .run(JSON.stringify(blueprint), now, job.job_id);
    db.prepare('UPDATE story_artifacts SET metadata_json=?,updated_at=? WHERE artifact_id=?')
      .run(JSON.stringify(metadata), now, job.artifact_id);
    log(db, {
      workspace_id: job.workspace_id,
      mode: 'video_engine',
      event_type: 'video.creation_handoff.consumed',
      payload: {
        job_id: job.job_id,
        artifact_id: job.artifact_id,
        handoff_contract: handoff.contract,
        video_creation_os_contract: handoff.video_creation_os_contract,
        selection_count: handoff.selection_list.length,
        execution_authority_granted: false
      }
    });
  })();

  return getStoryVideoJob(db, job.job_id);
}
