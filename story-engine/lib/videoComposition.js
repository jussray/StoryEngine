// lib/videoComposition.js
// Ordered, verified long-form assembly across deterministic exports and real LEEVIZE footage.

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { ensureVideoExportSchema } from './videoExport.js';
import { createContinuityCookie } from './videoContinuity.js';
import { log } from '../models/eventModel.js';

const COMPOSITION_SCHEMA_VERSION = '2.0.0';
const COMPOSITOR_VERSION = 'ffmpeg_concat_copy_v2';

export const VIDEO_COMPOSITION_PROFILES = Object.freeze({
  clip: Object.freeze({ label: 'Clip', max_sources: 12, max_duration_seconds: 60 }),
  video: Object.freeze({ label: 'Video', max_sources: 240, max_duration_seconds: 3600 }),
  movie: Object.freeze({ label: 'Movie', max_sources: 2000, max_duration_seconds: 21600 })
});

function safeJson(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function text(value, fallback = '') { return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback; }
function hash(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function ffmpegBinary() { return text(process.env.L99_VIDEO_FFMPEG_BINARY, 'ffmpeg'); }
function ffprobeBinary() { return text(process.env.L99_VIDEO_FFPROBE_BINARY, 'ffprobe'); }
function outputDirectory() { return resolve(process.env.L99_VIDEO_OUTPUT_DIR || join(process.cwd(), 'var', 'video-exports')); }
function tableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function columnExists(db, table, column) { return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column); }

function compositionError(code, message, failures = []) {
  const error = new Error(message);
  error.code = code;
  error.failures = failures;
  return error;
}

function assertMediaToolingAvailable() {
  const ffmpeg = spawnSync(ffmpegBinary(), ['-version'], { encoding: 'utf8' });
  const ffprobe = spawnSync(ffprobeBinary(), ['-version'], { encoding: 'utf8' });
  if (ffmpeg.error || ffmpeg.status !== 0 || ffprobe.error || ffprobe.status !== 0) {
    throw compositionError('FFMPEG_UNAVAILABLE', 'ffmpeg and ffprobe are required for Story Video composition.');
  }
}

async function hashFile(filePath) {
  return await new Promise((resolveHash, rejectHash) => {
    const digest = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', () => rejectHash(compositionError('COMPOSITION_FILE_READ_FAILED', 'Video composition media could not be read for integrity verification.')));
    stream.on('end', () => resolveHash(digest.digest('hex')));
  });
}

function probeMedia(filePath) {
  const result = spawnSync(ffprobeBinary(), [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels',
    '-of', 'json', filePath
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw compositionError('COMPOSITION_FFPROBE_FAILED', 'Video composition source failed media verification.', [
      { reason: 'ffprobe_nonzero_exit', exit_code: Number.isInteger(result.status) ? result.status : null }
    ]);
  }
  let probe;
  try { probe = JSON.parse(result.stdout || '{}'); }
  catch { throw compositionError('COMPOSITION_FFPROBE_FAILED', 'Video composition verifier returned an invalid result.', [{ reason: 'ffprobe_invalid_json' }]); }
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  if (!video) throw compositionError('COMPOSITION_MEDIA_INVALID', 'Video composition source has no playable video stream.', [{ reason: 'missing_video_stream' }]);
  const duration = Number(probe.format?.duration || 0);
  if (!(duration > 0)) throw compositionError('COMPOSITION_MEDIA_INVALID', 'Video composition source has no verified duration.', [{ reason: 'invalid_duration' }]);
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const subtitle = streams.find(stream => stream.codec_type === 'subtitle');
  return {
    verifier: 'ffprobe', verified: true, duration_seconds: duration,
    dimensions: { width: Number(video.width || 0), height: Number(video.height || 0) },
    streams: streams.map(stream => ({
      index: Number(stream.index), codec_type: stream.codec_type, codec_name: stream.codec_name || null,
      width: Number(stream.width || 0), height: Number(stream.height || 0), pix_fmt: stream.pix_fmt || null,
      r_frame_rate: stream.r_frame_rate || null, sample_rate: stream.sample_rate || null, channels: Number(stream.channels || 0)
    })),
    signature: {
      video_codec: video.codec_name || null,
      width: Number(video.width || 0), height: Number(video.height || 0), pix_fmt: video.pix_fmt || null,
      frame_rate: video.r_frame_rate || null,
      has_audio: Boolean(audio), audio_codec: audio?.codec_name || null, sample_rate: audio?.sample_rate || null, channels: Number(audio?.channels || 0),
      has_subtitle: Boolean(subtitle), subtitle_codec: subtitle?.codec_name || null
    }
  };
}

function verifyComposedMedia(filePath, expectedDuration, expectedSignature, sourceCount) {
  const probe = probeMedia(filePath);
  const failures = [];
  for (const key of ['video_codec', 'width', 'height', 'pix_fmt', 'frame_rate', 'has_audio', 'audio_codec', 'sample_rate', 'channels', 'has_subtitle', 'subtitle_codec']) {
    if (probe.signature[key] !== expectedSignature[key]) failures.push({ reason: 'output_signature_mismatch', field: key, expected: expectedSignature[key], actual: probe.signature[key] });
  }
  const tolerance = Math.max(0.75, sourceCount * 0.08);
  if (Math.abs(probe.duration_seconds - expectedDuration) > tolerance) failures.push({ reason: 'duration_mismatch', expected_seconds: expectedDuration, actual_seconds: probe.duration_seconds, tolerance_seconds: tolerance });
  if (failures.length) throw compositionError('COMPOSITION_MEDIA_INVALID', 'Video composition failed final media verification.', failures);
  return probe;
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
      sources_json TEXT NOT NULL DEFAULT '[]',
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_video_compositions_workspace_fingerprint ON story_video_compositions(workspace_id,fingerprint);
    CREATE INDEX IF NOT EXISTS idx_story_video_compositions_workspace ON story_video_compositions(workspace_id,created_at);
  `);
  if (!columnExists(db, 'story_video_compositions', 'sources_json')) db.exec("ALTER TABLE story_video_compositions ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'");
}

function hydrate(row, reused = false) {
  if (!row) return null;
  return {
    composition_id: row.composition_id,
    workspace_id: row.workspace_id,
    profile: row.profile,
    fingerprint: row.fingerprint,
    status: row.status,
    sources: safeJson(row.sources_json, []),
    source_export_ids: safeJson(row.source_export_ids_json, []),
    content_hash: row.content_hash || null,
    byte_size: Number(row.byte_size || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    source_count: Number(row.source_count || 0),
    actual_cost_usd: Number(row.actual_cost_usd || 0),
    receipt: safeJson(row.receipt_json, {}),
    reused,
    download_url: row.status === 'complete' ? `/api/video-engine/compositions/${encodeURIComponent(row.composition_id)}/mp4` : null,
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

function normalizeSourceRefs(input = {}) {
  if (Array.isArray(input.sources) && input.sources.length) {
    return input.sources.map(item => ({ type: text(item?.type).toLowerCase(), id: text(item?.id || item?.export_id || item?.render_id) }));
  }
  const refs = [];
  for (const id of Array.isArray(input.export_ids) ? input.export_ids : []) refs.push({ type: 'export', id: text(id) });
  for (const id of Array.isArray(input.open_render_ids) ? input.open_render_ids : []) refs.push({ type: 'open_render', id: text(id) });
  return refs.filter(item => item.id);
}

async function resolveExportSource(db, workspaceId, ref) {
  const row = db.prepare('SELECT * FROM story_video_exports WHERE export_id=?').get(ref.id);
  if (!row) throw compositionError('COMPOSITION_SOURCE_MISSING', 'A requested deterministic video export was not found.', [{ source_type: ref.type, source_id: ref.id, reason: 'source_not_found' }]);
  if (row.workspace_id !== workspaceId) throw compositionError('COMPOSITION_WORKSPACE_MISMATCH', 'Composition sources must belong to the requested workspace.', [{ source_type: ref.type, source_id: ref.id, reason: 'workspace_mismatch' }]);
  if (row.status !== 'complete' || !row.output_path || !existsSync(row.output_path)) throw compositionError('COMPOSITION_SOURCE_NOT_READY', 'A requested deterministic video export is not ready.', [{ source_type: ref.type, source_id: ref.id, reason: 'source_not_complete' }]);
  const receipt = safeJson(row.receipt_json, {});
  if (receipt?.media_probe?.verified !== true) throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', 'A requested deterministic video export lacks verified media proof.', [{ source_type: ref.type, source_id: ref.id, reason: 'media_probe_not_verified' }]);
  const actualHash = await hashFile(row.output_path);
  if (!row.content_hash || actualHash !== row.content_hash) throw compositionError('COMPOSITION_SOURCE_HASH_MISMATCH', 'A requested deterministic video export no longer matches its integrity receipt.', [{ source_type: ref.type, source_id: ref.id, reason: 'content_hash_mismatch' }]);
  const liveProbe = probeMedia(row.output_path);
  return {
    type: 'export', id: ref.id, output_path: row.output_path, content_hash: actualHash,
    duration_seconds: liveProbe.duration_seconds, signature: liveProbe.signature,
    proof_cookie: null, continuity_cookie: null,
    release_ready: receipt.release_ready === true || receipt.satisfies_final_delivery === true,
    picture_lock: false
  };
}

async function resolveOpenRenderSource(db, workspaceId, ref) {
  if (!tableExists(db, 'story_video_open_renders')) throw compositionError('COMPOSITION_SOURCE_MISSING', 'Open-render evidence is not available.', [{ source_type: ref.type, source_id: ref.id, reason: 'open_render_table_missing' }]);
  const row = db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(ref.id);
  if (!row) throw compositionError('COMPOSITION_SOURCE_MISSING', 'A requested open-render source was not found.', [{ source_type: ref.type, source_id: ref.id, reason: 'source_not_found' }]);
  if (row.workspace_id !== workspaceId) throw compositionError('COMPOSITION_WORKSPACE_MISMATCH', 'Composition sources must belong to the requested workspace.', [{ source_type: ref.type, source_id: ref.id, reason: 'workspace_mismatch' }]);
  if (row.status !== 'complete' || row.technical_status !== 'passed' || !row.output_path || !existsSync(row.output_path)) throw compositionError('COMPOSITION_SOURCE_NOT_READY', 'A requested open-render source is not technically verified.', [{ source_type: ref.type, source_id: ref.id, reason: 'source_not_complete' }]);
  const receipt = safeJson(row.receipt_json, {});
  if (receipt?.media_probe?.verified !== true || !row.proof_cookie) throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', 'A requested open-render source lacks verified media proof.', [{ source_type: ref.type, source_id: ref.id, reason: 'proof_missing' }]);
  const jobRow = db.prepare('SELECT * FROM story_video_jobs WHERE job_id=?').get(row.job_id);
  if (!jobRow) throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', 'The source video job no longer exists.', [{ source_type: ref.type, source_id: ref.id, reason: 'job_missing' }]);
  const job = { ...jobRow, blueprint: safeJson(jobRow.blueprint_json, {}) };
  const currentCookie = createContinuityCookie(job).value;
  if (row.continuity_cookie !== currentCookie || receipt.continuity_cookie !== currentCookie) throw compositionError('COMPOSITION_SOURCE_STALE', 'A requested open-render source belongs to stale canon or shot-plan state.', [{ source_type: ref.type, source_id: ref.id, reason: 'continuity_cookie_stale' }]);
  const isMaster = row.shot_id === '__master__' || receipt.kind === 'picture_lock';
  if (row.continuity_status !== 'approved' || (!isMaster && row.editorial_status !== 'approved')) throw compositionError('COMPOSITION_SOURCE_NOT_APPROVED', 'A requested open-render source has not passed the required film review.', [{ source_type: ref.type, source_id: ref.id, reason: 'film_review_incomplete' }]);
  const actualHash = await hashFile(row.output_path);
  if (!row.output_sha256 || actualHash !== row.output_sha256 || (receipt.output_sha256 && receipt.output_sha256 !== actualHash)) throw compositionError('COMPOSITION_SOURCE_HASH_MISMATCH', 'A requested open-render source no longer matches its proof receipt.', [{ source_type: ref.type, source_id: ref.id, reason: 'content_hash_mismatch' }]);
  const liveProbe = probeMedia(row.output_path);
  return {
    type: 'open_render', id: ref.id, output_path: row.output_path, content_hash: actualHash,
    duration_seconds: liveProbe.duration_seconds, signature: liveProbe.signature,
    proof_cookie: row.proof_cookie, continuity_cookie: row.continuity_cookie,
    release_ready: receipt.release_ready === true,
    picture_lock: isMaster && receipt.picture_lock === true
  };
}

async function resolveSources(db, workspaceId, refs) {
  const cache = new Map();
  const resolved = [];
  for (const [index, ref] of refs.entries()) {
    if (!['export', 'open_render'].includes(ref.type) || !ref.id) throw compositionError('COMPOSITION_SOURCE_INVALID', 'Every composition source must have type export or open_render and an id.', [{ source_index: index, reason: 'invalid_source_ref' }]);
    const key = `${ref.type}:${ref.id}`;
    let source = cache.get(key);
    if (!source) {
      source = ref.type === 'export' ? await resolveExportSource(db, workspaceId, ref) : await resolveOpenRenderSource(db, workspaceId, ref);
      cache.set(key, source);
    }
    resolved.push({ ...source, order: index + 1 });
  }
  return resolved;
}

function assertCompatibleSources(sources) {
  const expected = sources[0]?.signature;
  if (!expected) throw compositionError('COMPOSITION_SOURCE_MISSING', 'Composition requires at least one verified source.');
  const failures = [];
  for (const source of sources.slice(1)) {
    if (JSON.stringify(source.signature) !== JSON.stringify(expected)) failures.push({ source_type: source.type, source_id: source.id, reason: 'media_signature_mismatch', expected, actual: source.signature });
  }
  if (failures.length) throw compositionError('COMPOSITION_INCOMPATIBLE_EXPORTS', 'Composition sources must share the same verified stream and frame profile for lossless concatenation.', failures);
  return expected;
}

export async function composeStoryVideoSources(db, input = {}) {
  ensureVideoExportSchema(db);
  ensureVideoCompositionSchema(db);
  const workspaceId = text(input.workspace_id);
  if (!workspaceId) throw compositionError('COMPOSITION_WORKSPACE_REQUIRED', 'workspace_id is required.');
  const profileName = text(input.profile, 'video').toLowerCase();
  const profile = VIDEO_COMPOSITION_PROFILES[profileName];
  if (!profile) throw compositionError('COMPOSITION_PROFILE_INVALID', `Unsupported composition profile: ${profileName}.`);
  const refs = normalizeSourceRefs(input);
  if (!refs.length) throw compositionError('COMPOSITION_SOURCE_REQUIRED', 'sources must contain at least one completed verified video source.');
  if (refs.length > profile.max_sources) throw compositionError('COMPOSITION_PROFILE_LIMIT', `${profile.label} supports at most ${profile.max_sources} source clips.`, [{ reason: 'source_count_limit', actual: refs.length, maximum: profile.max_sources }]);

  assertMediaToolingAvailable();
  const sources = await resolveSources(db, workspaceId, refs);
  const signature = assertCompatibleSources(sources);
  const expectedDuration = sources.reduce((sum, source) => sum + source.duration_seconds, 0);
  if (!(expectedDuration > 0)) throw compositionError('COMPOSITION_SOURCE_UNVERIFIED', 'Composition source durations are not verified.');
  if (expectedDuration > profile.max_duration_seconds + 0.25) throw compositionError('COMPOSITION_PROFILE_LIMIT', `${profile.label} supports at most ${profile.max_duration_seconds} seconds.`, [{ reason: 'duration_limit', actual_seconds: expectedDuration, maximum_seconds: profile.max_duration_seconds }]);

  const canonicalRefs = sources.map(source => ({ type: source.type, id: source.id, content_hash: source.content_hash, continuity_cookie: source.continuity_cookie || null, proof_cookie: source.proof_cookie || null }));
  const fingerprint = hash({ schema_version: COMPOSITION_SCHEMA_VERSION, compositor: COMPOSITOR_VERSION, workspace_id: workspaceId, profile: profileName, sources: canonicalRefs, media_signature: signature });
  const existing = db.prepare('SELECT * FROM story_video_compositions WHERE workspace_id=? AND fingerprint=?').get(workspaceId, fingerprint);
  if (existing?.status === 'complete' && existing.output_path && existsSync(existing.output_path) && await hashFile(existing.output_path) === existing.content_hash) return hydrate(existing, true);

  const compositionId = existing?.composition_id || `video_composition_${randomUUID()}`;
  const now = Date.now();
  const exportIds = sources.filter(source => source.type === 'export').map(source => source.id);
  if (existing) {
    db.prepare(`UPDATE story_video_compositions SET status='composing',sources_json=?,source_export_ids_json=?,output_path=NULL,content_hash=NULL,byte_size=0,receipt_json='{}',updated_at=? WHERE composition_id=?`).run(JSON.stringify(refs), JSON.stringify(exportIds), now, compositionId);
  } else {
    db.prepare(`INSERT INTO story_video_compositions (composition_id,workspace_id,profile,fingerprint,status,source_export_ids_json,sources_json,output_path,content_hash,byte_size,duration_seconds,source_count,actual_cost_usd,receipt_json,created_at,updated_at) VALUES (?,?,?,?,'composing',?,?,NULL,NULL,0,?,?,0,'{}',?,?)`).run(compositionId, workspaceId, profileName, fingerprint, JSON.stringify(exportIds), JSON.stringify(refs), expectedDuration, sources.length, now, now);
  }

  const temp = mkdtempSync(join(tmpdir(), 'l99-video-composition-'));
  const finalDir = outputDirectory();
  mkdirSync(finalDir, { recursive: true });
  const finalPath = join(finalDir, `${compositionId}.mp4`);
  try {
    const listPath = join(temp, 'timeline.txt');
    writeFileSync(listPath, `${sources.map(source => `file '${source.output_path.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
    const tempOutput = join(temp, 'composition.mp4');
    const rendered = await new Promise((resolveRender, rejectRender) => {
      const child = spawn(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-map', '0:v:0', '-map', '0:a:0?', '-map', '0:s:0?', '-c', 'copy', '-movflags', '+faststart', '-avoid_negative_ts', 'make_zero', tempOutput], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', () => {});
      child.on('error', () => rejectRender(compositionError('COMPOSITION_FFMPEG_FAILED', 'Video composition failed during ffmpeg assembly.', [{ reason: 'ffmpeg_spawn_error' }])));
      child.on('close', code => resolveRender({ code }));
    });
    if (rendered.code !== 0 || !existsSync(tempOutput)) throw compositionError('COMPOSITION_FFMPEG_FAILED', 'Video composition failed during ffmpeg assembly.', [{ reason: 'ffmpeg_nonzero_exit', exit_code: rendered.code }]);

    const mediaProbe = verifyComposedMedia(tempOutput, expectedDuration, signature, sources.length);
    renameSync(tempOutput, finalPath);
    const contentHash = await hashFile(finalPath);
    const byteSize = statSync(finalPath).size;
    const releaseReady = sources.every(source => source.release_ready === true);
    const receipt = {
      schema_version: COMPOSITION_SCHEMA_VERSION,
      composition_id: compositionId,
      compositor: COMPOSITOR_VERSION,
      profile: profileName,
      source_count: sources.length,
      sources: sources.map(source => ({ order: source.order, type: source.type, id: source.id, content_hash: source.content_hash, duration_seconds: source.duration_seconds, continuity_cookie: source.continuity_cookie || null, proof_cookie: source.proof_cookie || null, release_ready: source.release_ready, picture_lock: source.picture_lock })),
      expected_duration_seconds: expectedDuration,
      duration_seconds: mediaProbe.duration_seconds,
      media_probe: mediaProbe,
      provider_generation: false,
      provider_cost_usd: 0,
      post_production_only: true,
      reencoded: false,
      ordered_timeline: true,
      release_ready: releaseReady,
      picture_lock_only: sources.some(source => source.picture_lock && !source.release_ready),
      authority_granted: false,
      retry_policy: 'idempotent_by_ordered_verified_source_hashes_proof_cookies_and_profile',
      content_hash: contentHash,
      byte_size: byteSize,
      generated_at: Date.now()
    };
    db.prepare(`UPDATE story_video_compositions SET status='complete',output_path=?,content_hash=?,byte_size=?,duration_seconds=?,actual_cost_usd=0,receipt_json=?,updated_at=? WHERE composition_id=?`).run(finalPath, contentHash, byteSize, mediaProbe.duration_seconds, JSON.stringify(receipt), Date.now(), compositionId);
    log(db, { workspace_id: workspaceId, mode: 'video_engine', event_type: 'video.composition.completed', payload: { composition_id: compositionId, profile: profileName, source_count: sources.length, duration_seconds: mediaProbe.duration_seconds, content_hash: contentHash, release_ready: releaseReady, provider_cost_usd: 0, media_verified: true } });
    return getStoryVideoComposition(db, compositionId);
  } catch (error) {
    const safeCode = typeof error?.code === 'string' && (error.code.startsWith('COMPOSITION_') || error.code === 'FFMPEG_UNAVAILABLE') ? error.code : 'COMPOSITION_FAILED';
    const safeMessage = safeCode === 'COMPOSITION_FAILED' ? 'Video composition failed during media assembly.' : text(error.message, 'Video composition failed.');
    const failure = { schema_version: COMPOSITION_SCHEMA_VERSION, composition_id: compositionId, compositor: COMPOSITOR_VERSION, profile: profileName, source_count: sources.length, error: safeMessage, code: safeCode, failures: Array.isArray(error.failures) ? error.failures : [], provider_cost_usd: 0, failed_at: Date.now() };
    db.prepare(`UPDATE story_video_compositions SET status='failed',receipt_json=?,updated_at=? WHERE composition_id=?`).run(JSON.stringify(failure), Date.now(), compositionId);
    log(db, { workspace_id: workspaceId, mode: 'video_engine', event_type: 'video.composition.failed', payload: { composition_id: compositionId, profile: profileName, source_count: sources.length, code: safeCode, error: safeMessage, provider_cost_usd: 0 } });
    if (safeCode !== error.code) throw compositionError(safeCode, safeMessage, failure.failures);
    throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export const composeStoryVideoExports = composeStoryVideoSources;
