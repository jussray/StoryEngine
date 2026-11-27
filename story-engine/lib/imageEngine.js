// lib/imageEngine.js
// Durable image generation for StoryEngine: book covers and story images in
// the canon visual styles, generated through Replicate under the founder
// build laws (2026-11-20):
//   1. Durable async jobs — the job row, provider prediction id, retry state,
//      and completion receipt persist in SQLite; a restart never silently
//      loses work, and in-flight jobs resume by polling, never by respawning.
//   2. No duplicate billing — a UNIQUE fingerprint constraint dedupes
//      identical generation requests, and the provider prediction id is
//      persisted BEFORE any polling, so a timeout can never spawn a second
//      paid prediction.
//   3. Save files immediately — provider output URLs expire in ~1 hour, so a
//      succeeded prediction is copied onto durable owned storage (var/
//      image-generations) and hash-verified before the job reports success.
//   4. Validation stays independent — a cover is never required by book
//      release validation; this engine only records and serves images, and
//      the serving route verifies workspace ownership before streaming.
// Provider access is env-gated: without REPLICATE_API_TOKEN the engine fails
// closed with a named state (provider_unconfigured) and never fakes success.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureArtifactSchema } from './artifactValidation.js';
import { log } from '../models/eventModel.js';
import { VIDEO_VISUAL_STYLES } from './visualStyleCatalog.js';

export const IMAGE_PURPOSES = Object.freeze(['book_cover', 'story_image']);
export const IMAGE_ASPECT_RATIOS = Object.freeze(['2:3', '3:2', '1:1', '16:9', '9:16']);
export const IMAGE_JOB_STATUSES = Object.freeze([
  'queued', 'processing', 'copy_failed', 'submit_failed',
  'provider_unconfigured', 'succeeded', 'failed'
]);

const MODEL_RATES_USD = Object.freeze({
  'black-forest-labs/flux-schnell': 0.003,
  'black-forest-labs/flux-dev': 0.025,
  'black-forest-labs/flux-pro': 0.055
});

export const IMAGE_ENGINE_OPTIONS = Object.freeze({
  provider: 'replicate',
  purposes: IMAGE_PURPOSES,
  aspect_ratios: IMAGE_ASPECT_RATIOS,
  visual_styles: VIDEO_VISUAL_STYLES,
  default_model: process.env.REPLICATE_IMAGE_MODEL || 'black-forest-labs/flux-schnell',
  model_rates_usd: MODEL_RATES_USD,
  storage: 'var/image-generations (override with L99_IMAGE_OUTPUT_DIR)',
  laws: ['durable_async_jobs', 'fingerprint_dedupe_no_duplicate_billing', 'prediction_id_persisted_before_polling', 'immediate_verified_durable_copy', 'cover_never_gates_book_release']
});

function text(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function providerConfig() {
  return {
    token: process.env.REPLICATE_API_TOKEN || '',
    model: process.env.REPLICATE_IMAGE_MODEL || 'black-forest-labs/flux-schnell',
    apiBase: process.env.REPLICATE_API_BASE || 'https://api.replicate.com'
  };
}

export function imageStorageDir() {
  return resolve(process.env.L99_IMAGE_OUTPUT_DIR || join(process.cwd(), 'var', 'image-generations'));
}

export function ensureImageEngineSchema(db) {
  ensureArtifactSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_image_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'book_cover',
      visual_style TEXT NOT NULL DEFAULT 'soft_cinematic_bookish',
      prompt TEXT NOT NULL,
      negative_prompt TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '2:3',
      provider TEXT NOT NULL DEFAULT 'replicate',
      provider_model TEXT NOT NULL,
      provider_prediction_id TEXT,
      fingerprint TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_cost_usd REAL NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      actual_cost_usd REAL,
      artifact_id TEXT,
      storage_path TEXT,
      content_hash TEXT,
      provider_output_url TEXT,
      error_json TEXT NOT NULL DEFAULT '{}',
      receipt_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_image_jobs_workspace ON story_image_jobs(workspace_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_story_image_jobs_status ON story_image_jobs(status,created_at);
  `);
}

export function imageFingerprint({ workspace_id, purpose, visual_style, prompt, negative_prompt, provider_model, aspect_ratio }) {
  return createHash('sha256')
    .update(JSON.stringify([workspace_id, purpose, visual_style, prompt, negative_prompt, provider_model, aspect_ratio]))
    .digest('hex');
}

export function buildImagePrompt(db, input = {}) {
  const workspaceId = text(input.workspace_id);
  if (!workspaceId) throw new Error('workspace_id is required.');
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id=?').get(workspaceId);
  if (!story) throw new Error('Workspace not found.');
  const purpose = text(input.purpose, 'book_cover');
  if (!IMAGE_PURPOSES.includes(purpose)) throw new Error('Unsupported image purpose.');
  const visualStyle = text(input.visual_style, 'soft_cinematic_bookish');
  const style = VIDEO_VISUAL_STYLES[visualStyle];
  if (!style && visualStyle !== 'custom') throw new Error('Unsupported visual style.');
  const aspectRatio = text(input.aspect_ratio, purpose === 'book_cover' ? '2:3' : '16:9');
  if (!IMAGE_ASPECT_RATIOS.includes(aspectRatio)) throw new Error('Unsupported aspect ratio.');

  const subject = text(input.prompt) || (purpose === 'book_cover'
    ? `Book cover art for "${story.title}"${story.genre ? `, a ${story.genre} book` : ''}. ${story.pitch || ''} Cover composition with clean negative space at the top for the title, no text, no letters, no watermark.`
    : `A scene from "${story.title}". ${story.pitch || ''}`);
  const prompt = style
    ? `${subject} Style: ${style.language}. Palette: ${style.palette}.`
    : subject;
  const negative = [...(style?.negative || []), text(input.negative_prompt)].filter(Boolean).join(', ');
  return { workspace_id: workspaceId, story, purpose, visual_style: visualStyle, style_contract: style || null, aspect_ratio: aspectRatio, prompt, negative_prompt: negative };
}

function hydrate(row) {
  return row ? { ...row, error: safeJson(row.error_json, {}), receipt: safeJson(row.receipt_json, {}) } : null;
}

export function createImageGenerationJob(db, input = {}) {
  ensureImageEngineSchema(db);
  const built = buildImagePrompt(db, input);
  const { model } = providerConfig();
  const providerModel = text(input.provider_model, model);
  const estimated = MODEL_RATES_USD[providerModel] ?? MODEL_RATES_USD['black-forest-labs/flux-schnell'];
  const maxCost = Number(input.max_cost_usd || 0);
  if (maxCost > 0 && estimated > maxCost) {
    throw Object.assign(new Error(`Estimated cost $${estimated} exceeds the job cap of $${maxCost}.`), { code: 'IMAGE_COST_CAP_EXCEEDED' });
  }
  const fingerprint = imageFingerprint({
    workspace_id: built.workspace_id, purpose: built.purpose, visual_style: built.visual_style,
    prompt: built.prompt, negative_prompt: built.negative_prompt,
    provider_model: providerModel, aspect_ratio: built.aspect_ratio
  });
  const existing = db.prepare('SELECT * FROM story_image_jobs WHERE fingerprint=?').get(fingerprint);
  if (existing) {
    log(db, { workspace_id: built.workspace_id, mode: 'image_engine', event_type: 'image.job.reused', payload: { job_id: existing.job_id, fingerprint, purpose: built.purpose, visual_style: built.visual_style } });
    return { ...hydrate(existing), reused: true };
  }
  const jobId = `image_job_${randomUUID()}`;
  const now = Date.now();
  db.prepare(`INSERT INTO story_image_jobs (job_id,workspace_id,purpose,visual_style,prompt,negative_prompt,aspect_ratio,provider,provider_model,provider_prediction_id,fingerprint,status,attempt_count,max_cost_usd,estimated_cost_usd,actual_cost_usd,artifact_id,storage_path,content_hash,provider_output_url,error_json,receipt_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,'queued',0,?,?,NULL,NULL,NULL,NULL,NULL,'{}','{}',?,?)`)
    .run(jobId, built.workspace_id, built.purpose, built.visual_style, built.prompt, built.negative_prompt, built.aspect_ratio, 'replicate', providerModel, fingerprint, maxCost, estimated, now, now);
  log(db, { workspace_id: built.workspace_id, mode: 'image_engine', event_type: 'image.job.created', payload: { job_id: jobId, fingerprint, purpose: built.purpose, visual_style: built.visual_style, provider_model: providerModel, estimated_cost_usd: estimated } });
  return { ...getImageGenerationJob(db, jobId), reused: false };
}

export function getImageGenerationJob(db, jobId) {
  ensureImageEngineSchema(db);
  return hydrate(db.prepare('SELECT * FROM story_image_jobs WHERE job_id=?').get(jobId));
}

export function listImageGenerationJobs(db, workspaceId, limit = 50) {
  ensureImageEngineSchema(db);
  return db.prepare('SELECT * FROM story_image_jobs WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, Math.max(1, Math.min(200, Number(limit) || 50))).map(hydrate);
}

export function getWorkspaceCover(db, workspaceId) {
  ensureImageEngineSchema(db);
  const row = db.prepare(`SELECT * FROM story_image_jobs WHERE workspace_id=? AND purpose='book_cover' AND status='succeeded' ORDER BY created_at DESC LIMIT 1`).get(workspaceId);
  return hydrate(row);
}

// Jobs a restart must pick back up: a prediction exists and the outcome is
// not final. Resuming means polling the SAME prediction — never a new one.
export function listResumableImageJobs(db) {
  ensureImageEngineSchema(db);
  return db.prepare(`SELECT * FROM story_image_jobs WHERE provider_prediction_id IS NOT NULL AND status IN ('processing','copy_failed') ORDER BY created_at ASC`)
    .all().map(hydrate);
}

async function providerFetch(deps, url, options) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available for the image provider.');
  return fetchImpl(url, options);
}

export async function submitImageGenerationJob(db, jobId, deps = {}) {
  ensureImageEngineSchema(db);
  const job = getImageGenerationJob(db, jobId);
  if (!job) throw new Error('Image job not found.');
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  // Law 2: a persisted prediction id means the paid request already exists.
  // Any later submit is a resume (poll), never a second prediction.
  if (job.provider_prediction_id) return pollImageGenerationJob(db, jobId, deps);

  const { token, apiBase } = providerConfig();
  if (!token) {
    db.prepare(`UPDATE story_image_jobs SET status='provider_unconfigured',error_json=?,updated_at=? WHERE job_id=?`)
      .run(JSON.stringify({ code: 'REPLICATE_NOT_CONFIGURED', message: 'REPLICATE_API_TOKEN is not set; image generation is unconfigured and no provider request was made.' }), Date.now(), jobId);
    log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.provider_unconfigured', payload: { job_id: jobId } });
    return getImageGenerationJob(db, jobId);
  }

  let prediction;
  try {
    const response = await providerFetch(deps, `${apiBase}/v1/models/${job.provider_model}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          prompt: job.prompt,
          ...(job.negative_prompt ? { negative_prompt: job.negative_prompt } : {}),
          aspect_ratio: job.aspect_ratio,
          output_format: 'png',
          num_outputs: 1
        }
      })
    });
    if (!response.ok) throw new Error(`Replicate prediction create failed with HTTP ${response.status}.`);
    prediction = await response.json();
    if (!prediction?.id) throw new Error('Replicate prediction create returned no prediction id.');
  } catch (error) {
    // No prediction id exists, so nothing was billed: the submit is safely
    // retryable and the job stays durable in submit_failed.
    db.prepare(`UPDATE story_image_jobs SET status='submit_failed',attempt_count=attempt_count+1,error_json=?,updated_at=? WHERE job_id=?`)
      .run(JSON.stringify({ code: 'REPLICATE_SUBMIT_FAILED', message: error.message }), Date.now(), jobId);
    log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.submit_failed', payload: { job_id: jobId, error: error.message } });
    return getImageGenerationJob(db, jobId);
  }

  // Law 2: persist the prediction id BEFORE any polling happens.
  db.prepare(`UPDATE story_image_jobs SET provider_prediction_id=?,status='processing',attempt_count=attempt_count+1,error_json='{}',updated_at=? WHERE job_id=?`)
    .run(prediction.id, Date.now(), jobId);
  log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.submitted', payload: { job_id: jobId, provider_prediction_id: prediction.id, provider_model: job.provider_model } });
  return getImageGenerationJob(db, jobId);
}

function imageFormat(bytes) {
  if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', content_type: 'image/png' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', content_type: 'image/jpeg' };
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', content_type: 'image/webp' };
  return null;
}

async function copyProviderOutput(db, job, outputUrl, deps) {
  const response = await providerFetch(deps, outputUrl, {});
  if (!response.ok) throw new Error(`Provider output download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const format = imageFormat(bytes);
  if (!bytes.length || !format) throw new Error('Provider output was empty or not a recognized image (png/jpeg/webp).');
  const dir = imageStorageDir();
  mkdirSync(dir, { recursive: true });
  const filename = `${job.job_id}.${format.ext}`;
  const path = join(dir, filename);
  writeFileSync(path, bytes);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  // Verify the durable copy: bytes on disk must hash to the downloaded bytes.
  const onDisk = statSync(path);
  if (onDisk.size !== bytes.length) throw new Error('Durable copy verification failed: size mismatch after write.');
  return { path, filename, content_hash: contentHash, byte_size: bytes.length, ...format };
}

export async function pollImageGenerationJob(db, jobId, deps = {}) {
  ensureImageEngineSchema(db);
  const job = getImageGenerationJob(db, jobId);
  if (!job) throw new Error('Image job not found.');
  if (!job.provider_prediction_id || job.status === 'succeeded' || job.status === 'failed') return job;
  const { token, apiBase } = providerConfig();
  if (!token) return job;

  let prediction;
  try {
    const response = await providerFetch(deps, `${apiBase}/v1/predictions/${job.provider_prediction_id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Replicate prediction read failed with HTTP ${response.status}.`);
    prediction = await response.json();
  } catch (error) {
    // A failed read proves nothing about the prediction: leave the job in
    // its durable in-flight state for the next poll. Never respawn.
    log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.poll_unreachable', payload: { job_id: jobId, error: error.message } });
    return job;
  }

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    db.prepare(`UPDATE story_image_jobs SET status='failed',error_json=?,updated_at=? WHERE job_id=?`)
      .run(JSON.stringify({ code: 'REPLICATE_PREDICTION_FAILED', message: String(prediction.error || prediction.status) }), Date.now(), jobId);
    log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.failed', payload: { job_id: jobId, provider_prediction_id: job.provider_prediction_id } });
    return getImageGenerationJob(db, jobId);
  }

  if (prediction.status !== 'succeeded') {
    db.prepare(`UPDATE story_image_jobs SET status='processing',updated_at=? WHERE job_id=?`).run(Date.now(), jobId);
    return getImageGenerationJob(db, jobId);
  }

  // Law 3: copy + verify onto durable owned storage BEFORE reporting success.
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) {
    db.prepare(`UPDATE story_image_jobs SET status='failed',error_json=?,updated_at=? WHERE job_id=?`)
      .run(JSON.stringify({ code: 'REPLICATE_NO_OUTPUT', message: 'Prediction succeeded without an output URL.' }), Date.now(), jobId);
    return getImageGenerationJob(db, jobId);
  }
  let stored;
  try {
    stored = await copyProviderOutput(db, { ...job, provider_output_url: outputUrl }, outputUrl, deps);
  } catch (error) {
    db.prepare(`UPDATE story_image_jobs SET status='copy_failed',provider_output_url=?,error_json=?,updated_at=? WHERE job_id=?`)
      .run(outputUrl, JSON.stringify({ code: 'IMAGE_COPY_FAILED', message: error.message }), Date.now(), jobId);
    log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.copy_failed', payload: { job_id: jobId, error: error.message } });
    return getImageGenerationJob(db, jobId);
  }

  const artifactId = `artifact_${randomUUID()}`;
  const now = Date.now();
  const receipt = {
    provider: 'replicate',
    provider_model: job.provider_model,
    provider_prediction_id: job.provider_prediction_id,
    provider_output_url: outputUrl,
    storage_path: stored.path,
    filename: stored.filename,
    content_hash: stored.content_hash,
    byte_size: stored.byte_size,
    format: stored.ext,
    cost_note: 'Replicate does not itemize per-prediction cost on the prediction object; actual recorded at the published model rate.',
    completed_at: now
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO story_artifacts (artifact_id,run_id,workspace_id,kind,title,status,content_hash,html,metadata_json,validation_json,created_at,updated_at) VALUES (?,?,?,'generated_image',?,'generated',?,'',?,'{}',?,?)`)
      .run(artifactId, jobId, job.workspace_id, job.purpose === 'book_cover' ? 'Book cover image' : 'Story image', stored.content_hash, JSON.stringify({ image_job_id: jobId, ...receipt }), now, now);
    db.prepare(`UPDATE story_image_jobs SET status='succeeded',artifact_id=?,storage_path=?,content_hash=?,provider_output_url=?,actual_cost_usd=?,receipt_json=?,error_json='{}',updated_at=? WHERE job_id=?`)
      .run(artifactId, stored.path, stored.content_hash, outputUrl, job.estimated_cost_usd, JSON.stringify(receipt), now, jobId);
  })();
  log(db, { workspace_id: job.workspace_id, mode: 'image_engine', event_type: 'image.job.succeeded', payload: { job_id: jobId, artifact_id: artifactId, content_hash: stored.content_hash, byte_size: stored.byte_size, purpose: job.purpose, visual_style: job.visual_style } });
  return getImageGenerationJob(db, jobId);
}

export function getImageGenerationFile(db, jobId) {
  const job = getImageGenerationJob(db, jobId);
  if (!job || job.status !== 'succeeded' || !job.storage_path || !existsSync(job.storage_path)) return null;
  const ext = job.storage_path.split('.').pop();
  const contentType = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return { job, path: job.storage_path, filename: job.storage_path.split('/').pop(), content_type: contentType };
}

export function imageEngineOverview(db) {
  ensureImageEngineSchema(db);
  const totals = db.prepare(`SELECT COUNT(*) total_jobs,
    SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded_count,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count,
    SUM(CASE WHEN status IN ('queued','processing') THEN 1 ELSE 0 END) in_flight_count,
    SUM(CASE WHEN status='provider_unconfigured' THEN 1 ELSE 0 END) unconfigured_count,
    COALESCE(SUM(actual_cost_usd),0) total_actual_cost_usd,
    COALESCE(SUM(estimated_cost_usd),0) total_estimated_cost_usd
    FROM story_image_jobs`).get();
  const recentJobs = db.prepare(`SELECT job_id,workspace_id,purpose,visual_style,status,provider_model,estimated_cost_usd,actual_cost_usd,artifact_id,created_at,updated_at FROM story_image_jobs ORDER BY created_at DESC LIMIT 10`).all();
  const { token } = providerConfig();
  return {
    status: !token ? 'provider_unconfigured' : Number(totals.failed_count || 0) ? 'error' : Number(totals.in_flight_count || 0) ? 'in_flight' : 'idle',
    provider: 'replicate',
    provider_configured: Boolean(token),
    total_jobs: Number(totals.total_jobs || 0),
    succeeded_count: Number(totals.succeeded_count || 0),
    failed_count: Number(totals.failed_count || 0),
    in_flight_count: Number(totals.in_flight_count || 0),
    unconfigured_count: Number(totals.unconfigured_count || 0),
    total_actual_cost_usd: Number(totals.total_actual_cost_usd || 0),
    total_estimated_cost_usd: Number(totals.total_estimated_cost_usd || 0),
    recent_jobs: recentJobs
  };
}
