// lib/videoEngine.js
// One deterministic story blueprint, multiple render modes and visual styles, zero provider spend.

import { createHash, randomUUID } from 'node:crypto';
import { ensureArtifactSchema } from './artifactValidation.js';
import { log } from '../models/eventModel.js';
import {
  LEGACY_VIDEO_MODE_ALIASES,
  VIDEO_RENDER_MODES,
  VIDEO_VISUAL_STYLES,
  resolveVideoLook
} from './visualStyleCatalog.js';

const MAX_SHOTS = 12;
const MAX_SECONDS = 60;

export const VIDEO_ENGINE_OPTIONS = Object.freeze({
  modes: VIDEO_RENDER_MODES,
  visual_styles: VIDEO_VISUAL_STYLES,
  legacy_mode_aliases: LEGACY_VIDEO_MODE_ALIASES,
  qualities: ['draft', 'standard', 'hero'],
  aspect_ratios: ['16:9', '9:16', '1:1'],
  broke_founder_defaults: {
    max_shots: MAX_SHOTS,
    max_duration_seconds: MAX_SECONDS,
    max_provider_cost_usd: 0,
    hero_video_seconds: 0,
    provider_generation_enabled: false,
    deterministic_preview: true
  }
});

function safeJson(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function text(value, fallback = '') { return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback; }
function html(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function tableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function columnExists(db, tableName, columnName) { return db.prepare(`PRAGMA table_info(${tableName})`).all().some(column => column.name === columnName); }
function sentences(value) { return text(value).split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean); }

function charactersFor(db, workspaceId) {
  if (!tableExists(db, 'memory_characters')) return [];
  return db.prepare(`SELECT char_id,name,role,status,location,arc_stage,traits,data_json FROM memory_characters WHERE workspace_id=? ORDER BY updated_at DESC,id LIMIT 12`).all(workspaceId).map(row => ({
    character_id: row.char_id,
    name: row.name,
    role: row.role || null,
    status: row.status || 'alive',
    location: row.location || null,
    arc_stage: row.arc_stage || null,
    traits: safeJson(row.traits, []),
    locked_visuals: safeJson(row.data_json, {}).locked_visuals || []
  }));
}

function revisionFor(story, chapters, characters) {
  return createHash('sha256').update(JSON.stringify({
    story: { workspace_id: story.workspace_id, title: story.title, pitch: story.pitch, updated_at: story.updated_at },
    chapters: chapters.map(chapter => ({ id: chapter.id, title: chapter.title, content: chapter.content || chapter.text, updated_at: chapter.updated_at })),
    characters
  })).digest('hex');
}

function makeShot(index, chapter, excerpt, look, characterNames, duration) {
  const shotTypes = ['establishing', 'medium', 'closeup', 'over_shoulder', 'insert'];
  const cameraMoves = ['push_in', 'pan_right', 'static', 'pull_out', 'pan_left'];
  const customDirection = look.custom_style_prompt ? ` Creator direction: ${look.custom_style_prompt}` : '';
  return {
    shot_id: `shot_${String(index + 1).padStart(2, '0')}`,
    source_chapter_id: chapter?.id ?? null,
    source_chapter_title: chapter?.title || 'Story opening',
    duration_seconds: duration,
    shot_type: shotTypes[index % shotTypes.length],
    camera_move: cameraMoves[index % cameraMoves.length],
    action: excerpt,
    narration: excerpt,
    dialogue: null,
    emotion: ['wonder', 'tension', 'resolve'][index % 3],
    intensity: index % 4 === 3 ? 'high' : 'medium',
    characters: characterNames.slice(0, 3),
    must_preserve: [
      ...characterNames.slice(0, 3).map(name => `${name} remains visually consistent with the locked character bible.`),
      'Preserve source chapter meaning and cause-and-effect.',
      'Do not invent canon-changing actions.'
    ],
    negative_constraints: [...look.mode_contract.negative, ...look.style_contract.negative],
    style_prompt: `${look.style_contract.language}. Palette: ${look.style_contract.palette}.${customDirection}`,
    render_mode: look.mode,
    visual_style: look.visual_style,
    style_fit: look.style_fit,
    provider_generation: false,
    estimated_cost_usd: 0
  };
}

export function ensureVideoEngineSchema(db) {
  ensureArtifactSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      source_revision_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      visual_style TEXT NOT NULL DEFAULT 'soft_cinematic_bookish',
      quality TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      max_cost_usd REAL NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      actual_cost_usd REAL NOT NULL DEFAULT 0,
      blueprint_json TEXT NOT NULL DEFAULT '{}',
      artifact_id TEXT,
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_video_jobs_workspace ON story_video_jobs(workspace_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_story_video_jobs_status ON story_video_jobs(status,created_at);
  `);
  if (!columnExists(db, 'story_video_jobs', 'visual_style')) {
    db.exec("ALTER TABLE story_video_jobs ADD COLUMN visual_style TEXT NOT NULL DEFAULT 'soft_cinematic_bookish'");
  }
}

export function buildStoryVideoBlueprint(db, input = {}) {
  const workspaceId = text(input.workspace_id);
  const look = resolveVideoLook(input);
  const quality = text(input.quality, 'draft');
  const aspectRatio = text(input.aspect_ratio, '16:9');
  if (!workspaceId) throw new Error('workspace_id is required.');
  if (!VIDEO_ENGINE_OPTIONS.qualities.includes(quality)) throw new Error('Unsupported video quality.');
  if (!VIDEO_ENGINE_OPTIONS.aspect_ratios.includes(aspectRatio)) throw new Error('Unsupported aspect ratio.');

  const story = db.prepare('SELECT * FROM stories WHERE workspace_id=?').get(workspaceId);
  if (!story) throw new Error('Workspace not found.');
  const chapters = db.prepare(`SELECT id,workspace_id,chapter_id,title,content,text,position,updated_at FROM chapters WHERE workspace_id=? ORDER BY position,id`).all(workspaceId);
  const characters = charactersFor(db, workspaceId);
  const names = characters.map(item => item.name).filter(Boolean);
  const sourceUnits = chapters.length ? chapters : [{ id: null, title: story.title, content: story.pitch || 'A new story begins.' }];
  const excerpts = [];
  for (const chapter of sourceUnits) {
    const candidates = sentences(chapter.content || chapter.text || story.pitch || chapter.title).slice(0, 2);
    for (const excerpt of (candidates.length ? candidates : [text(chapter.title, 'A new scene begins.')])) {
      excerpts.push({ chapter, excerpt: excerpt.slice(0, 320) });
      if (excerpts.length >= MAX_SHOTS) break;
    }
    if (excerpts.length >= MAX_SHOTS) break;
  }

  const secondsPerShot = Math.max(4, Math.min(8, Math.floor(MAX_SECONDS / Math.max(1, excerpts.length))));
  const shots = excerpts.map((item, index) => makeShot(index, item.chapter, item.excerpt, look, names, secondsPerShot));
  return {
    schema_version: '1.1.0',
    blueprint_id: `video_blueprint_${randomUUID()}`,
    workspace_id: workspaceId,
    source_revision_id: revisionFor(story, chapters, characters),
    title: `${story.title} — ${look.style_contract.label} / ${look.mode_contract.label}`,
    target_mode: look.mode,
    target_mode_label: look.mode_contract.label,
    visual_style: look.visual_style,
    visual_style_label: look.style_contract.label,
    visual_style_description: look.style_contract.description,
    custom_style_prompt: look.custom_style_prompt,
    style_fit: look.style_fit,
    preview_renderer: 'motion_book_html',
    renderer_status: look.mode_contract.status,
    quality,
    aspect_ratio: aspectRatio,
    duration_seconds: shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
    scene_count: sourceUnits.length,
    shot_count: shots.length,
    character_bible: characters,
    world_bible: {
      source: 'story_memory_and_chapters',
      palette: look.style_contract.palette,
      visual_language: look.style_contract.language,
      render_mode: look.mode,
      visual_style: look.visual_style
    },
    preview_theme: look.style_contract.preview_theme,
    cost_plan: { max_cost_usd: 0, estimated_cost_usd: 0, actual_cost_usd: 0, provider_generation_enabled: false, hero_video_seconds: 0, strategy: 'deterministic_preview_first' },
    shots,
    continuity_contract: { one_story_brain: true, shared_shot_plan: true, per_shot_retry: true, approved_shots_are_immutable: true, provider_adapters_are_replaceable: true, visual_style_is_not_canon: true },
    created_at: Date.now()
  };
}

function ratio(value) { return value === '9:16' ? '9/16' : value === '1:1' ? '1/1' : '16/9'; }

function renderArtifact(blueprint, jobId) {
  const theme = blueprint.preview_theme || { bg: '#09080d', panel: '#15121d', accent: '#a77cff' };
  const shotMarkup = blueprint.shots.map((shot, index) => `<article class="shot ${index === 0 ? 'active' : ''}" data-testid="video-shot" data-duration="${shot.duration_seconds}"><div class="camera ${html(shot.camera_move)}"><small>${html(shot.shot_type)} · ${html(shot.camera_move)}</small><h2>${html(shot.source_chapter_title)}</h2><p>${html(shot.narration)}</p><footer>${html(shot.emotion)} · ${html(shot.intensity)} · ${shot.duration_seconds}s</footer></div></article>`).join('');
  const ticks = blueprint.shots.map((shot, index) => `<button class="tick ${index === 0 ? 'active' : ''}" data-index="${index}">${index + 1}<small>${shot.duration_seconds}s</small></button>`).join('');
  return `<!doctype html><html lang="en" data-video-engine="active"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(blueprint.title)}</title><style>
  :root{--bg:${html(theme.bg)};--panel:${html(theme.panel)};--line:#3b3b48;--text:#f4f1f7;--muted:#b4afbd;--accent:${html(theme.accent)}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 75% 0,color-mix(in srgb,var(--accent) 35%,transparent),transparent 42%),var(--bg);color:var(--text);font-family:system-ui,sans-serif}.shell{width:min(100%,1000px);padding:18px;border:1px solid var(--line);border-radius:20px;background:color-mix(in srgb,var(--panel) 92%,black)}.top,.bottom{display:flex;justify-content:space-between;gap:14px;align-items:center}.top h1{margin:4px 0 14px;font-size:clamp(24px,5vw,46px)}.eyebrow,small{color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.look{display:flex;gap:7px;flex-wrap:wrap}.badge{border:1px solid var(--line);border-radius:999px;padding:5px 8px;font-size:11px;color:var(--accent)}.stage{position:relative;aspect-ratio:${ratio(blueprint.aspect_ratio)};overflow:hidden;border:1px solid var(--line);border-radius:16px;background:linear-gradient(135deg,var(--panel),color-mix(in srgb,var(--accent) 28%,var(--panel)))}.shot{position:absolute;inset:0;display:none;background:radial-gradient(circle at 80% 15%,color-mix(in srgb,var(--accent) 45%,transparent),transparent 35%)}.shot.active{display:block}.camera{height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(24px,7vw,72px);animation:push 8s ease-out both}.camera.pan_right{animation:pan 8s ease-out both}.camera.pull_out{animation:pull 8s ease-out both}.camera h2{margin:8px 0;font-size:clamp(32px,7vw,70px);line-height:1}.camera p{max-width:42ch;font-size:clamp(16px,2.4vw,25px);line-height:1.45}.camera footer{color:var(--muted)}.timeline{display:flex;gap:7px;overflow:auto;margin:12px 0}.tick{min-width:55px;padding:7px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--muted)}.tick.active{border-color:var(--accent);color:var(--text)}.tick small{display:block}.bottom{font-size:12px;color:var(--muted)}@keyframes push{from{transform:scale(1)}to{transform:scale(1.08)}}@keyframes pull{from{transform:scale(1.08)}to{transform:scale(1)}}@keyframes pan{from{transform:translateX(-2%)}to{transform:translateX(2%)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
  </style></head><body><main class="shell" data-testid="l99-video-artifact" data-job-id="${html(jobId)}" data-target-mode="${html(blueprint.target_mode)}" data-visual-style="${html(blueprint.visual_style)}"><header class="top"><div><div class="eyebrow">L99 Story Video Engine · free deterministic preview</div><h1>${html(blueprint.title)}</h1><div class="look"><span class="badge" data-testid="video-mode-label">${html(blueprint.target_mode_label)}</span><span class="badge" data-testid="video-style-label">${html(blueprint.visual_style_label)}</span><span class="badge">${html(blueprint.style_fit)}</span></div></div><strong data-testid="video-render-status">${html(blueprint.renderer_status)}</strong></header><section class="stage" data-testid="video-stage">${shotMarkup}</section><nav class="timeline" data-testid="video-timeline">${ticks}</nav><footer class="bottom"><span>${blueprint.shot_count} shots · ${blueprint.duration_seconds}s · ${html(blueprint.aspect_ratio)}</span><span>Provider cost: $0.00</span></footer></main><script>
  const shots=[...document.querySelectorAll('[data-testid="video-shot"]')],ticks=[...document.querySelectorAll('.tick')];let current=0,timer;function show(next){current=(next+shots.length)%shots.length;shots.forEach((item,index)=>item.classList.toggle('active',index===current));ticks.forEach((item,index)=>item.classList.toggle('active',index===current));clearTimeout(timer);timer=setTimeout(()=>show(current+1),Number(shots[current].dataset.duration||6)*1000)}ticks.forEach((item,index)=>item.addEventListener('click',()=>show(index)));show(0);
  </script></body></html>`;
}

function hydrate(row) { return row ? { ...row, blueprint: safeJson(row.blueprint_json, {}), validation: safeJson(row.validation_json, {}) } : null; }

export function createStoryVideoJob(db, input = {}) {
  ensureVideoEngineSchema(db);
  const blueprint = buildStoryVideoBlueprint(db, input);
  const jobId = `video_job_${randomUUID()}`;
  const now = Date.now();
  db.prepare(`INSERT INTO story_video_jobs (job_id,workspace_id,source_revision_id,mode,visual_style,quality,aspect_ratio,status,max_cost_usd,estimated_cost_usd,actual_cost_usd,blueprint_json,artifact_id,validation_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'rendering',0,0,0,?,NULL,'{}',?,?)`).run(jobId, blueprint.workspace_id, blueprint.source_revision_id, blueprint.target_mode, blueprint.visual_style, blueprint.quality, blueprint.aspect_ratio, JSON.stringify(blueprint), now, now);
  log(db, { workspace_id: blueprint.workspace_id, mode: 'video_engine', event_type: 'video.plan.completed', payload: { job_id: jobId, blueprint_id: blueprint.blueprint_id, target_mode: blueprint.target_mode, visual_style: blueprint.visual_style, shot_count: blueprint.shot_count, estimated_cost_usd: 0 } });

  const artifactId = `artifact_${randomUUID()}`;
  const artifactHtml = renderArtifact(blueprint, jobId);
  const metadata = { video_job_id: jobId, blueprint_id: blueprint.blueprint_id, workspace_id: blueprint.workspace_id, target_mode: blueprint.target_mode, visual_style: blueprint.visual_style, preview_renderer: blueprint.preview_renderer, shot_count: blueprint.shot_count, duration_seconds: blueprint.duration_seconds, cost_plan: blueprint.cost_plan, playwright_required: true };
  db.prepare(`INSERT INTO story_artifacts (artifact_id,run_id,workspace_id,kind,title,status,content_hash,html,metadata_json,validation_json,created_at,updated_at) VALUES (?,?,?,'motion_book_video_preview',?,'generated',?,?,?,'{}',?,?)`).run(artifactId, jobId, blueprint.workspace_id, blueprint.title, createHash('sha256').update(artifactHtml).digest('hex'), artifactHtml, JSON.stringify(metadata), now, now);
  db.prepare(`UPDATE story_video_jobs SET status='ready_for_validation',artifact_id=?,updated_at=? WHERE job_id=?`).run(artifactId, Date.now(), jobId);
  log(db, { workspace_id: blueprint.workspace_id, mode: 'video_engine', event_type: 'video.artifact.generated', payload: { job_id: jobId, artifact_id: artifactId, preview_renderer: blueprint.preview_renderer, target_mode: blueprint.target_mode, visual_style: blueprint.visual_style, cost_usd: 0 } });
  return getStoryVideoJob(db, jobId);
}

export function getStoryVideoJob(db, jobId) { ensureVideoEngineSchema(db); return hydrate(db.prepare('SELECT * FROM story_video_jobs WHERE job_id=?').get(jobId)); }
export function listStoryVideoJobs(db, workspaceId, limit = 50) { ensureVideoEngineSchema(db); return db.prepare('SELECT * FROM story_video_jobs WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?').all(workspaceId, Math.max(1, Math.min(200, Number(limit) || 50))).map(hydrate); }

async function playwrightCheck(artifactHtml, blueprint) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.setContent(artifactHtml, { waitUntil: 'domcontentloaded' });
    const artifactCount = await page.locator('[data-testid="l99-video-artifact"]').count();
    const shotCount = await page.locator('[data-testid="video-shot"]').count();
    const timelineCount = await page.locator('[data-testid="video-timeline"]').count();
    const activeCount = await page.locator('[data-testid="video-shot"].active').count();
    const styleLabel = await page.locator('[data-testid="video-style-label"]').textContent();
    const modeLabel = await page.locator('[data-testid="video-mode-label"]').textContent();
    const title = await page.title();
    await browser.close();
    return { available: true, passed: artifactCount === 1 && shotCount === blueprint.shot_count && shotCount > 0 && timelineCount === 1 && activeCount === 1 && styleLabel?.trim() === blueprint.visual_style_label && modeLabel?.trim() === blueprint.target_mode_label && title.trim().length > 0 && consoleErrors.length === 0, artifact_count: artifactCount, shot_count: shotCount, expected_shot_count: blueprint.shot_count, timeline_count: timelineCount, active_shot_count: activeCount, visual_style_label: styleLabel, render_mode_label: modeLabel, console_errors: consoleErrors, title };
  } catch (error) {
    return { available: false, passed: false, error: error.code === 'ERR_MODULE_NOT_FOUND' ? 'playwright_not_installed' : error.message };
  }
}

export async function validateStoryVideoJob(db, jobId) {
  ensureVideoEngineSchema(db);
  const job = getStoryVideoJob(db, jobId);
  if (!job) throw new Error('Video job not found.');
  const artifact = db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
  if (!artifact) throw new Error('Video artifact not found.');
  const structural = {
    has_html: artifact.html.includes('<html') && artifact.html.includes('</html>'),
    has_video_artifact_marker: artifact.html.includes('data-testid="l99-video-artifact"'),
    has_video_shot: artifact.html.includes('data-testid="video-shot"'),
    has_video_timeline: artifact.html.includes('data-testid="video-timeline"'),
    has_visual_style_marker: artifact.html.includes(`data-visual-style="${job.blueprint.visual_style}"`),
    shot_count_matches: (artifact.html.match(/<article[^>]+data-testid="video-shot"/g) || []).length === job.blueprint.shot_count,
    zero_provider_cost: Number(job.estimated_cost_usd || 0) === 0 && Number(job.actual_cost_usd || 0) === 0
  };
  const playwright = await playwrightCheck(artifact.html, job.blueprint);
  const validation = { validator: 'playwright_story_video_gate', passed: Object.values(structural).every(Boolean) && playwright.passed === true, structural, playwright, required_before: 'redteam_pre_release', validated_at: Date.now() };
  const status = validation.passed ? 'validated' : 'failed';
  db.transaction(() => {
    db.prepare('UPDATE story_video_jobs SET status=?,validation_json=?,updated_at=? WHERE job_id=?').run(status, JSON.stringify(validation), Date.now(), jobId);
    db.prepare('UPDATE story_artifacts SET status=?,validation_json=?,updated_at=? WHERE artifact_id=?').run(status, JSON.stringify(validation), Date.now(), artifact.artifact_id);
  })();
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: validation.passed ? 'video.playwright_validated' : 'video.playwright_failed', payload: { job_id: jobId, artifact_id: artifact.artifact_id, target_mode: job.blueprint.target_mode, visual_style: job.blueprint.visual_style, validation } });
  return getStoryVideoJob(db, jobId);
}

export function storyVideoEngineOverview(db) {
  if (!tableExists(db, 'story_video_jobs')) return { status: 'not_initialized', total_jobs: 0, validated_count: 0, failed_count: 0, ready_for_validation_count: 0, total_estimated_cost_usd: 0, style_count: 0, recent_jobs: [] };
  ensureVideoEngineSchema(db);
  const totals = db.prepare(`SELECT COUNT(*) total_jobs,SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) validated_count,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count,SUM(CASE WHEN status='ready_for_validation' THEN 1 ELSE 0 END) ready_for_validation_count,COALESCE(SUM(estimated_cost_usd),0) total_estimated_cost_usd,COUNT(DISTINCT visual_style) style_count FROM story_video_jobs`).get();
  const recentJobs = db.prepare(`SELECT job_id,workspace_id,mode,visual_style,quality,aspect_ratio,status,estimated_cost_usd,actual_cost_usd,artifact_id,created_at,updated_at FROM story_video_jobs ORDER BY created_at DESC LIMIT 10`).all();
  const failed = Number(totals.failed_count || 0), ready = Number(totals.ready_for_validation_count || 0), validated = Number(totals.validated_count || 0);
  return { status: failed ? 'error' : ready ? 'awaiting_validation' : validated ? 'verified' : 'idle', total_jobs: Number(totals.total_jobs || 0), validated_count: validated, failed_count: failed, ready_for_validation_count: ready, total_estimated_cost_usd: Number(totals.total_estimated_cost_usd || 0), style_count: Number(totals.style_count || 0), available_style_count: Object.keys(VIDEO_VISUAL_STYLES).length, recent_jobs: recentJobs };
}
