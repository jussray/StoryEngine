// lib/videoComposition.js
// Ordered, verified post-production assembly for Story Video exports.

import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { ensureVideoExportSchema } from './videoExport.js';
import { log } from '../models/eventModel.js';

const COMPOSITION_SCHEMA_VERSION = '1.0.0';
const COMPOSITOR_VERSION = 'ffmpeg_concat_copy_v1';

export const VIDEO_COMPOSITION_PROFILES = Object.freeze({
  clip: Object.freeze({ label: 'Clip', max_sources: 12, max_duration_seconds: 60 }),
  video: Object.freeze({ label: 'Video', max_sources: 240, max_duration_seconds: 3600 }),
  movie: Object.freeze({ label: 'Movie', max_sources: 2000, max_duration_seconds: 21600 })
});

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function text(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function ffmpegBinary() {
  return text(process.env.L99_VIDEO_FFMPEG_BINARY, 'ffmpeg');
}

function ffprobeBinary() {
  return text(process.env.L99_VIDEO_FFPROBE_BINARY, 'ffprobe');
}

function outputDirectory() {
  return resolve(process.env.L99_VIDEO_OUTPUT_DIR || join(process.cwd(), 'var', 'video-exports'));
}

function compositionError(code, message, failures = []) {
  const error = new Error(message);
  error.code = code;
  error.failures = failures;
  return error;
}

function assertMediaToolingAvailable() {
  const ffmpegProbe = spawnSync(ffmpegBinary(), ['-version'], { encoding: 'utf8' });
  const ffprobeProbe = spawnSync(ffprobeBinary(), ['-version'], { encoding: 'utf8' });
  if (ffmpegProbe.error || ffmpegProbe.status !== 0 || ffprobeProbe.error || ffprobeProbe.status !== 0) {
    const error = new Error('ffmpeg and ffprobe are required for Story Video composition.');
    error.code = 'FFMPEG_UNAVAILABLE';
    throw error;
  }
}

async function hashFile(filePath) {
  return await new Promise((resolveHash, rejectHash) => {
    const digest = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(digest.digest('hex')));
  });
}

function streamSummary(receipt) {
  const streams = Array.isArray(receipt?.media_probe?.streams) ? receipt.media_probe.streams : [];
  const video = streams.find(item => item.codec_type === 'video');
  const audio = streams.find(item => item.codec_type === 'audio');
  const subtitle = streams.find(item => item.codec_type === 'subtitle');
  const dimensions = receipt?.media_probe?.dimensions || receipt?.dimensions || {};
  return {
    video_codec: video?.codec_name || null,
    audio_codec: audio?.codec_name || null,
    subtitle_codec: subtitle?.codec_name || null,
    width: Number(dimensions.width || 0),
    height: Number(dimensions.height || 0),
    fps: Number(receipt?.fps || 0),
    has_audio: Boolean(audio),
    has_subtitle: Boolean(subtitle)
  };
}

function probeComposition(filePath, expectedDuration, expectedSignature, sourceCount) {
  const result = spawnSync(ffprobeBinary(), [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe composition verification failed: ${text(result.stderr, result.error?.message || 'unknown ffprobe error')}`);
  }

  let probe;
  try { probe = JSON.parse(result.stdout || '{}'); }
  catch { throw new Error('ffprobe composition verification failed: invalid JSON output.'); }

  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const subtitle = streams.find(stream => stream.codec_type === 'subtitle');
  if (!video) throw new Error('ffprobe composition verification failed: no video stream.');
  if (expectedSignature.has_audio && !audio) throw new Error('ffprobe composition verification failed: source audio stream was lost.');
  if (expectedSignature.has_subtitle && !subtitle) throw new Error('ffprobe composition verification failed: source caption stream was lost.');
  if (expectedSignature.width && Number(video.width) !== expectedSignature.width) {
    throw new Error(`ffprobe composition verification failed: expected width ${expectedSignature.width}, received ${video.width}.`);
  }
  if (expectedSignature.height && Number(video.height) !== expectedSignature.height) {
    throw new Error(`ffprobe composition verification failed: expected height ${expectedSignature.height}, received ${video.height}.`);
  }

  const duration = Number(probe.format?.duration || 0);
  const tolerance = Math.max(0.75, sourceCount * 0.08);
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > tolerance) {
    throw new Error(`ffprobe composition verification failed: expected approximately ${expectedDuration}s, received ${duration || 0}s.`);
  }

  return {
    verifier: 'ffprobe',
    verified: true,
    duration_seconds: duration,
    dimensions: { width: Number(video.width || 0), height: Number(video.height || 0) },
    streams: streams.map(stream => ({
      index: Number(stream.index),
      codec_type: stream.codec_type,
      codec_name: stream.codec_name || null
    }))
  };
}

export function ensureVideoCompositionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_video_compositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composition_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      source_export_ids_json TEXT NOT NULL DEFAULT '[]',
      output_path TEXT,
      content_hash TEXT,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      source_count INTEGER NOT NULL DEFAULT 0,
      actual_cost_usd REAL NOT NULL DEFAULT 0,
      receipt_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_video_compositions_workspace_fingerprint
      ON story_video_compositions(workspace_id,fingerprint);
    CREATE INDEX IF NOT EXISTS idx_story_video_compositions_workspace
      ON story_video_compositions(workspace_id,created_at);
  `);
}

function hydrate(row, reused = false) {
  if (!row) return null;
  return {
    composition_id: row.composition_id,
    workspace_id: row.workspace_id,
    profile: row.profile,
    fingerprint: row.fingerprint,
    status: row.status,
    source_export_ids: safeJson(row.source_export_ids_json, []),
    content_hash: row.content_hash || null,
    byte_size: Number(row.byte_size || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    source_count: Number(row.source_count || 0),
    actual_cost_usd: Number(row.actual_cost_usd || 0),
    receipt: safeJson(row.receipt_json, {}),
    reused,
    download_url: row.status === 'complete'
      ? `/api/video-engine/compositions/${encodeURIComponent(row.composition_id)}/mp4`
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function getStoryVideoComposition(db, compositionId) {
  ensureVideoCompositionSchema(db);
  return hydrate(db.prepare('SELECT * FROM story_video_compositions WHERE composition_id=?').get(compositionId));
}

export function getStoryVideoCompositionFile(db, compositionId) {
  ensureVideoCompositionSchema(db);
  const row = db.prepare('SELECT * FROM story_video_compositions WHERE composition_id=?').get(compositionId);
  if (!row || row.status !== 'complete' || !row.output_path || !existsSync(row.output_path)) return null;
  return { path: row.output_path, filename: basename(row.output_path), composition: hydrate(row) };
}

async function resolveSources(db, workspaceId, exportIds) {
  const verifiedCache = new Map();
  const sources = [];
  for (const [index, exportId] of exportIds.entries()) {
    if (verifiedCache.has(exportId)) {
      sources.push({ ...verifiedCache.get(exportId), order: index + 1 });
      continue;
    }

    const row = db.prepare('SELECT * FROM story_video_exports WHERE export_id=?').get(exportId);
    if (!row) {
      throw compositionError('COMPOSITION_SOURCE_MISSING', `Video export not found: ${exportId}.`, [
        { export_id: exportId, reason: 'source_export_not_found' }
      ]);
    }
    if (row.workspace_id !== workspaceId) {
      throw compositionError('COMPOSITION_WORKSPACE_MISMATCH', 'Composition sources must belong to the requested workspace.', [
        { export_id: exportId, reason: 'workspace_mismatch' }
      ]);
    }
    if (row.status !== 'complete' || !row.output_path || !existsSync(row.output_path)) {
      throw compositionError('COMPOSITION_SOURCE_NOT_READY', `Video export is not ready for composition: ${exportId}.`, [
        { export_id: exportId, reason: 'source_export_not_complete' }
      ]);
    }

    const receipt = safeJson(row.receipt_json, {});
    if (receipt?.media_probe?.verified !== true) {
      throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', `Video export lacks verified media proof: ${exportId}.`, [
        { export_id: exportId, reason: 'media_probe_not_verified' }
      ]);
    }
    const actualHash = await hashFile(row.output_path);
    if (!row.content_hash || actualHash !== row.content_hash) {
      throw compositionError('COMPOSITION_SOURCE_HASH_MISMATCH', `Video export content hash no longer matches its receipt: ${exportId}.`, [
        { export_id: exportId, reason: 'content_hash_mismatch' }
      ]);
    }

    const source = {
      order: index + 1,
      export_id: exportId,
      output_path: row.output_path,
      content_hash: actualHash,
      duration_seconds: Number(receipt?.media_probe?.duration_seconds || row.duration_seconds || 0),
      signature: streamSummary(receipt)
    };
    verifiedCache.set(exportId, { ...source, order: 0 });
    sources.push(source);
  }
  return sources;
}

function assertCompatibleSources(sources) {
  const first = sources[0]?.signature;
  const failures = [];
  if (!first) throw compositionError('COMPOSITION_SOURCE_MISSING', 'Composition requires at least one verified source export.');
  for (const source of sources.slice(1)) {
    if (JSON.stringify(source.signature) !== JSON.stringify(first)) {
      failures.push({
        export_id: source.export_id,
        reason: 'media_signature_mismatch',
        expected: first,
        actual: source.signature
      });
    }
  }
  if (failures.length) {
    throw compositionError(
      'COMPOSITION_INCOMPATIBLE_EXPORTS',
      'Composition sources must share the same verified stream and frame profile for lossless concatenation.',
      failures
    );
  }
  return first;
}

export async function composeStoryVideoExports(db, input = {}) {
  ensureVideoExportSchema(db);
  ensureVideoCompositionSchema(db);

  const workspaceId = text(input.workspace_id);
  if (!workspaceId) throw compositionError('COMPOSITION_WORKSPACE_REQUIRED', 'workspace_id is required.');
  const profileName = text(input.profile, 'video').toLowerCase();
  const profile = VIDEO_COMPOSITION_PROFILES[profileName];
  if (!profile) throw compositionError('COMPOSITION_PROFILE_INVALID', `Unsupported composition profile: ${profileName}.`);
  const exportIds = Array.isArray(input.export_ids) ? input.export_ids.map(item => text(item)).filter(Boolean) : [];
  if (!exportIds.length) throw compositionError('COMPOSITION_SOURCE_REQUIRED', 'export_ids must contain at least one completed video export.');
  if (exportIds.length > profile.max_sources) {
    throw compositionError('COMPOSITION_PROFILE_LIMIT', `${profile.label} supports at most ${profile.max_sources} source clips.`, [
      { reason: 'source_count_limit', actual: exportIds.length, maximum: profile.max_sources }
    ]);
  }

  assertMediaToolingAvailable();
  const sources = await resolveSources(db, workspaceId, exportIds);
  const signature = assertCompatibleSources(sources);
  const expectedDuration = sources.reduce((sum, source) => sum + source.duration_seconds, 0);
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
    throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', 'Composition source durations are not verified.');
  }
  if (expectedDuration > profile.max_duration_seconds + 0.25) {
    throw compositionError('COMPOSITION_PROFILE_LIMIT', `${profile.label} supports at most ${profile.max_duration_seconds} seconds.`, [
      { reason: 'duration_limit', actual_seconds: expectedDuration, maximum_seconds: profile.max_duration_seconds }
    ]);
  }

  const fingerprint = hash({
    schema_version: COMPOSITION_SCHEMA_VERSION,
    compositor: COMPOSITOR_VERSION,
    workspace_id: workspaceId,
    profile: profileName,
    sources: sources.map(source => ({ export_id: source.export_id, content_hash: source.content_hash })),
    media_signature: signature
  });
  const existing = db.prepare('SELECT * FROM story_video_compositions WHERE workspace_id=? AND fingerprint=?')
    .get(workspaceId, fingerprint);
  if (existing?.status === 'complete' && existing.output_path && existsSync(existing.output_path)) {
    const existingHash = await hashFile(existing.output_path);
    if (existingHash === existing.content_hash) return hydrate(existing, true);
  }

  const compositionId = existing?.composition_id || `video_composition_${randomUUID()}`;
  const now = Date.now();
  if (existing) {
    db.prepare(`UPDATE story_video_compositions SET status='composing',output_path=NULL,content_hash=NULL,byte_size=0,receipt_json='{}',updated_at=? WHERE composition_id=?`)
      .run(now, compositionId);
  } else {
    db.prepare(`INSERT INTO story_video_compositions (composition_id,workspace_id,profile,fingerprint,status,source_export_ids_json,output_path,content_hash,byte_size,duration_seconds,source_count,actual_cost_usd,receipt_json,created_at,updated_at) VALUES (?,?,?,?,'composing',?,NULL,NULL,0,?,?,0,'{}',?,?)`)
      .run(compositionId, workspaceId, profileName, fingerprint, JSON.stringify(exportIds), expectedDuration, exportIds.length, now, now);
  }

  const temp = mkdtempSync(join(tmpdir(), 'l99-video-composition-'));
  const finalDir = outputDirectory();
  mkdirSync(finalDir, { recursive: true });
  const finalPath = join(finalDir, `${compositionId}.mp4`);

  try {
    const concatPath = join(temp, 'timeline.txt');
    const lines = sources.map(source => `file '${source.output_path.replaceAll("'", "'\\''")}'`);
    writeFileSync(concatPath, `${lines.join('\n')}\n`, 'utf8');
    const tempOutput = join(temp, 'composition.mp4');
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-map', '0:s:0?',
      '-c', 'copy', '-movflags', '+faststart', '-avoid_negative_ts', 'make_zero',
      tempOutput
    ];
    const rendered = await new Promise((resolveRender, rejectRender) => {
      const child = spawn(ffmpegBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => {
        if (stderr.length < 4 * 1024 * 1024) stderr += chunk.toString();
      });
      child.on('error', rejectRender);
      child.on('close', code => resolveRender({ code, stderr }));
    });
    if (rendered.code !== 0 || !existsSync(tempOutput)) {
      throw new Error(`ffmpeg composition failed: ${text(rendered.stderr, 'unknown ffmpeg error')}`);
    }

    const mediaProbe = probeComposition(tempOutput, expectedDuration, signature, sources.length);
    renameSync(tempOutput, finalPath);
    const bytes = readFileSync(finalPath);
    const receipt = {
      schema_version: COMPOSITION_SCHEMA_VERSION,
      composition_id: compositionId,
      compositor: COMPOSITOR_VERSION,
      profile: profileName,
      source_count: sources.length,
      sources: sources.map(source => ({
        order: source.order,
        export_id: source.export_id,
        content_hash: source.content_hash,
        duration_seconds: source.duration_seconds
      })),
      expected_duration_seconds: expectedDuration,
      duration_seconds: mediaProbe.duration_seconds,
      media_probe: mediaProbe,
      provider_generation: false,
      provider_cost_usd: 0,
      post_production_only: true,
      reencoded: false,
      captions_preserved: signature.has_subtitle,
      ordered_timeline: true,
      retry_policy: 'idempotent_by_ordered_verified_source_hashes_and_profile',
      content_hash: hash(bytes),
      byte_size: bytes.length,
      generated_at: Date.now()
    };

    db.prepare(`UPDATE story_video_compositions SET status='complete',output_path=?,content_hash=?,byte_size=?,duration_seconds=?,actual_cost_usd=0,receipt_json=?,updated_at=? WHERE composition_id=?`)
      .run(finalPath, receipt.content_hash, receipt.byte_size, receipt.duration_seconds, JSON.stringify(receipt), Date.now(), compositionId);
    log(db, {
      workspace_id: workspaceId,
      mode: 'video_engine',
      event_type: 'video.composition.completed',
      payload: {
        composition_id: compositionId,
        profile: profileName,
        source_count: sources.length,
        duration_seconds: receipt.duration_seconds,
        content_hash: receipt.content_hash,
        provider_cost_usd: 0,
        media_verified: true
      }
    });
    return getStoryVideoComposition(db, compositionId);
  } catch (error) {
    const failure = {
      schema_version: COMPOSITION_SCHEMA_VERSION,
      composition_id: compositionId,
      compositor: COMPOSITOR_VERSION,
      profile: profileName,
      source_count: sources.length,
      error: text(error.message, 'video composition failed'),
      code: error.code || 'COMPOSITION_FAILED',
      failures: Array.isArray(error.failures) ? error.failures : [],
      provider_cost_usd: 0,
      failed_at: Date.now()
    };
    db.prepare(`UPDATE story_video_compositions SET status='failed',receipt_json=?,updated_at=? WHERE composition_id=?`)
      .run(JSON.stringify(failure), Date.now(), compositionId);
    log(db, {
      workspace_id: workspaceId,
      mode: 'video_engine',
      event_type: 'video.composition.failed',
      payload: {
        composition_id: compositionId,
        profile: profileName,
        source_count: sources.length,
        code: failure.code,
        error: failure.error,
        provider_cost_usd: 0
      }
    });
    throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
