// lib/openVideoRenderer.js
// LEEVIZE primary render lane: founder-controlled ComfyUI/open-weight video execution.
// Canon, continuity cookies, QA and receipts remain StoryEngine authority. GPU workers are replaceable compute.

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getStoryVideoJob } from './videoEngine.js';
import { createContinuityCookie, createProofCookie, classifyReceiptContinuity } from './videoContinuity.js';
import { log } from '../models/eventModel.js';

const RENDERER = 'comfyui_open_weight_video_v1';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_FPS = 24;
const MAX_ERROR_LENGTH = 360;

function text(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function safeMessage(error, fallback = 'Open video render failed.') {
  const code = text(error?.code);
  if (code) return `${code}: ${fallback}`.slice(0, MAX_ERROR_LENGTH);
  return fallback;
}

function rendererBaseUrl() {
  const raw = text(process.env.LEEVIZE_COMFYUI_URL);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url.origin;
}

function workflowPath() {
  const configured = text(process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH);
  if (!configured) return null;
  const root = resolve(process.cwd());
  const candidate = resolve(configured);
  if (!(candidate === root || candidate.startsWith(`${root}${sep}`))) return null;
  return candidate;
}

function modelLicenseVerified() {
  return text(process.env.LEEVIZE_MODEL_LICENSE_STATUS).toLowerCase() === 'verified-commercial';
}

function outputRoot() {
  return resolve(process.env.LEEVIZE_OPEN_VIDEO_OUTPUT_DIR || join(process.cwd(), 'var', 'video-exports', 'open-weight'));
}

function ffmpegBinary() {
  return text(process.env.L99_VIDEO_FFMPEG_BINARY, 'ffmpeg');
}

function ffprobeBinary() {
  return text(process.env.L99_VIDEO_FFPROBE_BINARY, 'ffprobe');
}

function assertMediaTooling() {
  const ffmpeg = spawnSync(ffmpegBinary(), ['-version'], { encoding: 'utf8' });
  const ffprobe = spawnSync(ffprobeBinary(), ['-version'], { encoding: 'utf8' });
  if (ffmpeg.error || ffmpeg.status !== 0 || ffprobe.error || ffprobe.status !== 0) {
    const error = new Error('Media tooling unavailable.');
    error.code = 'OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE';
    throw error;
  }
}

function dimensionsFor(aspectRatio) {
  if (aspectRatio === '9:16') return { width: 720, height: 1280 };
  if (aspectRatio === '1:1') return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

function seedFor(cookie, shotId, attempt = 0) {
  const digest = createHash('sha256').update(`${cookie}:${shotId}:${attempt}`).digest();
  return digest.readUInt32BE(0);
}

function replaceTokens(value, replacements) {
  if (Array.isArray(value)) return value.map(item => replaceTokens(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, replacements)]));
  }
  if (typeof value !== 'string') return value;
  if (Object.prototype.hasOwnProperty.call(replacements, value)) return replacements[value];
  let next = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    next = next.replaceAll(token, String(replacement));
  }
  return next;
}

export function compileComfyWorkflow(workflow, shot, job, attempt = 0) {
  const cookie = createContinuityCookie(job);
  const dimensions = dimensionsFor(job.blueprint?.aspect_ratio || '16:9');
  const duration = Math.max(1, Number(shot.duration_seconds || 5));
  const frames = Math.max(1, Math.round(duration * DEFAULT_FPS));
  const replacements = {
    '__LEEVIZE_PROMPT__': text(shot.provider_prompt || shot.action || shot.narration),
    '__LEEVIZE_NEGATIVE_PROMPT__': (shot.negative_constraints || []).join(', '),
    '__LEEVIZE_SEED__': seedFor(cookie.value, shot.shot_id, attempt),
    '__LEEVIZE_WIDTH__': dimensions.width,
    '__LEEVIZE_HEIGHT__': dimensions.height,
    '__LEEVIZE_FPS__': DEFAULT_FPS,
    '__LEEVIZE_FRAMES__': frames,
    '__LEEVIZE_SHOT_ID__': text(shot.shot_id),
    '__LEEVIZE_CONTINUITY_COOKIE__': cookie.value
  };
  return replaceTokens(workflow, replacements);
}

function readWorkflow() {
  const path = workflowPath();
  if (!path || !existsSync(path)) {
    const error = new Error('ComfyUI API workflow is not configured.');
    error.code = 'OPEN_RENDER_WORKFLOW_UNAVAILABLE';
    throw error;
  }
  const bytes = readFileSync(path);
  let workflow;
  try { workflow = JSON.parse(bytes.toString('utf8')); }
  catch {
    const error = new Error('ComfyUI API workflow is invalid JSON.');
    error.code = 'OPEN_RENDER_WORKFLOW_INVALID';
    throw error;
  }
  return { workflow, workflow_sha256: hashBytes(bytes) };
}

export function ensureOpenVideoRendererSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_video_open_renders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      render_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      continuity_cookie TEXT NOT NULL,
      proof_cookie TEXT,
      status TEXT NOT NULL,
      renderer TEXT NOT NULL,
      output_path TEXT,
      output_sha256 TEXT,
      receipt_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_open_renders_job ON story_video_open_renders(job_id, shot_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_open_renders_cookie ON story_video_open_renders(job_id, continuity_cookie, status);

    CREATE TABLE IF NOT EXISTS story_video_render_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      failure_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      shot_id TEXT,
      continuity_cookie TEXT,
      failure_class TEXT NOT NULL,
      safe_message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_failures_job ON story_video_render_failures(job_id, created_at DESC);
  `);
}

function recordFailure(db, job, { shot_id = null, failure_class, message }) {
  ensureOpenVideoRendererSchema(db);
  const continuity = createContinuityCookie(job);
  const receipt = {
    failure_id: `video_failure_${randomUUID()}`,
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    shot_id,
    continuity_cookie: continuity.value,
    failure_class,
    safe_message: text(message, 'Render failure').slice(0, MAX_ERROR_LENGTH),
    created_at: Date.now()
  };
  db.prepare(`INSERT INTO story_video_render_failures (failure_id,job_id,workspace_id,shot_id,continuity_cookie,failure_class,safe_message,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
    receipt.failure_id, receipt.job_id, receipt.workspace_id, receipt.shot_id, receipt.continuity_cookie,
    receipt.failure_class, receipt.safe_message, receipt.created_at
  );
  return receipt;
}

async function fetchJson(url, init = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      const error = new Error('ComfyUI request failed.');
      error.code = `COMFYUI_HTTP_${response.status}`;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('ComfyUI request timed out.');
      timeout.code = 'OPEN_RENDER_COMPUTE_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      const error = new Error('ComfyUI output fetch failed.');
      error.code = `COMFYUI_OUTPUT_HTTP_${response.status}`;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOpenVideoRenderer() {
  const baseUrl = rendererBaseUrl();
  const path = workflowPath();
  const workflow_configured = Boolean(path && existsSync(path));
  const license_verified = modelLicenseVerified();
  const configured = Boolean(baseUrl && workflow_configured && license_verified);
  const state = {
    renderer: RENDERER,
    primary_lane: 'self_hosted_open_weight',
    configured,
    compute_reachable: false,
    workflow_configured,
    license_verified,
    model_id: text(process.env.LEEVIZE_MODEL_ID, null),
    worker_id: text(process.env.LEEVIZE_RENDER_WORKER_ID, null),
    vendor_credit_required: false,
    authority: 'none'
  };
  if (!baseUrl) return { ...state, blocker: 'OPEN_RENDER_COMPUTE_UNCONFIGURED' };
  if (!workflow_configured) return { ...state, blocker: 'OPEN_RENDER_WORKFLOW_UNAVAILABLE' };
  if (!license_verified) return { ...state, blocker: 'BLOCKED_LICENSE_REVIEW' };
  try {
    await fetchJson(`${baseUrl}/system_stats`, {}, 3500);
    return { ...state, configured: true, compute_reachable: true, ready: true, blocker: null };
  } catch {
    return { ...state, configured: true, compute_reachable: false, ready: false, blocker: 'OPEN_RENDER_COMPUTE_UNREACHABLE' };
  }
}

function outputCandidates(historyEntry) {
  const found = [];
  function walk(value) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.filename === 'string') {
      const ext = extname(value.filename).toLowerCase();
      if (['.mp4', '.webm', '.mov', '.mkv', '.gif'].includes(ext)) {
        found.push({ filename: value.filename, subfolder: text(value.subfolder), type: text(value.type, 'output') });
      }
    }
    Object.values(value).forEach(walk);
  }
  walk(historyEntry);
  return found;
}

async function waitForOutput(baseUrl, promptId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await fetchJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {}, 5000);
    const entry = history?.[promptId];
    if (entry) {
      const candidates = outputCandidates(entry);
      if (candidates.length) return candidates[candidates.length - 1];
      const status = entry.status?.status_str;
      if (status === 'error') {
        const error = new Error('ComfyUI execution failed.');
        error.code = 'OPEN_RENDER_EXECUTION_FAILED';
        throw error;
      }
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, DEFAULT_POLL_MS));
  }
  const error = new Error('ComfyUI render timed out.');
  error.code = 'OPEN_RENDER_COMPUTE_TIMEOUT';
  throw error;
}

function probeMedia(filePath) {
  const result = spawnSync(ffprobeBinary(), [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json', filePath
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const error = new Error('Rendered media failed ffprobe verification.');
    error.code = 'OPEN_RENDER_MEDIA_INVALID';
    throw error;
  }
  let data;
  try { data = JSON.parse(result.stdout || '{}'); }
  catch {
    const error = new Error('Rendered media probe was invalid JSON.');
    error.code = 'OPEN_RENDER_MEDIA_INVALID';
    throw error;
  }
  const video = (data.streams || []).find(stream => stream.codec_type === 'video');
  const duration = Number(data.format?.duration || 0);
  if (!video || !(duration > 0)) {
    const error = new Error('Rendered output has no playable video stream.');
    error.code = 'OPEN_RENDER_MEDIA_INVALID';
    throw error;
  }
  return {
    verifier: 'ffprobe',
    verified: true,
    duration_seconds: duration,
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    codec_name: video.codec_name || null,
    frame_rate: video.r_frame_rate || null
  };
}

function assertJobReady(job) {
  if (!job) {
    const error = new Error('Video job not found.');
    error.code = 'OPEN_RENDER_JOB_NOT_FOUND';
    throw error;
  }
  if (!['preview_validated', 'validated'].includes(job.status)) {
    const error = new Error('Video job must pass the Playwright production-plan gate before real rendering.');
    error.code = 'OPEN_RENDER_PREVIEW_NOT_VALIDATED';
    throw error;
  }
}

export async function renderOpenVideoShot(db, jobId, shotId, options = {}) {
  ensureOpenVideoRendererSchema(db);
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  const shot = (job.blueprint?.shots || []).find(item => item.shot_id === shotId);
  if (!shot) {
    const error = new Error('Shot not found.');
    error.code = 'OPEN_RENDER_SHOT_NOT_FOUND';
    throw error;
  }
  const continuity = createContinuityCookie(job);
  const baseUrl = rendererBaseUrl();
  if (!baseUrl) {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: 'OPEN_RENDER_COMPUTE_UNCONFIGURED', message: 'No self-hosted ComfyUI endpoint is configured.' });
    const error = new Error(failure.safe_message); error.code = failure.failure_class; error.failure_receipt = failure; throw error;
  }
  if (!modelLicenseVerified()) {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: 'BLOCKED_LICENSE_REVIEW', message: 'The configured open-weight model has not been marked verified for commercial use.' });
    const error = new Error(failure.safe_message); error.code = failure.failure_class; error.failure_receipt = failure; throw error;
  }
  assertMediaTooling();
  const { workflow, workflow_sha256 } = readWorkflow();
  const attempt = boundedInt(options.attempt, 0, 0, 9);
  const compiled = compileComfyWorkflow(workflow, shot, job, attempt);
  const prompt = await fetchJson(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: compiled, client_id: `leevize-${randomUUID()}` })
  }, 10000).catch(error => {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: error.code || 'OPEN_RENDER_COMPUTE_REQUEST_FAILED', message: 'Self-hosted render worker rejected or could not receive the job.' });
    error.failure_receipt = failure;
    throw error;
  });
  const promptId = text(prompt?.prompt_id);
  if (!promptId) {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: 'OPEN_RENDER_PROMPT_RECEIPT_MISSING', message: 'Render worker did not return a prompt receipt.' });
    const error = new Error(failure.safe_message); error.code = failure.failure_class; error.failure_receipt = failure; throw error;
  }

  const timeoutMs = boundedInt(options.timeout_ms, DEFAULT_TIMEOUT_MS, 30000, 60 * 60 * 1000);
  let output;
  try { output = await waitForOutput(baseUrl, promptId, timeoutMs); }
  catch (error) {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: error.code || 'OPEN_RENDER_EXECUTION_FAILED', message: safeMessage(error) });
    error.failure_receipt = failure;
    throw error;
  }

  const query = new URLSearchParams({ filename: output.filename, type: output.type || 'output' });
  if (output.subfolder) query.set('subfolder', output.subfolder);
  const bytes = await fetchBytes(`${baseUrl}/view?${query.toString()}`);
  const ext = ['.mp4', '.webm', '.mov', '.mkv'].includes(extname(output.filename).toLowerCase()) ? extname(output.filename).toLowerCase() : '.mp4';
  const dir = join(outputRoot(), job.workspace_id, job.job_id);
  mkdirSync(dir, { recursive: true });
  const renderId = `open_render_${randomUUID()}`;
  const filePath = join(dir, `${shotId}-${continuity.value}-${attempt}${ext}`);
  writeFileSync(filePath, bytes);

  let mediaProbe;
  try { mediaProbe = probeMedia(filePath); }
  catch (error) {
    rmSync(filePath, { force: true });
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: error.code || 'OPEN_RENDER_MEDIA_INVALID', message: 'Generated shot failed playable-media verification.' });
    error.failure_receipt = failure;
    throw error;
  }

  const outputSha = hashBytes(bytes);
  const proof = createProofCookie(job, {
    evidence_class: 'rendered_open_weight_video',
    output_sha256: outputSha,
    renderer: RENDERER,
    workflow_sha256,
    media_probe: mediaProbe
  });
  const receipt = {
    schema_version: '1.0.0',
    render_id: renderId,
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    shot_id: shotId,
    renderer: RENDERER,
    primary_lane: 'self_hosted_open_weight',
    provider_generation: false,
    vendor_credit_required: false,
    model_id: text(process.env.LEEVIZE_MODEL_ID, null),
    model_license_status: 'verified-commercial',
    workflow_sha256,
    continuity_cookie: continuity.value,
    proof_cookie: proof.value,
    output_sha256: outputSha,
    media_probe: mediaProbe,
    authority_granted: false,
    created_at: Date.now()
  };
  db.prepare(`INSERT INTO story_video_open_renders (render_id,job_id,workspace_id,shot_id,continuity_cookie,proof_cookie,status,renderer,output_path,output_sha256,receipt_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'complete',?,?,?,?,?,?)`).run(
    renderId, job.job_id, job.workspace_id, shotId, continuity.value, proof.value, RENDERER,
    filePath, outputSha, JSON.stringify(receipt), receipt.created_at, receipt.created_at
  );
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_render.completed', payload: { job_id: job.job_id, shot_id: shotId, render_id: renderId, continuity_cookie: continuity.value, proof_cookie: proof.value, output_sha256: outputSha, vendor_credit_required: false } });
  return receipt;
}

export async function renderOpenVideoShotSet(db, jobId, options = {}) {
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  const requested = Array.isArray(options.shot_ids) && options.shot_ids.length ? new Set(options.shot_ids.map(String)) : null;
  const results = [];
  for (const shot of job.blueprint?.shots || []) {
    if (requested && !requested.has(shot.shot_id)) continue;
    try {
      results.push({ shot_id: shot.shot_id, status: 'complete', receipt: await renderOpenVideoShot(db, jobId, shot.shot_id, options) });
    } catch (error) {
      results.push({ shot_id: shot.shot_id, status: 'failed', failure: error.failure_receipt || { failure_class: error.code || 'OPEN_RENDER_FAILED', safe_message: 'Render failed.' } });
      if (options.continue_on_failure !== true) break;
    }
  }
  return {
    job_id: jobId,
    continuity_cookie: createContinuityCookie(job).value,
    results,
    complete: results.length > 0 && results.every(item => item.status === 'complete'),
    authority_granted: false
  };
}

export function listOpenVideoRenders(db, jobId) {
  ensureOpenVideoRendererSchema(db);
  const job = getStoryVideoJob(db, jobId);
  if (!job) return null;
  const current = createContinuityCookie(job);
  const renders = db.prepare(`SELECT render_id,shot_id,continuity_cookie,proof_cookie,status,renderer,output_sha256,receipt_json,created_at,updated_at FROM story_video_open_renders WHERE job_id=? ORDER BY created_at DESC`).all(jobId).map(row => {
    const receipt = JSON.parse(row.receipt_json || '{}');
    return { ...row, receipt, continuity: classifyReceiptContinuity(job, receipt) };
  });
  const failures = db.prepare(`SELECT failure_id,shot_id,continuity_cookie,failure_class,safe_message,created_at FROM story_video_render_failures WHERE job_id=? ORDER BY created_at DESC`).all(jobId);
  return { job_id: jobId, continuity_cookie: current, renders, failures, authority_granted: false };
}

export function getOpenVideoRenderFile(db, renderId) {
  ensureOpenVideoRendererSchema(db);
  const row = db.prepare(`SELECT * FROM story_video_open_renders WHERE render_id=? AND status='complete'`).get(renderId);
  if (!row || !row.output_path || !existsSync(row.output_path)) return null;
  return { path: row.output_path, filename: basename(row.output_path), row };
}

function latestCurrentShotFiles(db, job) {
  ensureOpenVideoRendererSchema(db);
  const cookie = createContinuityCookie(job).value;
  return (job.blueprint?.shots || []).map(shot => {
    const row = db.prepare(`SELECT * FROM story_video_open_renders WHERE job_id=? AND shot_id=? AND continuity_cookie=? AND status='complete' ORDER BY created_at DESC LIMIT 1`).get(job.job_id, shot.shot_id, cookie);
    return { shot_id: shot.shot_id, row: row && row.output_path && existsSync(row.output_path) ? row : null };
  });
}

export function assembleOpenVideoMaster(db, jobId) {
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  assertMediaTooling();
  const entries = latestCurrentShotFiles(db, job);
  const missing = entries.filter(item => !item.row).map(item => item.shot_id);
  if (missing.length) {
    const failure = recordFailure(db, job, { failure_class: 'OPEN_RENDER_SHOTS_INCOMPLETE', message: `Current continuity cookie is missing rendered shots: ${missing.join(', ')}` });
    const error = new Error(failure.safe_message); error.code = failure.failure_class; error.failure_receipt = failure; error.missing_shots = missing; throw error;
  }

  const dims = dimensionsFor(job.blueprint?.aspect_ratio || '16:9');
  const work = mkdtempSync(join(tmpdir(), 'leevize-assemble-'));
  const normalized = [];
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const source = entries[index].row.output_path;
      const target = join(work, `shot-${String(index + 1).padStart(2, '0')}.mp4`);
      const filter = `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,fps=${DEFAULT_FPS}`;
      const result = spawnSync(ffmpegBinary(), ['-y', '-v', 'error', '-i', source, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-vf', filter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', target], { encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        const error = new Error('Shot normalization failed.'); error.code = 'OPEN_RENDER_ASSEMBLY_NORMALIZE_FAILED'; throw error;
      }
      normalized.push(target);
    }
    const listPath = join(work, 'concat.txt');
    writeFileSync(listPath, normalized.map(path => `file '${path.replaceAll("'", "'\\''")}'`).join('\n'));
    const dir = join(outputRoot(), job.workspace_id, job.job_id);
    mkdirSync(dir, { recursive: true });
    const continuity = createContinuityCookie(job);
    const masterPath = join(dir, `master-${continuity.value}.mp4`);
    const concat = spawnSync(ffmpegBinary(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', masterPath], { encoding: 'utf8' });
    if (concat.error || concat.status !== 0) {
      const error = new Error('Master assembly failed.'); error.code = 'OPEN_RENDER_ASSEMBLY_FAILED'; throw error;
    }
    const mediaProbe = probeMedia(masterPath);
    const bytes = readFileSync(masterPath);
    const outputSha = hashBytes(bytes);
    const proof = createProofCookie(job, { evidence_class: 'assembled_open_weight_master', output_sha256: outputSha, renderer: `${RENDERER}+ffmpeg`, media_probe: mediaProbe });
    const receipt = {
      schema_version: '1.0.0',
      job_id: job.job_id,
      workspace_id: job.workspace_id,
      renderer: `${RENDERER}+ffmpeg`,
      continuity_cookie: continuity.value,
      proof_cookie: proof.value,
      output_sha256: outputSha,
      media_probe: mediaProbe,
      shot_count: entries.length,
      vendor_credit_required: false,
      authority_granted: false,
      output_path: masterPath,
      created_at: Date.now()
    };
    log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_master.completed', payload: { job_id: job.job_id, continuity_cookie: continuity.value, proof_cookie: proof.value, output_sha256: outputSha, shot_count: entries.length } });
    return receipt;
  } catch (error) {
    const failure = recordFailure(db, job, { failure_class: error.code || 'OPEN_RENDER_ASSEMBLY_FAILED', message: safeMessage(error, 'Open video assembly failed.') });
    error.failure_receipt = failure;
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
