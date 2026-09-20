import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob } from '../lib/videoEngine.js';
import { renderStoryVideoExport } from '../lib/videoExport.js';
import {
  VIDEO_COMPOSITION_PROFILES,
  composeStoryVideoExports,
  getStoryVideoCompositionFile
} from '../lib/videoComposition.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id,title,genre,pitch) VALUES (?,?,?,?)`)
    .run('workspace_video_composition', 'The Lantern Door', 'fantasy', 'A child finds a door during a storm.');
  db.prepare(`INSERT INTO chapters (workspace_id,chapter_id,title,content,position) VALUES (?,?,?,?,?)`)
    .run('workspace_video_composition', 'chapter_1', 'The Storm', 'Mina sees a violet door glowing across the street.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id,char_id,name,role,traits,data_json) VALUES (?,?,?,?,?,?)`)
    .run('workspace_video_composition', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave']), JSON.stringify({ locked_visuals: ['yellow raincoat'] }));
  return db;
}

test('eleven verified clips compose into a >60 second video and movie timeline without re-rendering sources', async () => {
  const db = fixtureDb();
  const outputDir = mkdtempSync(join(tmpdir(), 'l99-video-composition-test-'));
  const previousOutput = process.env.L99_VIDEO_OUTPUT_DIR;
  process.env.L99_VIDEO_OUTPUT_DIR = outputDir;
  try {
    const job = createStoryVideoJob(db, {
      workspace_id: 'workspace_video_composition',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'draft',
      aspect_ratio: '16:9',
      action_beats: ['Mina approaches the violet door in the storm.']
    });
    db.prepare(`UPDATE story_video_jobs SET status='validated' WHERE job_id=?`).run(job.job_id);
    const clip = await renderStoryVideoExport(db, job.job_id, {
      scene_count: 1,
      duration_seconds: 6,
      fps: 24,
      width: 320,
      height: 180
    });
    assert.equal(clip.status, 'complete');

    const eleven = Array.from({ length: 11 }, () => clip.export_id);
    const video = await composeStoryVideoExports(db, {
      workspace_id: 'workspace_video_composition',
      profile: 'video',
      export_ids: eleven
    });
    assert.equal(video.status, 'complete');
    assert.equal(video.profile, 'video');
    assert.equal(video.source_count, 11);
    assert.ok(video.duration_seconds > 60);
    assert.ok(Math.abs(video.duration_seconds - 66) < 1.5);
    assert.equal(video.actual_cost_usd, 0);
    assert.equal(video.receipt.source_count, 11);
    assert.equal(video.receipt.media_probe.verified, true);
    assert.equal(video.receipt.reencoded, false);
    assert.equal(video.receipt.ordered_timeline, true);
    assert.equal(video.receipt.provider_cost_usd, 0);
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'video'));
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'subtitle'));

    const file = getStoryVideoCompositionFile(db, video.composition_id);
    assert.ok(file);
    const bytes = readFileSync(file.path);
    assert.ok(bytes.subarray(4, 12).toString('ascii').includes('ftyp'));

    const duplicate = await composeStoryVideoExports(db, {
      workspace_id: 'workspace_video_composition',
      profile: 'video',
      export_ids: eleven
    });
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.composition_id, video.composition_id);
    assert.equal(duplicate.content_hash, video.content_hash);

    await assert.rejects(
      () => composeStoryVideoExports(db, {
        workspace_id: 'workspace_video_composition',
        profile: 'clip',
        export_ids: eleven
      }),
      error => error?.code === 'COMPOSITION_PROFILE_LIMIT'
    );

    const movie = await composeStoryVideoExports(db, {
      workspace_id: 'workspace_video_composition',
      profile: 'movie',
      export_ids: eleven
    });
    assert.equal(movie.status, 'complete');
    assert.equal(movie.profile, 'movie');
    assert.equal(movie.source_count, 11);
    assert.ok(movie.duration_seconds > 60);

    assert.equal(VIDEO_COMPOSITION_PROFILES.clip.max_duration_seconds, 60);
    assert.equal(VIDEO_COMPOSITION_PROFILES.video.max_duration_seconds, 3600);
    assert.equal(VIDEO_COMPOSITION_PROFILES.movie.max_duration_seconds, 21600);
  } finally {
    if (previousOutput === undefined) delete process.env.L99_VIDEO_OUTPUT_DIR;
    else process.env.L99_VIDEO_OUTPUT_DIR = previousOutput;
    db.close();
    rmSync(outputDir, { recursive: true, force: true });
  }
});
