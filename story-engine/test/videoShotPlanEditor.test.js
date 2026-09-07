import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob } from '../lib/videoEngine.js';
import {
  storyVideoShotEditorOptions,
  updateStoryVideoShotPlan
} from '../lib/videoShotPlanEditor.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id, title, genre, pitch) VALUES (?, ?, ?, ?)`)
    .run('workspace_shot_editor', 'The Lantern Door', 'fantasy', 'A child finds a door that only appears during storms.');
  db.prepare(`INSERT INTO chapters (workspace_id, chapter_id, title, content, position) VALUES (?, ?, ?, ?, ?)`)
    .run('workspace_shot_editor', 'chapter_1', 'The Storm', 'Rain hammered the windows. Mina saw a violet door glowing across the street.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id, char_id, name, role, traits, data_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('workspace_shot_editor', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave']), JSON.stringify({ locked_visuals: ['yellow raincoat'] }));
  return db;
}

test('creator can reorder and recompile the existing shot strip without provider generation', () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_shot_editor',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'draft',
      aspect_ratio: '16:9'
    });
    assert.equal(job.blueprint.shots.length, 2);

    const [first, second] = job.blueprint.shots;
    const edited = updateStoryVideoShotPlan(db, job.job_id, {
      shots: [
        { shot_id: second.shot_id, command: '/reaction Mina' },
        { shot_id: first.shot_id, command: '/dolly-in Mina' }
      ]
    });

    assert.equal(edited.status, 'ready_for_validation');
    assert.deepEqual(edited.validation, {});
    assert.equal(edited.blueprint.shot_plan_revision, 1);
    assert.equal(edited.blueprint.shots[0].shot_id, second.shot_id);
    assert.equal(edited.blueprint.shots[0].shot_command, '/reaction Mina');
    assert.equal(edited.blueprint.shots[0].camera_move, 'static');
    assert.equal(edited.blueprint.shots[1].camera_move, 'dolly_in');
    assert.equal(edited.blueprint.shots[1].shot_direction.provider_neutral, true);
    assert.match(edited.blueprint.shots[1].provider_prompt, /SHOT COMMAND: \/dolly-in Mina/);
    assert.equal(edited.blueprint.shot_grammar.creator_editable, true);

    const artifact = db.prepare('SELECT html,status,validation_json FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
    assert.equal(artifact.status, 'generated');
    assert.equal(artifact.validation_json, '{}');
    assert.match(artifact.html, /data-shot-command="\/reaction Mina"/);
    assert.ok(artifact.html.indexOf('/reaction Mina') < artifact.html.indexOf('/dolly-in Mina'));

    const events = db.prepare(`SELECT event_type,payload FROM events WHERE workspace_id=? ORDER BY id`).all('workspace_shot_editor');
    assert.equal(events.at(-1).event_type, 'video.shot_plan.edited');
    assert.equal(JSON.parse(events.at(-1).payload).provider_generation, false);
  } finally {
    db.close();
  }
});

test('shot editor rejects unknown commands and exposes the creator command catalog', () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, { workspace_id: 'workspace_shot_editor' });
    assert.throws(() => updateStoryVideoShotPlan(db, job.job_id, {
      shots: job.blueprint.shots.map(shot => ({ shot_id: shot.shot_id, command: '/deploy prod' }))
    }), /Unsupported shot command/);

    const editor = storyVideoShotEditorOptions();
    assert.equal(editor.editable, true);
    assert.equal(editor.reorderable, true);
    assert.ok(editor.commands.some(item => item.template.startsWith('/rack-focus')));
  } finally {
    db.close();
  }
});
