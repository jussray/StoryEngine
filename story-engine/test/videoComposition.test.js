import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob } from '../lib/videoEngine.js';
import { getStoryVideoExportFile, renderStoryVideoExport } from '../lib/videoExport.js';
import { ensureOpenVideoRendererSchema } from '../lib/openVideoRenderer.js';
import { createContinuityCookie, createProofCookie } from '../lib/videoContinuity.js';
import {
  VIDEO_COMPOSITION_PROFILES,
  composeStoryVideoExports,
  composeStoryVideoSources,
  getStoryVideoCompositionFile
} from '../lib/videoComposition.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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

async function renderedFixture(db) {
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
  return { job, clip };
}

test('eleven verified clips compose into a >60 second video and movie timeline without re-rendering sources', async () => {
  const db = fixtureDb();
  const outputDir = mkdtempSync(join(tmpdir(), 'l99-video-composition-test-'));
  const previousOutput = process.env.L99_VIDEO_OUTPUT_DIR;
  process.env.L99_VIDEO_OUTPUT_DIR = outputDir;
  try {
    const { clip } = await renderedFixture(db);
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
    assert.equal(video.receipt.sources.every(source => source.integrity_format === 'legacy_buffer_json_sha256'), true);
    assert.equal(video.receipt.sources.every(source => source.content_hash !== source.source_receipt_hash), true);
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'video'));
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(video.receipt.media_probe.streams.some(stream => stream.codec_type === 'subtitle'));

    const file = getStoryVideoCompositionFile(db, video.composition_id);
    assert.ok(file);
    const bytes = readFileSync(file.path);
    assert.ok(bytes.subarray(4, 12).toString('ascii').includes('ftyp'));
    assert.equal(video.content_hash, sha256Bytes(bytes));

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

test('current verified self-hosted picture locks can form long timelines without becoming falsely release-ready', async () => {
  const db = fixtureDb();
  const outputDir = mkdtempSync(join(tmpdir(), 'l99-video-open-composition-test-'));
  const previousOutput = process.env.L99_VIDEO_OUTPUT_DIR;
  process.env.L99_VIDEO_OUTPUT_DIR = outputDir;
  try {
    const { job, clip } = await renderedFixture(db);
    const file = getStoryVideoExportFile(db, clip.export_id);
    assert.ok(file);
    ensureOpenVideoRendererSchema(db);

    const rawBytes = readFileSync(file.path);
    const rawHash = sha256Bytes(rawBytes);
    const continuity = createContinuityCookie(job);
    const renderId = 'open_master_composition_fixture';
    const proof = createProofCookie(job, {
      evidence_class: 'assembled_open_weight_picture_lock',
      output_sha256: rawHash,
      renderer: 'test-open-weight+ffmpeg',
      media_probe: clip.receipt.media_probe
    });
    const now = Date.now();
    const receipt = {
      schema_version: '2.0.0',
      render_id: renderId,
      job_id: job.job_id,
      workspace_id: job.workspace_id,
      shot_id: '__master__',
      kind: 'picture_lock',
      renderer: 'test-open-weight+ffmpeg',
      continuity_cookie: continuity.value,
      proof_cookie: proof.value,
      output_sha256: rawHash,
      media_probe: clip.receipt.media_probe,
      picture_lock: true,
      release_ready: false,
      audio: { status: 'silent_picture_lock', required_before_release: true },
      captions: { status: 'pending_final_audio', required_before_release: true },
      authority_granted: false
    };
    db.prepare(`INSERT INTO story_video_open_renders (
      render_id,job_id,workspace_id,shot_id,continuity_cookie,proof_cookie,status,renderer,prompt_id,workflow_sha256,model_id,reference_sha256,
      output_path,output_sha256,technical_status,continuity_status,editorial_status,review_notes,receipt_json,failure_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,'complete',?,NULL,NULL,NULL,NULL,?,?, 'passed','approved','pending',NULL,?,'{}',?,?)`).run(
      renderId, job.job_id, job.workspace_id, '__master__', continuity.value, proof.value,
      'test-open-weight+ffmpeg', file.path, rawHash, JSON.stringify(receipt), now, now
    );

    const sources = Array.from({ length: 11 }, () => ({ type: 'open_render', id: renderId }));
    const video = await composeStoryVideoSources(db, {
      workspace_id: job.workspace_id,
      profile: 'video',
      sources
    });
    assert.equal(video.status, 'complete');
    assert.equal(video.source_count, 11);
    assert.ok(video.duration_seconds > 60);
    assert.equal(video.receipt.media_probe.verified, true);
    assert.equal(video.receipt.sources.every(source => source.proof_cookie === proof.value), true);
    assert.equal(video.receipt.sources.every(source => source.continuity_cookie === continuity.value), true);
    assert.equal(video.receipt.sources.every(source => source.integrity_format === 'raw_sha256'), true);
    assert.equal(video.receipt.picture_lock_only, true);
    assert.equal(video.receipt.release_ready, false);
    assert.equal(video.receipt.authority_granted, false);

    const row = db.prepare('SELECT blueprint_json FROM story_video_jobs WHERE job_id=?').get(job.job_id);
    const driftedBlueprint = JSON.parse(row.blueprint_json);
    driftedBlueprint.shots[0].provider_prompt = `${driftedBlueprint.shots[0].provider_prompt}\nCANON DRIFT: changed after proof.`;
    db.prepare('UPDATE story_video_jobs SET blueprint_json=?,updated_at=? WHERE job_id=?')
      .run(JSON.stringify(driftedBlueprint), Date.now(), job.job_id);

    await assert.rejects(
      () => composeStoryVideoSources(db, {
        workspace_id: job.workspace_id,
        profile: 'video',
        sources: [{ type: 'open_render', id: renderId }]
      }),
      error => error?.code === 'COMPOSITION_SOURCE_STALE'
    );
  } finally {
    if (previousOutput === undefined) delete process.env.L99_VIDEO_OUTPUT_DIR;
    else process.env.L99_VIDEO_OUTPUT_DIR = previousOutput;
    db.close();
    rmSync(outputDir, { recursive: true, force: true });
  }
});
