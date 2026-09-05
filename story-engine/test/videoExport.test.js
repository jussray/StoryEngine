import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob } from '../lib/videoEngine.js';
import { getStoryVideoExportFile, renderStoryVideoExport } from '../lib/videoExport.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id, title, genre, pitch) VALUES (?, ?, ?, ?)`)
    .run('workspace_video_export', 'The Lantern Door', 'fantasy', 'A child finds a door that only appears during storms.');
  db.prepare(`INSERT INTO chapters (workspace_id, chapter_id, title, content, position) VALUES (?, ?, ?, ?, ?)`)
    .run('workspace_video_export', 'chapter_1', 'The Storm', 'Rain hammered the windows. Mina saw a violet door glowing across the street.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id, char_id, name, role, traits, data_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('workspace_video_export', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave', 'curious']), JSON.stringify({ locked_visuals: ['yellow raincoat', 'silver glasses'] }));
  return db;
}

test('validated zero-provider job exports one deterministic 30-second MP4 and reuses its receipt', async () => {
  const db = fixtureDb();
  const outputDir = mkdtempSync(join(tmpdir(), 'l99-video-test-'));
  const previousOutput = process.env.L99_VIDEO_OUTPUT_DIR;
  process.env.L99_VIDEO_OUTPUT_DIR = outputDir;
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_export',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'draft',
      aspect_ratio: '16:9'
    });
    db.prepare(`UPDATE story_video_jobs SET status='validated' WHERE job_id=?`).run(job.job_id);

    const first = await renderStoryVideoExport(db, job.job_id);
    assert.equal(first.status, 'complete');
    assert.equal(first.scene_count, 6);
    assert.equal(first.duration_seconds, 30);
    assert.equal(first.actual_cost_usd, 0);
    assert.equal(first.receipt.provider_generation, false);
    assert.equal(first.receipt.provider_cost_usd, 0);
    assert.equal(first.receipt.motion, 'ken_burns_zoompan');
    assert.equal(first.receipt.captions.embedded, true);
    assert.equal(first.receipt.voiceover.status, 'provider_not_configured');
    assert.equal(first.reused, false);
    assert.ok(first.byte_size > 1000);
    assert.match(first.content_hash, /^[0-9a-f]{64}$/);

    const file = getStoryVideoExportFile(db, first.export_id);
    assert.ok(file);
    const bytes = readFileSync(file.path);
    assert.ok(bytes.subarray(4, 12).toString('ascii').includes('ftyp'));

    const second = await renderStoryVideoExport(db, job.job_id);
    assert.equal(second.export_id, first.export_id);
    assert.equal(second.content_hash, first.content_hash);
    assert.equal(second.reused, true);

    const exportEvents = db.prepare(`SELECT event_type,payload FROM events WHERE workspace_id=? AND event_type='video.export.completed'`).all('workspace_video_export');
    assert.equal(exportEvents.length, 1);
    assert.equal(JSON.parse(exportEvents[0].payload).provider_cost_usd, 0);
  } finally {
    if (previousOutput === undefined) delete process.env.L99_VIDEO_OUTPUT_DIR;
    else process.env.L99_VIDEO_OUTPUT_DIR = previousOutput;
    db.close();
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('export refuses unvalidated or non-zero-provider-cost jobs', async () => {
  const db = fixtureDb();
  try {
    const job = createStoryVideoJob(db, { workspace_id: 'workspace_video_export' });
    await assert.rejects(() => renderStoryVideoExport(db, job.job_id), /must pass Playwright validation/);
    db.prepare(`UPDATE story_video_jobs SET status='validated',estimated_cost_usd=0.25 WHERE job_id=?`).run(job.job_id);
    await assert.rejects(() => renderStoryVideoExport(db, job.job_id), /non-zero provider cost/);
  } finally {
    db.close();
  }
});
