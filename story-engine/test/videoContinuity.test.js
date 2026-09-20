import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob, getStoryVideoJob } from '../lib/videoEngine.js';
import { ensureStoryVideoContinuityGate } from '../lib/videoContinuity.js';
import { updateStoryVideoShotPlan } from '../lib/videoShotPlanEditor.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id,title,genre,pitch) VALUES (?,?,?,?)`)
    .run('workspace_video_continuity', 'The Violet Door', 'fantasy', 'Mina follows a violet door through a storm.');
  db.prepare(`INSERT INTO chapters (workspace_id,chapter_id,title,content,position) VALUES (?,?,?,?,?)`)
    .run('workspace_video_continuity', 'chapter_1', 'Storm Door', 'Mina crosses the street. Mina reaches the violet door. Mina looks through the opening.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id,char_id,name,role,traits,data_json) VALUES (?,?,?,?,?,?)`)
    .run('workspace_video_continuity', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave']), JSON.stringify({ locked_visuals: ['yellow raincoat'] }));
  return db;
}

test('shot-plan reorder rebuilds continuity contracts in rendered order', () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_continuity',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      action_beats: [
        'Mina approaches the violet door.',
        'Mina reaches for the handle.',
        'Mina looks through the opening.'
      ]
    });
    const reversed = [...job.blueprint.shots].reverse().map((shot, index) => ({
      shot_id: shot.shot_id,
      command: index === 0 ? '/establish' : shot.shot_command
    }));

    const edited = updateStoryVideoShotPlan(db, job.job_id, { shots: reversed });
    const contracts = edited.blueprint.shot_continuity_gate.contracts;
    assert.equal(edited.blueprint.shot_continuity_gate.ready_for_render, true);
    assert.match(edited.blueprint.shot_continuity_gate.source_fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(contracts.map(item => item.SHOT_ID), edited.blueprint.shots.map(shot => shot.shot_id));
    for (let index = 1; index < contracts.length; index += 1) {
      assert.equal(contracts[index].ENTRY_FRAME_ANCHOR, contracts[index - 1].EXIT_FRAME_ANCHOR);
    }
  } finally {
    db.close();
  }
});

test('legacy validated blueprint deterministically acquires a continuity gate once', () => {
  const db = fixtureDb();
  try {
    const created = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_continuity',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      action_beats: ['Mina approaches the violet door.', 'Mina reaches for the handle.']
    });
    const legacyBlueprint = { ...created.blueprint, schema_version: '1.3.0' };
    delete legacyBlueprint.shot_continuity_gate;
    db.prepare(`UPDATE story_video_jobs SET status='validated',blueprint_json=? WHERE job_id=?`)
      .run(JSON.stringify(legacyBlueprint), created.job_id);

    const first = ensureStoryVideoContinuityGate(db, created.job_id);
    assert.equal(first.migrated, true);
    assert.equal(first.gate.ready_for_render, true);
    assert.match(first.gate.source_fingerprint, /^[0-9a-f]{64}$/);
    const persisted = getStoryVideoJob(db, created.job_id);
    assert.equal(persisted.status, 'validated');
    assert.equal(persisted.blueprint.continuity_gate_migration.reason, 'legacy_missing_gate');
    assert.equal(persisted.blueprint.shot_continuity_gate.source_fingerprint, first.gate.source_fingerprint);

    const second = ensureStoryVideoContinuityGate(db, created.job_id);
    assert.equal(second.migrated, false);
    assert.equal(second.gate.source_fingerprint, first.gate.source_fingerprint);
  } finally {
    db.close();
  }
});
