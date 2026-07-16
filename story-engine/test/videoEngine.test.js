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
  db.prepare(`INSERT INTO chapters (workspace_id, chapter_id, title, content, position) VALUES (?, ?, ?, ?, ?) `)
    .run('workspace_video_test', 'chapter_1', 'The Storm', 'Rain hammered the windows. Mina saw a violet door glowing across the street.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id, char_id, name, role, traits, data_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('workspace_video_test', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave', 'curious']), JSON.stringify({ locked_visuals: ['yellow raincoat', 'silver glasses'] }));
  return db;
}

test('render modes and visual styles are separate zero-cost decisions', () => {
  const db = fixtureDb();
  try {
    const styleKeys = Object.keys(VIDEO_ENGINE_OPTIONS.visual_styles).filter(style => style !== 'custom');
    assert.ok(styleKeys.length >= 10);
    assert.ok(styleKeys.includes('cinematic_realism'));
    assert.ok(styleKeys.includes('hand_drawn_cartoon'));
    assert.ok(styleKeys.includes('watercolor_storybook'));
    assert.ok(styleKeys.includes('clay_stop_motion'));
    assert.ok(styleKeys.includes('anime'));

    for (const mode of Object.keys(VIDEO_ENGINE_OPTIONS.modes)) {
      const style = VIDEO_ENGINE_OPTIONS.visual_styles.cinematic_realism.recommended_modes.includes(mode)
        ? 'cinematic_realism'
        : mode === 'stop_motion'
          ? 'paper_cutout'
          : 'hand_drawn_cartoon';
      const blueprint = buildStoryVideoBlueprint(db, {
        workspace_id: 'workspace_video_test',
        mode,
        visual_style: style,
        quality: 'draft',
        aspect_ratio: '16:9'
      });
      assert.equal(blueprint.target_mode, mode);
      assert.equal(blueprint.visual_style, style);
      assert.equal(blueprint.preview_renderer, 'motion_book_html');
      assert.equal(blueprint.cost_plan.estimated_cost_usd, 0);
      assert.equal(blueprint.cost_plan.provider_generation_enabled, false);
      assert.ok(blueprint.shot_count >= 1 && blueprint.shot_count <= 12);
      assert.ok(blueprint.duration_seconds <= 60);
      assert.equal(blueprint.continuity_contract.one_story_brain, true);
      assert.equal(blueprint.continuity_contract.visual_style_is_not_canon, true);
      assert.equal(blueprint.character_bible[0].name, 'Mina');
      assert.ok(blueprint.shots[0].must_preserve.some(item => item.includes('Mina')));
      assert.equal(blueprint.shots[0].visual_style, style);
    }
  } finally {
    db.close();
  }
});

test('legacy anime and cartoon mode names resolve without making anime the architecture', () => {
  const db = fixtureDb();
  try {
    const anime = buildStoryVideoBlueprint(db, { workspace_id: 'workspace_video_test', mode: 'anime_2d' });
    assert.equal(anime.target_mode, 'animation_2d');
    assert.equal(anime.visual_style, 'anime');

    const cartoon = buildStoryVideoBlueprint(db, { workspace_id: 'workspace_video_test', mode: 'cartoon_2d' });
    assert.equal(cartoon.target_mode, 'animation_2d');
    assert.equal(cartoon.visual_style, 'hand_drawn_cartoon');
  } finally {
    db.close();
  }
});

test('video job emits a reusable non-anime artifact and Control Room style evidence', () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_test',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'standard',
      aspect_ratio: '16:9'
    });
    assert.equal(job.status, 'ready_for_validation');
    assert.equal(job.mode, 'cinematic_3d');
    assert.equal(job.visual_style, 'cinematic_realism');
    assert.equal(job.estimated_cost_usd, 0);
    assert.ok(job.artifact_id);

    const artifact = db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
    assert.equal(artifact.kind, 'motion_book_video_preview');
    assert.match(artifact.html, /data-testid="l99-video-artifact"/);
    assert.match(artifact.html, /data-target-mode="cinematic_3d"/);
    assert.match(artifact.html, /data-visual-style="cinematic_realism"/);
    assert.match(artifact.html, /Provider cost: \$0\.00/);

    const events = db.prepare(`SELECT event_type FROM events WHERE workspace_id=? ORDER BY id`).all('workspace_video_test');
    assert.deepEqual(events.map(item => item.event_type), ['video.plan.completed', 'video.artifact.generated']);

    const overview = storyVideoEngineOverview(db);
    assert.equal(overview.status, 'awaiting_validation');
    assert.equal(overview.total_jobs, 1);
    assert.equal(overview.ready_for_validation_count, 1);
    assert.equal(overview.total_estimated_cost_usd, 0);
    assert.equal(overview.style_count, 1);
    assert.ok(overview.available_style_count >= 10);
  } finally {
    db.close();
  }
});
