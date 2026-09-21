// lib/openVideoRenderer.js
// LEEVIZE primary render lane: founder-controlled ComfyUI + open-weight video execution.
// Canon, continuity, QA, assembly and receipts remain StoryEngine authority. GPU workers are replaceable compute.

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
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { getStoryVideoJob } from './videoEngine.js';
import { createContinuityCookie, createProofCookie, classifyReceiptContinuity } from './videoContinuity.js';
import { log } from '../models/eventModel.js';

const RENDERER = 'comfyui_wan22_ti2v_5b_v2';
const DEFAULT_WORKFLOW_PATH = fileURLToPath(new URL('../config/leevize-wan22-ti2v-5b-api.json', import.meta.url));
const MODEL_MANIFEST_PATH = fileURLToPath(new URL('../config/leevize-model-manifest.json', import.meta.url));
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_FPS = 24;
const MAX_ERROR_LENGTH = 360;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const REQUIRED_NODE_TYPES = Object.freeze([
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'ModelSamplingSD3',
  'CLIPTextEncode',
  'Wan22ImageToVideoLatent',
  'LoadImage',
  'KSampler',
  'VAEDecode',
  'CreateVideo',
  'SaveVideo'
]);

function text(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function safeMessage(error, fallback = 'Open video render failed.') {
  const code = text(error?.code);
  return `${code ? `${code}: ` : ''}${fallback}`.slice(0, MAX_ERROR_LENGTH);
}

function rendererBaseUrl() {
  if (!text(process.env.LEEVIZE_RENDER_WORKER_ID)) return null;
  const raw = text(process.env.LEEVIZE_COMFYUI_URL || process.env.COMFYUI_URL);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url.toString().replace(/\/$/, '');
}

function rendererToken() {
  return text(process.env.LEEVIZE_COMFYUI_TOKEN);
}

function workflowPath() {
  const configured = text(process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH);
  if (!configured) return DEFAULT_WORKFLOW_PATH;
  const root = resolve(process.cwd());
  const candidate = resolve(configured);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function readJsonFile(path, code) {
  if (!path || !existsSync(path)) {
    const error = new Error('Required renderer configuration file is unavailable.');
    error.code = code;
    throw error;
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch {
    const error = new Error('Required renderer configuration file is invalid JSON.');
    error.code = code;
    throw error;
  }
}

function modelManifest() {
  return readJsonFile(MODEL_MANIFEST_PATH, 'OPEN_RENDER_MODEL_MANIFEST_INVALID');
}

function modelConfig() {
  const manifest = modelManifest();
  const requestedId = text(process.env.LEEVIZE_MODEL_ID, manifest.default_model_id);
  const entry = (manifest.models || []).find(item => item.id === requestedId);
  if (!entry) {
    return {
      id: requestedId,
      verified: false,
      license: null,
      commercial_use_allowed: false,
      diffusion_model: text(process.env.LEEVIZE_WAN_MODEL),
      text_encoder: text(process.env.LEEVIZE_WAN_TEXT_ENCODER),
      vae: text(process.env.LEEVIZE_WAN_VAE)
    };
  }
  return {
    ...entry,
    verified: entry.commercial_use_allowed === true && Boolean(text(entry.license)) && text(process.env.LEEVIZE_MODEL_LICENSE_STATUS) === 'verified-commercial',
    diffusion_model: text(process.env.LEEVIZE_WAN_MODEL, entry.diffusion_model),
    text_encoder: text(process.env.LEEVIZE_WAN_TEXT_ENCODER, entry.text_encoder),
    vae: text(process.env.LEEVIZE_WAN_VAE, entry.vae)
  };
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

function mediaToolingReady() {
  const ffmpeg = spawnSync(ffmpegBinary(), ['-version'], { encoding: 'utf8' });
  const ffprobe = spawnSync(ffprobeBinary(), ['-version'], { encoding: 'utf8' });
  return !ffmpeg.error && ffmpeg.status === 0 && !ffprobe.error && ffprobe.status === 0;
}

function assertMediaTooling() {
  if (!mediaToolingReady()) {
    const error = new Error('FFmpeg and ffprobe are required for real-footage verification and assembly.');
    error.code = 'OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE';
    throw error;
  }
}

function dimensionsFor(aspectRatio) {
  if (aspectRatio === '9:16') return { width: 480, height: 832 };
  if (aspectRatio === '1:1') return { width: 640, height: 640 };
  return { width: 832, height: 480 };
}

function framesFor(durationSeconds, fps) {
  const desired = Math.max(17, Math.round(Math.max(1, Math.min(15, Number(durationSeconds) || 5)) * fps));
  return Math.ceil((desired - 1) / 4) * 4 + 1;
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
  for (const [token, replacement] of Object.entries(replacements)) next = next.replaceAll(token, String(replacement));
  return next;
}

export function compileComfyWorkflow(workflow, shot, job, attempt = 0, runtime = {}) {
  const cookie = createContinuityCookie(job);
  const dimensions = dimensionsFor(job.blueprint?.aspect_ratio || '16:9');
  const model = runtime.model || modelConfig();
  const fps = boundedInt(runtime.fps, DEFAULT_FPS, 8, 60);
  const replacements = {
    '__LEEVIZE_PROMPT__': text(shot.provider_prompt || shot.action || shot.narration),
    '__LEEVIZE_NEGATIVE_PROMPT__': (shot.negative_constraints || []).join(', '),
    '__LEEVIZE_SEED__': seedFor(cookie.value, shot.shot_id, attempt),
    '__LEEVIZE_WIDTH__': boundedInt(runtime.width, dimensions.width, 256, 1920),
    '__LEEVIZE_HEIGHT__': boundedInt(runtime.height, dimensions.height, 144, 1080),
    '__LEEVIZE_FPS__': fps,
    '__LEEVIZE_FRAMES__': framesFor(runtime.duration_seconds || shot.duration_seconds, fps),
    '__LEEVIZE_SHOT_ID__': text(shot.shot_id),
    '__LEEVIZE_CONTINUITY_COOKIE__': cookie.value,
    '__LEEVIZE_MODEL__': model.diffusion_model,
    '__LEEVIZE_TEXT_ENCODER__': model.text_encoder,
    '__LEEVIZE_VAE__': model.vae,
    '__LEEVIZE_INPUT_IMAGE__': text(runtime.input_image_name)
  };
  return replaceTokens(workflow, replacements);
}

function readWorkflow() {
  const path = workflowPath();
  if (!path || !existsSync(path)) {
    const error = new Error('ComfyUI API workflow is unavailable.');
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

async function boundedResponseBytes(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    const error = new Error('Renderer response exceeded the configured size limit.');
    error.code = 'OPEN_RENDER_RESPONSE_TOO_LARGE';
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    const error = new Error('Renderer response exceeded the configured size limit.');
    error.code = 'OPEN_RENDER_RESPONSE_TOO_LARGE';
    throw error;
  }
  return bytes;
}

async function comfyFetch(path, init = {}, timeoutMs = 10_000) {
  const base = rendererBaseUrl();
  if (!base) {
    const error = new Error('No founder-controlled ComfyUI runtime is configured.');
    error.code = 'OPEN_RENDER_COMPUTE_UNCONFIGURED';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = rendererToken();
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) }
    });
    if (!response.ok) {
      const error = new Error(`ComfyUI request failed with HTTP ${response.status}.`);
      error.code = `COMFYUI_HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('ComfyUI request timed out.');
      timeout.code = 'OPEN_RENDER_COMPUTE_TIMEOUT';
      throw timeout;
    }
    if (error?.code) throw error;
    const safe = new Error('ComfyUI request failed.');
    safe.code = 'OPEN_RENDER_COMPUTE_UNREACHABLE';
    throw safe;
  } finally {
    clearTimeout(timer);
  }
}

async function comfyJson(path, init = {}, timeoutMs = 10_000) {
  const response = await comfyFetch(path, init, timeoutMs);
  const bytes = await boundedResponseBytes(response, MAX_JSON_BYTES);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch {
    const error = new Error('ComfyUI returned invalid JSON.');
    error.code = 'OPEN_RENDER_INVALID_JSON';
    throw error;
  }
}

function modelChoices(objectInfo, nodeType, inputName) {
  const choices = objectInfo?.[nodeType]?.input?.required?.[inputName]?.[0];
  return Array.isArray(choices) ? choices.map(String) : [];
}

export async function probeOpenVideoRenderer() {
  const model = modelConfig();
  const blockers = [];
  const base = rendererBaseUrl();
  let workflowSha = null;
  try { workflowSha = readWorkflow().workflow_sha256; }
  catch (error) { blockers.push({ id: 'WF-01', code: error.code, reason: error.message }); }
  if (!model.verified) blockers.push({ id: 'LIC-01', code: 'BLOCKED_LICENSE_REVIEW', reason: 'Configured model is not verified by the locked model manifest for commercial use.' });
  if (!mediaToolingReady()) blockers.push({ id: 'MEDIA-01', code: 'OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE', reason: 'FFmpeg or ffprobe is unavailable.' });
  if (!base) blockers.push({ id: 'GPU-01', code: 'OPEN_RENDER_COMPUTE_UNCONFIGURED', reason: 'No ComfyUI GPU runtime is configured.' });

  let objectInfo = null;
  let stats = null;
  if (base) {
    try {
      [objectInfo, stats] = await Promise.all([comfyJson('/object_info'), comfyJson('/system_stats')]);
    } catch (error) {
      blockers.push({ id: 'GPU-02', code: error.code || 'OPEN_RENDER_COMPUTE_UNREACHABLE', reason: 'Configured ComfyUI runtime is not reachable.' });
    }
  }
  if (objectInfo) {
    const missingNodes = REQUIRED_NODE_TYPES.filter(type => !objectInfo[type]);
    if (missingNodes.length) blockers.push({ id: 'GPU-03', code: 'OPEN_RENDER_COMFYUI_NODES_MISSING', reason: 'ComfyUI is missing required native video nodes.', missing_nodes: missingNodes });
    const missingModels = [];
    if (!modelChoices(objectInfo, 'UNETLoader', 'unet_name').includes(model.diffusion_model)) missingModels.push(model.diffusion_model);
    if (!modelChoices(objectInfo, 'CLIPLoader', 'clip_name').includes(model.text_encoder)) missingModels.push(model.text_encoder);
    if (!modelChoices(objectInfo, 'VAELoader', 'vae_name').includes(model.vae)) missingModels.push(model.vae);
    if (missingModels.length) blockers.push({ id: 'GPU-04', code: 'OPEN_RENDER_MODEL_FILES_MISSING', reason: 'ComfyUI is missing one or more locked model files.', missing_models: missingModels });
  }

  return {
    renderer: RENDERER,
    primary_lane: 'self_hosted_open_weight',
    ready: blockers.length === 0,
    configured: Boolean(base),
    compute_reachable: Boolean(stats),
    vendor_credit_required: false,
    paid_fallback_authoritative: false,
    workflow_sha256: workflowSha,
    model: { id: model.id, license: model.license || null, commercial_use_allowed: model.commercial_use_allowed === true },
    runtime: stats ? { devices: Array.isArray(stats.devices) ? stats.devices.map(device => ({ name: text(device?.name, 'GPU'), type: text(device?.type, 'unknown'), vram_total: Number(device?.vram_total || 0) })) : [] } : null,
    blockers,
    blocker: blockers[0]?.code || null,
    authority: 'none'
  };
}

function decodeReferenceImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(text(dataUrl));
  if (!match) {
    const error = new Error('A PNG, JPEG, or WebP canon reference image is required.');
    error.code = 'BLOCKED_CANON_REFERENCE';
    throw error;
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.byteLength || bytes.byteLength > MAX_REFERENCE_BYTES) {
    const error = new Error('Canon reference image is empty or too large.');
    error.code = 'BLOCKED_CANON_REFERENCE';
    throw error;
  }
  const mime = match[1].toLowerCase();
  const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { bytes, mime, extension, sha256: hashBytes(bytes) };
}

async function uploadReferenceImage(dataUrl) {
  const reference = decodeReferenceImage(dataUrl);
  const filename = `leevize-${reference.sha256.slice(0, 20)}.${reference.extension}`;
  const form = new FormData();
  form.append('image', new Blob([reference.bytes], { type: reference.mime }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const uploaded = await comfyJson('/upload/image', { method: 'POST', body: form }, 30_000);
  return { ...reference, name: text(uploaded?.name || uploaded?.filename, filename) };
}

function columnExists(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some(row => row.name === columnName);
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!columnExists(db, tableName, columnName)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
      prompt_id TEXT,
      workflow_sha256 TEXT,
      model_id TEXT,
      reference_sha256 TEXT,
      output_path TEXT,
      output_sha256 TEXT,
      technical_status TEXT NOT NULL DEFAULT 'pending',
      continuity_status TEXT NOT NULL DEFAULT 'pending',
      editorial_status TEXT NOT NULL DEFAULT 'pending',
      review_notes TEXT,
      receipt_json TEXT NOT NULL DEFAULT '{}',
      failure_json TEXT NOT NULL DEFAULT '{}',
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
      render_id TEXT,
      continuity_cookie TEXT,
      failure_class TEXT NOT NULL,
      safe_message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_failures_job ON story_video_render_failures(job_id, created_at DESC);
  `);
  ensureColumn(db, 'story_video_open_renders', 'prompt_id', 'TEXT');
  ensureColumn(db, 'story_video_open_renders', 'workflow_sha256', 'TEXT');
  ensureColumn(db, 'story_video_open_renders', 'model_id', 'TEXT');
  ensureColumn(db, 'story_video_open_renders', 'reference_sha256', 'TEXT');
  ensureColumn(db, 'story_video_open_renders', 'technical_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'story_video_open_renders', 'continuity_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'story_video_open_renders', 'editorial_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'story_video_open_renders', 'review_notes', 'TEXT');
  ensureColumn(db, 'story_video_open_renders', 'failure_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'story_video_render_failures', 'render_id', 'TEXT');
}

function recordFailure(db, job, { shot_id = null, render_id = null, failure_class, message }) {
  ensureOpenVideoRendererSchema(db);
  const continuity = createContinuityCookie(job);
  const receipt = {
    failure_id: `video_failure_${randomUUID()}`,
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    shot_id,
    render_id,
    continuity_cookie: continuity.value,
    failure_class,
    safe_message: text(message, 'Render failure').slice(0, MAX_ERROR_LENGTH),
    created_at: Date.now()
  };
  db.prepare(`INSERT INTO story_video_render_failures (failure_id,job_id,workspace_id,shot_id,render_id,continuity_cookie,failure_class,safe_message,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    receipt.failure_id, receipt.job_id, receipt.workspace_id, receipt.shot_id, receipt.render_id,
    receipt.continuity_cookie, receipt.failure_class, receipt.safe_message, receipt.created_at
  );
  return receipt;
}

function publicRender(row, job = null) {
  if (!row) return null;
  const receipt = JSON.parse(row.receipt_json || '{}');
  return {
    render_id: row.render_id,
    job_id: row.job_id,
    workspace_id: row.workspace_id,
    shot_id: row.shot_id,
    continuity_cookie: row.continuity_cookie,
    proof_cookie: row.proof_cookie || null,
    status: row.status,
    renderer: row.renderer,
    prompt_id: row.prompt_id || null,
    workflow_sha256: row.workflow_sha256 || null,
    model_id: row.model_id || null,
    reference_sha256: row.reference_sha256 || null,
    output_sha256: row.output_sha256 || null,
    technical_status: row.technical_status || 'pending',
    continuity_status: row.continuity_status || 'pending',
    editorial_status: row.editorial_status || 'pending',
    review_notes: row.review_notes || null,
    receipt,
    continuity: job ? classifyReceiptContinuity(job, receipt) : null,
    media_url: row.status === 'complete' ? `/api/video-engine/open-renders/${encodeURIComponent(row.render_id)}/media` : null,
    authority_granted: false,
    created_at: row.created_at,
    updated_at: row.updated_at
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

function assertRendererReady(status) {
  if (status.ready) return;
  const error = new Error(status.blockers[0]?.reason || 'Open renderer is not ready.');
  error.code = status.blockers[0]?.code || 'OPEN_RENDER_NOT_READY';
  error.blockers = status.blockers;
  throw error;
}

export async function submitOpenVideoShot(db, jobId, shotId, options = {}) {
  ensureOpenVideoRendererSchema(db);
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  const shot = (job.blueprint?.shots || []).find(item => item.shot_id === shotId);
  if (!shot) {
    const error = new Error('Shot not found.');
    error.code = 'OPEN_RENDER_SHOT_NOT_FOUND';
    throw error;
  }
  const status = await probeOpenVideoRenderer();
  if (!status.ready) {
    const receipts = status.blockers.map(blocker => recordFailure(db, job, { shot_id: shotId, failure_class: blocker.code, message: blocker.reason }));
    const error = new Error(receipts[0]?.safe_message || 'Open renderer is not ready.');
    error.code = receipts[0]?.failure_class || 'OPEN_RENDER_NOT_READY';
    error.failure_receipts = receipts;
    error.blockers = status.blockers;
    throw error;
  }

  const reference = await uploadReferenceImage(options.reference_image_data_url).catch(error => {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: error.code || 'BLOCKED_CANON_REFERENCE', message: error.message });
    error.failure_receipts = [failure];
    throw error;
  });
  const { workflow, workflow_sha256 } = readWorkflow();
  const model = modelConfig();
  const attempt = boundedInt(options.attempt, 0, 0, 9);
  const compiled = compileComfyWorkflow(workflow, shot, job, attempt, { model, input_image_name: reference.name });
  const prompt = await comfyJson('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: compiled, client_id: `leevize-${randomUUID()}` })
  }, 30_000).catch(error => {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: error.code || 'OPEN_RENDER_COMPUTE_REQUEST_FAILED', message: 'Self-hosted render worker rejected or could not receive the job.' });
    error.failure_receipts = [failure];
    throw error;
  });
  const promptId = text(prompt?.prompt_id);
  if (!promptId || (prompt?.node_errors && Object.keys(prompt.node_errors).length)) {
    const failure = recordFailure(db, job, { shot_id: shotId, failure_class: 'OPEN_RENDER_WORKFLOW_REJECTED', message: 'ComfyUI rejected the canonical render graph.' });
    const error = new Error(failure.safe_message);
    error.code = failure.failure_class;
    error.failure_receipts = [failure];
    throw error;
  }

  const continuity = createContinuityCookie(job);
  const renderId = `open_render_${randomUUID()}`;
  const dimensions = dimensionsFor(job.blueprint?.aspect_ratio || '16:9');
  const receipt = {
    schema_version: '2.0.0',
    render_id: renderId,
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    shot_id: shotId,
    renderer: RENDERER,
    execution_class: 'self_hosted_open_weight',
    vendor_credit_required: false,
    paid_fallback_authoritative: false,
    model: { id: model.id, license: model.license, commercial_use_allowed: model.commercial_use_allowed === true },
    workflow_sha256,
    seed: seedFor(continuity.value, shotId, attempt),
    reference_sha256: reference.sha256,
    continuity_cookie: continuity.value,
    prompt_receipt: { present: true },
    output_contract: { width: dimensions.width, height: dimensions.height, fps: DEFAULT_FPS, frames: framesFor(shot.duration_seconds, DEFAULT_FPS) },
    qa: { technical: 'pending', continuity: 'pending', editorial: 'pending' },
    authority_granted: false,
    created_at: Date.now()
  };
  db.prepare(`INSERT INTO story_video_open_renders (
    render_id,job_id,workspace_id,shot_id,continuity_cookie,status,renderer,prompt_id,workflow_sha256,model_id,reference_sha256,
    technical_status,continuity_status,editorial_status,receipt_json,failure_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,'submitted',?,?,?,?,?,'pending','pending','pending',?,'{}',?,?)`).run(
    renderId, job.job_id, job.workspace_id, shotId, continuity.value, RENDERER, promptId, workflow_sha256, model.id, reference.sha256,
    JSON.stringify(receipt), receipt.created_at, receipt.created_at
  );
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_render.submitted', payload: { job_id: job.job_id, shot_id: shotId, render_id: renderId, continuity_cookie: continuity.value, workflow_sha256, reference_sha256: reference.sha256, vendor_credit_required: false } });
  return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
}

function outputCandidates(historyEntry) {
  const found = [];
  function walk(value) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.filename === 'string') {
      const ext = extname(value.filename).toLowerCase();
      if (['.mp4', '.webm', '.mov', '.mkv', '.gif'].includes(ext)) found.push({ filename: value.filename, subfolder: text(value.subfolder), type: text(value.type, 'output') });
    }
    Object.values(value).forEach(walk);
  }
  walk(historyEntry);
  return found;
}

function probeMedia(filePath) {
  const result = spawnSync(ffprobeBinary(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', filePath], { encoding: 'utf8' });
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
  return { verifier: 'ffprobe', verified: true, duration_seconds: duration, width: Number(video.width || 0), height: Number(video.height || 0), codec_name: video.codec_name || null, frame_rate: video.r_frame_rate || null };
}

export async function pollOpenVideoRender(db, renderId) {
  ensureOpenVideoRendererSchema(db);
  const row = db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId);
  if (!row) {
    const error = new Error('Open video render not found.');
    error.code = 'OPEN_RENDER_NOT_FOUND';
    throw error;
  }
  const job = getStoryVideoJob(db, row.job_id);
  if (!job) throw Object.assign(new Error('Video job not found.'), { code: 'OPEN_RENDER_JOB_NOT_FOUND' });
  if (['complete', 'failed'].includes(row.status)) return publicRender(row, job);
  const history = await comfyJson(`/history/${encodeURIComponent(row.prompt_id)}`, {}, 20_000).catch(error => {
    error.code ||= 'OPEN_RENDER_HISTORY_UNAVAILABLE';
    throw error;
  });
  const entry = history?.[row.prompt_id];
  if (!entry) {
    db.prepare(`UPDATE story_video_open_renders SET status='rendering',updated_at=? WHERE render_id=?`).run(Date.now(), renderId);
    return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
  }
  const executionError = entry.status?.status_str === 'error' || (entry.status?.messages || []).some(item => Array.isArray(item) && item[0] === 'execution_error');
  if (executionError) {
    const failure = recordFailure(db, job, { shot_id: row.shot_id, render_id: renderId, failure_class: 'OPEN_RENDER_EXECUTION_FAILED', message: 'ComfyUI reported an execution error for this shot.' });
    db.prepare(`UPDATE story_video_open_renders SET status='failed',failure_json=?,updated_at=? WHERE render_id=?`).run(JSON.stringify(failure), Date.now(), renderId);
    return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
  }
  const output = outputCandidates(entry).at(-1);
  if (!output) {
    db.prepare(`UPDATE story_video_open_renders SET status='rendering',updated_at=? WHERE render_id=?`).run(Date.now(), renderId);
    return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
  }

  const query = new URLSearchParams({ filename: output.filename, type: output.type || 'output' });
  if (output.subfolder) query.set('subfolder', output.subfolder);
  const response = await comfyFetch(`/view?${query.toString()}`, {}, 60_000);
  const bytes = await boundedResponseBytes(response, MAX_VIDEO_BYTES);
  const extension = ['.mp4', '.webm', '.mov', '.mkv'].includes(extname(output.filename).toLowerCase()) ? extname(output.filename).toLowerCase() : '.mp4';
  const dir = join(outputRoot(), job.workspace_id, job.job_id);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${row.shot_id}-${row.continuity_cookie}-${renderId}${extension}`);
  writeFileSync(filePath, bytes);
  let mediaProbe;
  try { mediaProbe = probeMedia(filePath); }
  catch (error) {
    rmSync(filePath, { force: true });
    const failure = recordFailure(db, job, { shot_id: row.shot_id, render_id: renderId, failure_class: error.code || 'OPEN_RENDER_MEDIA_INVALID', message: 'Generated shot failed playable-media verification.' });
    db.prepare(`UPDATE story_video_open_renders SET status='failed',technical_status='rejected',failure_json=?,updated_at=? WHERE render_id=?`).run(JSON.stringify(failure), Date.now(), renderId);
    return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
  }
  const outputSha = hashBytes(bytes);
  const prior = JSON.parse(row.receipt_json || '{}');
  const proof = createProofCookie(job, { evidence_class: 'rendered_open_weight_video', output_sha256: outputSha, renderer: RENDERER, workflow_sha256: row.workflow_sha256, media_probe: mediaProbe });
  const receipt = { ...prior, proof_cookie: proof.value, output_sha256: outputSha, media_probe: mediaProbe, qa: { technical: 'passed', continuity: 'pending_human_review', editorial: 'pending_human_review' }, completed_at: Date.now() };
  db.prepare(`UPDATE story_video_open_renders SET status='complete',proof_cookie=?,output_path=?,output_sha256=?,technical_status='passed',continuity_status='pending',editorial_status='pending',receipt_json=?,updated_at=? WHERE render_id=?`).run(
    proof.value, filePath, outputSha, JSON.stringify(receipt), Date.now(), renderId
  );
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_render.completed', payload: { job_id: job.job_id, shot_id: row.shot_id, render_id: renderId, continuity_cookie: row.continuity_cookie, proof_cookie: proof.value, output_sha256: outputSha, media_verified: true } });
  return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
}

export function reviewOpenVideoRender(db, renderId, input = {}) {
  ensureOpenVideoRendererSchema(db);
  const row = db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId);
  if (!row) throw Object.assign(new Error('Open video render not found.'), { code: 'OPEN_RENDER_NOT_FOUND' });
  const job = getStoryVideoJob(db, row.job_id);
  if (!job) throw Object.assign(new Error('Video job not found.'), { code: 'OPEN_RENDER_JOB_NOT_FOUND' });
  if (row.status !== 'complete' || row.technical_status !== 'passed') throw Object.assign(new Error('Only technically verified footage can receive film QA.'), { code: 'OPEN_RENDER_REVIEW_NOT_READY' });
  const continuity = text(input.continuity_status, row.continuity_status);
  const editorial = text(input.editorial_status, row.editorial_status);
  const allowed = new Set(['pending', 'approved', 'rejected']);
  if (!allowed.has(continuity) || !allowed.has(editorial)) throw new Error('Review status must be pending, approved, or rejected.');
  const notes = text(input.notes).slice(0, 1000) || null;
  if (continuity === 'rejected' && row.continuity_status !== 'rejected') recordFailure(db, job, { shot_id: row.shot_id, render_id: renderId, failure_class: 'OPEN_RENDER_CONTINUITY_REJECTED', message: notes || 'Human continuity review rejected this shot.' });
  if (editorial === 'rejected' && row.editorial_status !== 'rejected') recordFailure(db, job, { shot_id: row.shot_id, render_id: renderId, failure_class: 'OPEN_RENDER_EDITORIAL_REJECTED', message: notes || 'Human editorial review rejected this shot.' });
  const receipt = JSON.parse(row.receipt_json || '{}');
  receipt.qa = { ...(receipt.qa || {}), technical: 'passed', continuity, editorial };
  receipt.reviewed_at = Date.now();
  db.prepare(`UPDATE story_video_open_renders SET continuity_status=?,editorial_status=?,review_notes=?,receipt_json=?,updated_at=? WHERE render_id=?`).run(continuity, editorial, notes, JSON.stringify(receipt), Date.now(), renderId);
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_render.reviewed', payload: { job_id: job.job_id, shot_id: row.shot_id, render_id: renderId, continuity_status: continuity, editorial_status: editorial } });
  return publicRender(db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId), job);
}

export async function renderOpenVideoShot(db, jobId, shotId, options = {}) {
  const submitted = await submitOpenVideoShot(db, jobId, shotId, options);
  const deadline = Date.now() + boundedInt(options.timeout_ms, DEFAULT_TIMEOUT_MS, 30_000, 60 * 60 * 1000);
  let current = submitted;
  while (!['complete', 'failed'].includes(current.status) && Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, DEFAULT_POLL_MS));
    current = await pollOpenVideoRender(db, submitted.render_id);
  }
  if (!['complete', 'failed'].includes(current.status)) throw Object.assign(new Error('ComfyUI render timed out.'), { code: 'OPEN_RENDER_COMPUTE_TIMEOUT' });
  return current;
}

export async function renderOpenVideoShotSet(db, jobId, options = {}) {
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  const requested = Array.isArray(options.shot_ids) && options.shot_ids.length ? new Set(options.shot_ids.map(String)) : null;
  const results = [];
  for (const shot of job.blueprint?.shots || []) {
    if (requested && !requested.has(shot.shot_id)) continue;
    try { results.push({ shot_id: shot.shot_id, status: 'complete', render: await renderOpenVideoShot(db, jobId, shot.shot_id, options) }); }
    catch (error) {
      results.push({ shot_id: shot.shot_id, status: 'failed', failures: error.failure_receipts || [{ failure_class: error.code || 'OPEN_RENDER_FAILED', safe_message: 'Render failed.' }] });
      if (options.continue_on_failure !== true) break;
    }
  }
  return { job_id: jobId, continuity_cookie: createContinuityCookie(job).value, results, complete: results.length > 0 && results.every(item => item.status === 'complete'), authority_granted: false };
}

export function listOpenVideoRenders(db, jobId) {
  ensureOpenVideoRendererSchema(db);
  const job = getStoryVideoJob(db, jobId);
  if (!job) return null;
  const current = createContinuityCookie(job);
  const renders = db.prepare(`SELECT * FROM story_video_open_renders WHERE job_id=? ORDER BY created_at DESC`).all(jobId).map(row => publicRender(row, job));
  const failures = db.prepare(`SELECT failure_id,shot_id,render_id,continuity_cookie,failure_class,safe_message,created_at FROM story_video_render_failures WHERE job_id=? ORDER BY created_at DESC`).all(jobId);
  return { job_id: jobId, continuity_cookie: current, renders, failures, authority_granted: false };
}

export function getOpenVideoRender(db, renderId) {
  ensureOpenVideoRendererSchema(db);
  const row = db.prepare('SELECT * FROM story_video_open_renders WHERE render_id=?').get(renderId);
  if (!row) return null;
  return publicRender(row, getStoryVideoJob(db, row.job_id));
}

export function getOpenVideoRenderFile(db, renderId) {
  ensureOpenVideoRendererSchema(db);
  const row = db.prepare(`SELECT * FROM story_video_open_renders WHERE render_id=? AND status='complete'`).get(renderId);
  if (!row || !row.output_path || !existsSync(row.output_path)) return null;
  return { path: row.output_path, filename: basename(row.output_path), row };
}

function latestApprovedShotFiles(db, job) {
  const cookie = createContinuityCookie(job).value;
  return (job.blueprint?.shots || []).map(shot => {
    const row = db.prepare(`SELECT * FROM story_video_open_renders WHERE job_id=? AND shot_id=? AND continuity_cookie=? AND status='complete' AND technical_status='passed' AND continuity_status='approved' AND editorial_status='approved' ORDER BY created_at DESC LIMIT 1`).get(job.job_id, shot.shot_id, cookie);
    return { shot_id: shot.shot_id, row: row && row.output_path && existsSync(row.output_path) ? row : null };
  });
}

export function assembleOpenVideoMaster(db, jobId) {
  ensureOpenVideoRendererSchema(db);
  const job = getStoryVideoJob(db, jobId);
  assertJobReady(job);
  assertMediaTooling();
  const entries = latestApprovedShotFiles(db, job);
  const missing = entries.filter(item => !item.row).map(item => item.shot_id);
  if (missing.length) {
    const failure = recordFailure(db, job, { failure_class: 'OPEN_RENDER_SHOTS_NOT_APPROVED', message: `Current continuity cookie lacks approved footage for: ${missing.join(', ')}` });
    const error = new Error(failure.safe_message);
    error.code = failure.failure_class;
    error.failure_receipts = [failure];
    error.missing_shots = missing;
    throw error;
  }

  const dims = dimensionsFor(job.blueprint?.aspect_ratio || '16:9');
  const work = mkdtempSync(join(tmpdir(), 'leevize-assemble-'));
  try {
    const normalized = [];
    for (let index = 0; index < entries.length; index += 1) {
      const target = join(work, `shot-${String(index + 1).padStart(2, '0')}.mp4`);
      const filter = `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,fps=${DEFAULT_FPS}`;
      const result = spawnSync(ffmpegBinary(), ['-y', '-v', 'error', '-i', entries[index].row.output_path, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-vf', filter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', target], { encoding: 'utf8' });
      if (result.error || result.status !== 0) throw Object.assign(new Error('Shot normalization failed.'), { code: 'OPEN_RENDER_ASSEMBLY_NORMALIZE_FAILED' });
      normalized.push(target);
    }
    const listPath = join(work, 'concat.txt');
    writeFileSync(listPath, normalized.map(path => `file '${path.replaceAll("'", "'\\''")}'`).join('\n'));
    const dir = join(outputRoot(), job.workspace_id, job.job_id);
    mkdirSync(dir, { recursive: true });
    const continuity = createContinuityCookie(job);
    const masterPath = join(dir, `master-${continuity.value}.mp4`);
    const concat = spawnSync(ffmpegBinary(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', masterPath], { encoding: 'utf8' });
    if (concat.error || concat.status !== 0) throw Object.assign(new Error('Master assembly failed.'), { code: 'OPEN_RENDER_ASSEMBLY_FAILED' });
    const mediaProbe = probeMedia(masterPath);
    const bytes = readFileSync(masterPath);
    const outputSha = hashBytes(bytes);
    const proof = createProofCookie(job, { evidence_class: 'assembled_open_weight_picture_lock', output_sha256: outputSha, renderer: `${RENDERER}+ffmpeg`, media_probe: mediaProbe });
    const renderId = `open_master_${randomUUID()}`;
    const now = Date.now();
    const receipt = {
      schema_version: '2.0.0',
      render_id: renderId,
      job_id: job.job_id,
      workspace_id: job.workspace_id,
      shot_id: '__master__',
      kind: 'picture_lock',
      renderer: `${RENDERER}+ffmpeg`,
      continuity_cookie: continuity.value,
      proof_cookie: proof.value,
      output_sha256: outputSha,
      media_probe: mediaProbe,
      shot_count: entries.length,
      vendor_credit_required: false,
      picture_lock: true,
      release_ready: false,
      audio: { status: 'silent_picture_lock', required_before_release: true },
      captions: { status: 'pending_final_audio', required_before_release: true },
      authority_granted: false,
      created_at: now
    };
    db.prepare(`INSERT INTO story_video_open_renders (
      render_id,job_id,workspace_id,shot_id,continuity_cookie,proof_cookie,status,renderer,workflow_sha256,model_id,output_path,output_sha256,
      technical_status,continuity_status,editorial_status,receipt_json,failure_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,'complete',?,?,?,?,?,'passed','approved','pending',?,'{}',?,?)`).run(
      renderId, job.job_id, job.workspace_id, '__master__', continuity.value, proof.value, `${RENDERER}+ffmpeg`, hashJson(entries.map(item => item.row.output_sha256)), modelConfig().id,
      masterPath, outputSha, JSON.stringify(receipt), now, now
    );
    log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: 'video.open_master.completed', payload: { job_id: job.job_id, render_id: renderId, continuity_cookie: continuity.value, proof_cookie: proof.value, output_sha256: outputSha, shot_count: entries.length, release_ready: false } });
    return getOpenVideoRender(db, renderId);
  } catch (error) {
    const failure = recordFailure(db, job, { failure_class: error.code || 'OPEN_RENDER_ASSEMBLY_FAILED', message: safeMessage(error, 'Open video assembly failed.') });
    error.failure_receipts = [failure];
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
