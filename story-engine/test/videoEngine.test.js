import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  VIDEO_ENGINE_OPTIONS,
  buildStoryVideoBlueprint,
  createStoryVideoJob,
  storyVideoEngineOverview
} from '../lib/videoEngine.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id, title, genre, pitch) VALUES (?, ?, ?, ?)`)
    .run('workspace_video_test', 'The Lantern Door', 'fantasy', 'A child finds a door that only appears during storms.');
  db.prepare(`INSERT INTO chapters (workspace_id, chapter_id, title, content, position) VALUES (?, ?, ?, ?, ?)`)
    .run('workspace_video_test', 'chapter_1', 'The Storm', 'Rain hammered the windows. Mina saw a violet door glowing across the street.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id, char_id, name, role, traits, data_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('workspace_video_test', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave', 'curious']), JSON.stringify({ locked_visuals: ['yellow raincoat', 'silver glasses'] }));
  return db;
}

test('one deterministic blueprint supports every visual target without provider spend', () => {
  const db = fixtureDb();
  try {
    for (const mode of Object.keys(VIDEO_ENGINE_OPTIONS.modes)) {
      const blueprint = buildStoryVideoBlueprint(db, {
        workspace_id: 'workspace_video_test',
        mode,
        quality: 'draft',
        aspect_ratio: '16:9'
      });
      assert.equal(blueprint.target_mode, mode);
      assert.equal(blueprint.preview_renderer, 'motion_book_html');
      assert.equal(blueprint.cost_plan.estimated_cost_usd, 0);
      assert.equal(blueprint.cost_plan.provider_generation_enabled, false);
      assert.ok(blueprint.shot_count >= 1 && blueprint.shot_count <= 12);
      assert.ok(blueprint.duration_seconds <= 60);
      assert.equal(blueprint.continuity_contract.one_story_brain, true);
      assert.equal(blueprint.character_bible[0].name, 'Mina');
      assert.ok(blueprint.shots[0].must_preserve.some(item => item.includes('Mina')));
    }
  } finally {
    db.close();
  }
});

test('video job emits a reusable animated artifact and Control Room evidence', () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_test',
      mode: 'anime_2d',
      quality: 'standard',
      aspect_ratio: '9:16'
    });
    assert.equal(job.status, 'ready_for_validation');
    assert.equal(job.estimated_cost_usd, 0);
    assert.ok(job.artifact_id);

    const artifact = db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
    assert.equal(artifact.kind, 'motion_book_video_preview');
    assert.match(artifact.html, /data-testid="l99-video-artifact"/);
    assert.match(artifact.html, /data-target-mode="anime_2d"/);
    assert.match(artifact.html, /Provider cost: \$0\.00/);

    const events = db.prepare(`SELECT event_type FROM events WHERE workspace_id=? ORDER BY id`).all('workspace_video_test');
    assert.deepEqual(events.map(item => item.event_type), ['video.plan.completed', 'video.artifact.generated']);

    const overview = storyVideoEngineOverview(db);
    assert.equal(overview.status, 'awaiting_validation');
    assert.equal(overview.total_jobs, 1);
    assert.equal(overview.ready_for_validation_count, 1);
    assert.equal(overview.total_estimated_cost_usd, 0);
  } finally {
    db.close();
  }
});
