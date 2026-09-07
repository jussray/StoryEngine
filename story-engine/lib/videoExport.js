// lib/videoExport.js
// Deterministic, zero-provider MP4 assembly for validated Story Video jobs.

import { createHash, randomUUID } from 'node:crypto';
import {
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

import { getStoryVideoJob } from './videoEngine.js';
import { log } from '../models/eventModel.js';

const EXPORT_SCHEMA_VERSION = '1.0.0';
const RENDERER_VERSION = 'ffmpeg_ken_burns_v1';
const DEFAULT_SCENE_COUNT = 6;
const DEFAULT_DURATION_SECONDS = 30;
const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function text(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function ffmpegBinary() {
  return text(process.env.L99_VIDEO_FFMPEG_BINARY, 'ffmpeg');
}

function outputDirectory() {
  return resolve(process.env.L99_VIDEO_OUTPUT_DIR || join(process.cwd(), 'var', 'video-exports'));
}

function assertFfmpegAvailable() {
  const probe = spawnSync(ffmpegBinary(), ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    const error = new Error('ffmpeg is required for deterministic MP4 export.');
    error.code = 'FFMPEG_UNAVAILABLE';
    throw error;
  }
}

export function ensureVideoExportSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_video_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      export_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      renderer TEXT NOT NULL,
      output_path TEXT,
      content_hash TEXT,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      scene_count INTEGER NOT NULL DEFAULT 0,
      actual_cost_usd REAL NOT NULL DEFAULT 0,
      receipt_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_video_exports_job_fingerprint
      ON story_video_exports(job_id, fingerprint);
    CREATE INDEX IF NOT EXISTS idx_story_video_exports_workspace
      ON story_video_exports(workspace_id, created_at);
  `);
}

function normalizedScenes(blueprint, sceneCount, durationSeconds) {
  const sourceShots = Array.isArray(blueprint?.shots) ? blueprint.shots.filter(Boolean) : [];
  if (!sourceShots.length) throw new Error('Validated video blueprint has no shots to render.');
  const perScene = durationSeconds / sceneCount;
  return Array.from({ length: sceneCount }, (_, index) => {
    const source = sourceShots[index % sourceShots.length];
    return {
      scene_index: index + 1,
      source_shot_id: source.shot_id || null,
      duration_seconds: perScene,
      narration: text(source.narration || source.action, 'Story scene'),
      emotion: text(source.emotion, 'story'),
      intensity: text(source.intensity, 'medium'),
      camera_move: text(source.camera_move, index % 2 ? 'pan_right' : 'push_in'),
      characters: Array.isArray(source.characters) ? source.characters.slice(0, 3) : []
    };
  });
}

function visualBibleHash(blueprint) {
  return hash({
    characters: blueprint.character_bible || [],
    world: blueprint.world_bible || {},
    visual_style: blueprint.visual_style,
    aspect_ratio: blueprint.aspect_ratio
  });
}

function parseHexColor(value, fallback) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  const hex = match ? match[1] : fallback.replace('#', '');
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function setPixel(buffer, width, height, x, y, rgb) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 3;
  buffer[offset] = rgb[0];
  buffer[offset + 1] = rgb[1];
  buffer[offset + 2] = rgb[2];
}

function fillCircle(buffer, width, height, centerX, centerY, radius, rgb) {
  const r2 = radius * radius;
  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) <= r2) setPixel(buffer, width, height, x, y, rgb);
    }
  }
}

function fillRect(buffer, width, height, x0, y0, x1, y1, rgb) {
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      setPixel(buffer, width, height, x, y, rgb);
    }
  }
}

function deterministicFramePpm(blueprint, scene, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const theme = blueprint.preview_theme || {};
  const bg = parseHexColor(theme.bg, '#09080d');
  const accent = parseHexColor(theme.accent, '#a77cff');
  const panel = parseHexColor(theme.panel, '#15121d');
  const pixels = Buffer.alloc(width * height * 3);
  const seed = createHash('sha256')
    .update(`${visualBibleHash(blueprint)}:${scene.scene_index}:${scene.source_shot_id || ''}`)
    .digest();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const depth = y / Math.max(1, height - 1);
      const shimmer = ((x + (scene.scene_index * 29)) % 97) / 97;
      const rgb = [0, 1, 2].map(channel => Math.max(0, Math.min(255,
        Math.round((bg[channel] * (1 - depth * 0.35)) + (panel[channel] * depth * 0.35) + (accent[channel] * shimmer * 0.05))
      )));
      setPixel(pixels, width, height, x, y, rgb);
    }
  }

  const glowX = Math.round(width * (0.62 + ((seed[0] / 255) * 0.18)));
  const glowY = Math.round(height * (0.18 + ((seed[1] / 255) * 0.18)));
  fillCircle(pixels, width, height, glowX, glowY, Math.round(height * 0.12), accent);

  const horizon = Math.round(height * 0.72);
  fillRect(pixels, width, height, 0, horizon, width, height, panel);
  const characterCount = Math.max(1, Math.min(3, scene.characters.length || blueprint.character_bible?.length || 1));
  for (let index = 0; index < characterCount; index += 1) {
    const x = Math.round(width * (0.25 + (index * 0.22)) + ((scene.scene_index % 3) - 1) * 5);
    const bodyTop = Math.round(height * 0.46);
    const bodyBottom = Math.round(height * 0.76);
    const bodyWidth = Math.round(width * 0.055);
    const characterHash = createHash('sha256')
      .update(text(scene.characters[index] || blueprint.character_bible?.[index]?.name, `character-${index}`))
      .digest();
    const color = [
      Math.min(255, 80 + characterHash[0] % 150),
      Math.min(255, 80 + characterHash[1] % 150),
      Math.min(255, 80 + characterHash[2] % 150)
    ];
    fillRect(pixels, width, height, x - bodyWidth, bodyTop, x + bodyWidth, bodyBottom, color);
    fillCircle(pixels, width, height, x, bodyTop - Math.round(height * 0.05), Math.round(height * 0.045), color);
  }

  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  return Buffer.concat([header, pixels]);
}

function srtTimestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function captionsFor(scenes) {
  let elapsed = 0;
  return scenes.map((scene, index) => {
    const start = elapsed;
    elapsed += scene.duration_seconds;
    const body = text(scene.narration, 'Story scene').replace(/-->/g, '→');
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(elapsed)}\n${body}\n`;
  }).join('\n');
}

function exportFingerprint(job, options) {
  return hash({
    schema_version: EXPORT_SCHEMA_VERSION,
    renderer: RENDERER_VERSION,
    source_revision_id: job.source_revision_id,
    blueprint_hash: hash(job.blueprint || {}),
    scene_count: options.scene_count,
    duration_seconds: options.duration_seconds,
    fps: options.fps,
    width: options.width,
    height: options.height,
    provider_generation: false,
    narration_mode: 'caption_track_with_silent_audio_fallback'
  });
}

function hydrate(row, reused = false) {
  if (!row) return null;
  const receipt = safeJson(row.receipt_json, {});
  return {
    export_id: row.export_id,
    job_id: row.job_id,
    workspace_id: row.workspace_id,
    fingerprint: row.fingerprint,
    status: row.status,
    renderer: row.renderer,
    content_hash: row.content_hash || null,
    byte_size: Number(row.byte_size || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    scene_count: Number(row.scene_count || 0),
    actual_cost_usd: Number(row.actual_cost_usd || 0),
    receipt,
    reused,
    download_url: row.status === 'complete' ? `/api/video-engine/exports/${encodeURIComponent(row.export_id)}/mp4` : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function getStoryVideoExport(db, exportId) {
  ensureVideoExportSchema(db);
  return hydrate(db.prepare('SELECT * FROM story_video_exports WHERE export_id=?').get(exportId));
}

export function getStoryVideoExportFile(db, exportId) {
  ensureVideoExportSchema(db);
  const row = db.prepare('SELECT * FROM story_video_exports WHERE export_id=?').get(exportId);
  if (!row || row.status !== 'complete' || !row.output_path || !existsSync(row.output_path)) return null;
  return { path: row.output_path, filename: basename(row.output_path), export: hydrate(row) };
}

export async function renderStoryVideoExport(db, jobId, input = {}) {
  ensureVideoExportSchema(db);
  const job = getStoryVideoJob(db, jobId);
  if (!job) throw new Error('Video job not found.');
  if (job.status !== 'validated') throw new Error('Video job must pass Playwright validation before MP4 export.');
  if (Number(job.estimated_cost_usd || 0) !== 0 || Number(job.actual_cost_usd || 0) !== 0) {
    throw new Error('Zero-provider export refuses a job with non-zero provider cost.');
  }

  const options = {
    scene_count: clampInt(input.scene_count, 1, 12, DEFAULT_SCENE_COUNT),
    duration_seconds: clampInt(input.duration_seconds, 5, 60, DEFAULT_DURATION_SECONDS),
    fps: clampInt(input.fps, 12, 60, DEFAULT_FPS),
    width: clampInt(input.width, 320, 1920, DEFAULT_WIDTH),
    height: clampInt(input.height, 180, 1080, DEFAULT_HEIGHT)
  };
  if (options.duration_seconds % options.scene_count !== 0) {
    throw new Error('duration_seconds must divide evenly by scene_count for deterministic export.');
  }

  const fingerprint = exportFingerprint(job, options);
  const existing = db.prepare('SELECT * FROM story_video_exports WHERE job_id=? AND fingerprint=?').get(jobId, fingerprint);
  if (existing?.status === 'complete' && existing.output_path && existsSync(existing.output_path)) {
    return hydrate(existing, true);
  }

  assertFfmpegAvailable();
  const scenes = normalizedScenes(job.blueprint, options.scene_count, options.duration_seconds);
  const exportId = existing?.export_id || `video_export_${randomUUID()}`;
  const now = Date.now();
  if (existing) {
    db.prepare(`UPDATE story_video_exports SET status='rendering',output_path=NULL,content_hash=NULL,byte_size=0,receipt_json='{}',updated_at=? WHERE export_id=?`).run(now, exportId);
  } else {
    db.prepare(`INSERT INTO story_video_exports (export_id,job_id,workspace_id,fingerprint,status,renderer,output_path,content_hash,byte_size,duration_seconds,scene_count,actual_cost_usd,receipt_json,created_at,updated_at) VALUES (?,?,?,?,'rendering',?,NULL,NULL,0,?,?,0,'{}',?,?)`)
      .run(exportId, jobId, job.workspace_id, fingerprint, RENDERER_VERSION, options.duration_seconds, options.scene_count, now, now);
  }

  const temp = mkdtempSync(join(tmpdir(), 'l99-video-export-'));
  const finalDir = outputDirectory();
  mkdirSync(finalDir, { recursive: true });
  const finalPath = join(finalDir, `${exportId}.mp4`);

  try {
    const framePaths = scenes.map((scene, index) => {
      const framePath = join(temp, `scene-${String(index + 1).padStart(2, '0')}.ppm`);
      writeFileSync(framePath, deterministicFramePpm(job.blueprint, scene, options.width, options.height));
      return framePath;
    });
    const concatPath = join(temp, 'frames.txt');
    writeFileSync(concatPath, framePaths.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n', 'utf8');
    const captionsPath = join(temp, 'captions.srt');
    writeFileSync(captionsPath, captionsFor(scenes), 'utf8');
    const tempOutput = join(temp, 'render.mp4');
    const framesPerScene = Math.round((options.duration_seconds / options.scene_count) * options.fps);
    const filter = `zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${framesPerScene}:s=${options.width}x${options.height}:fps=${options.fps}`;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-f', 'lavfi', '-t', String(options.duration_seconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-i', captionsPath,
      '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0',
      '-vf', filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
      '-t', String(options.duration_seconds), '-movflags', '+faststart', tempOutput
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
      throw new Error(`ffmpeg export failed: ${text(rendered.stderr, 'unknown ffmpeg error')}`);
    }
    renameSync(tempOutput, finalPath);
    const bytes = readFileSync(finalPath);
    const receipt = {
      schema_version: EXPORT_SCHEMA_VERSION,
      export_id: exportId,
      video_job_id: jobId,
      source_revision_id: job.source_revision_id,
      renderer: RENDERER_VERSION,
      renderer_binary: ffmpegBinary(),
      fingerprint,
      visual_bible_hash: visualBibleHash(job.blueprint),
      scene_count: scenes.length,
      duration_seconds: options.duration_seconds,
      fps: options.fps,
      dimensions: { width: options.width, height: options.height },
      frame_source: 'deterministic_storyboard_fallback',
      motion: 'ken_burns_zoompan',
      captions: { format: 'mov_text', embedded: true, source: 'shot_narration' },
      voiceover: { status: 'provider_not_configured', audio_track: 'silent_fallback', narration_preserved_in_captions: true },
      provider_generation: false,
      provider_cost_usd: 0,
      retry_policy: 'idempotent_by_source_revision_blueprint_and_render_profile',
      content_hash: hash(bytes),
      byte_size: bytes.length,
      generated_at: Date.now()
    };
    db.prepare(`UPDATE story_video_exports SET status='complete',output_path=?,content_hash=?,byte_size=?,actual_cost_usd=0,receipt_json=?,updated_at=? WHERE export_id=?`)
      .run(finalPath, receipt.content_hash, receipt.byte_size, JSON.stringify(receipt), Date.now(), exportId);
    log(db, {
      workspace_id: job.workspace_id,
      mode: 'video_engine',
      event_type: 'video.export.completed',
      payload: { export_id: exportId, job_id: jobId, fingerprint, content_hash: receipt.content_hash, byte_size: receipt.byte_size, provider_cost_usd: 0 }
    });
    return getStoryVideoExport(db, exportId);
  } catch (error) {
    const failure = {
      schema_version: EXPORT_SCHEMA_VERSION,
      export_id: exportId,
      video_job_id: jobId,
      fingerprint,
      renderer: RENDERER_VERSION,
      error: text(error.message, 'video export failed'),
      provider_cost_usd: 0,
      failed_at: Date.now()
    };
    db.prepare(`UPDATE story_video_exports SET status='failed',receipt_json=?,updated_at=? WHERE export_id=?`)
      .run(JSON.stringify(failure), Date.now(), exportId);
    log(db, {
      workspace_id: job.workspace_id,
      mode: 'video_engine',
      event_type: 'video.export.failed',
      payload: { export_id: exportId, job_id: jobId, fingerprint, error: failure.error, provider_cost_usd: 0 }
    });
    throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
