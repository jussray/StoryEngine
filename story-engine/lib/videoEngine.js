// lib/videoEngine.js
// One deterministic story blueprint, four visual targets, zero provider spend.

import { createHash, randomUUID } from 'node:crypto';
import { ensureArtifactSchema } from './artifactValidation.js';
import { log } from '../models/eventModel.js';

const MAX_SHOTS = 12;
const MAX_SECONDS = 60;
const MODES = Object.freeze({
  motion_book: { label: 'Motion Book', status: 'active', renderer: 'animated_html', description: 'Layered browser animatic with camera motion and readable story cards.' },
  cinematic_3d: { label: 'Cinematic 3D', status: 'blueprint_ready', renderer: 'motion_book_proxy', description: 'Blender-ready blocking manifest with a free Motion Book preview.' },
  cartoon_2d: { label: 'Cartoon 2D', status: 'blueprint_ready', renderer: 'motion_book_proxy', description: 'Cut-out animation-ready manifest with a free Motion Book preview.' },
  anime_2d: { label: 'Anime 2D', status: 'blueprint_ready', renderer: 'motion_book_proxy', description: 'Anime keyframe-ready manifest with a free Motion Book preview.' }
});

export const VIDEO_ENGINE_OPTIONS = Object.freeze({
  modes: MODES,
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
function sentences(value) { return text(value).split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean); }

const STYLE = Object.freeze({
  motion_book: { palette: 'paper, ink, violet glow', language: 'layered illustration and gentle parallax', negative: ['no provider dependency', 'no identity drift'] },
  cinematic_3d: { palette: 'filmic contrast and volumetric light', language: 'grounded 3D blocking and practical camera grammar', negative: ['no floating feet', 'no wardrobe drift', 'no camera clipping'] },
  cartoon_2d: { palette: 'clean shapes and controlled color blocks', language: 'reusable cut-out poses and mouth shapes', negative: ['no off-model faces', 'no random costume swaps'] },
  anime_2d: { palette: 'cel shading and cinematic rim light', language: 'consistent anime keyframes', negative: ['no face drift', 'no hair-color drift', 'no extra fingers'] }
});

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

function makeShot(index, chapter, excerpt, mode, characterNames, duration) {
  const style = STYLE[mode];
  const shotTypes = ['establishing', 'medium', 'closeup', 'over_shoulder', 'insert'];
  const cameraMoves = ['push_in', 'pan_right', 'static', 'pull_out', 'pan_left'];
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
    negative_constraints: style.negative,
    style_prompt: `${style.language}. Palette: ${style.palette}.`,
    renderer: mode,
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
}

export function buildStoryVideoBlueprint(db, input = {}) {
  const workspaceId = text(input.workspace_id);
  const mode = text(input.mode, 'motion_book');
  const quality = text(input.quality, 'draft');
  const aspectRatio = text(input.aspect_ratio, '16:9');
  if (!workspaceId) throw new Error('workspace_id is required.');
  if (!MODES[mode]) throw new Error('Unsupported video mode.');
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
  const shots = excerpts.map((item, index) => makeShot(index, item.chapter, item.excerpt, mode, names, secondsPerShot));
  const style = STYLE[mode];
  return {
    schema_version: '1.0.0',
    blueprint_id: `video_blueprint_${randomUUID()}`,
    workspace_id: workspaceId,
    source_revision_id: revisionFor(story, chapters, characters),
    title: `${story.title} — ${MODES[mode].label}`,
    target_mode: mode,
    preview_renderer: 'motion_book_html',
    renderer_status: MODES[mode].status,
    quality,
    aspect_ratio: aspectRatio,
    duration_seconds: shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
    scene_count: sourceUnits.length,
    shot_count: shots.length,
    character_bible: characters,
    world_bible: { source: 'story_memory_and_chapters', palette: style.palette, visual_language: style.language },
    cost_plan: { max_cost_usd: 0, estimated_cost_usd: 0, actual_cost_usd: 0, provider_generation_enabled: false, hero_video_seconds: 0, strategy: 'deterministic_preview_first' },
    shots,
    continuity_contract: { one_story_brain: true, shared_shot_plan: true, per_shot_retry: true, approved_shots_are_immutable: true, provider_adapters_are_replaceable: true },
    created_at: Date.now()
  };
}

function ratio(value) { return value === '9:16' ? '9/16' : value === '1:1' ? '1/1' : '16/9'; }

function renderArtifact(blueprint, jobId) {
  const shotMarkup = blueprint.shots.map((shot, index) => `<article class="shot ${index === 0 ? 'active' : ''}" data-testid="video-shot" data-duration="${shot.duration_seconds}"><div class="camera ${html(shot.camera_move)}"><small>${html(shot.shot_type)} · ${html(shot.camera_move)}</small><h2>${html(shot.source_chapter_title)}</h2><p>${html(shot.narration)}</p><footer>${html(shot.emotion)} · ${html(shot.intensity)} · ${shot.duration_seconds}s</footer></div></article>`).join('');
  const ticks = blueprint.shots.map((shot, index) => `<button class="tick ${index === 0 ? 'active' : ''}" data-index="${index}">${index + 1}<small>${shot.duration_seconds}s</small></button>`).join('');
  return `<!doctype html><html lang="en" data-video-engine="active"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(blueprint.title)}</title><style>
  :root{--bg:#09080d;--panel:#15121d;--line:#3b3150;--text:#f4efff;--muted:#b1a9c0;--accent:#a77cff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 75% 0,#382553,transparent 42%),var(--bg);color:var(--text);font-family:system-ui,sans-serif}.shell{width:min(100%,1000px);padding:18px;border:1px solid var(--line);border-radius:20px;background:#100e16}.top,.bottom{display:flex;justify-content:space-between;gap:14px;align-items:center}.top h1{margin:4px 0 14px;font-size:clamp(24px,5vw,46px)}.eyebrow,small{color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.stage{position:relative;aspect-ratio:${ratio(blueprint.aspect_ratio)};overflow:hidden;border:1px solid var(--line);border-radius:16px;background:linear-gradient(135deg,#151222,#302040)}.shot{position:absolute;inset:0;display:none;background:radial-gradient(circle at 80% 15%,#6e47aa88,transparent 35%)}.shot.active{display:block}.camera{height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(24px,7vw,72px);animation:push 8s ease-out both}.camera.pan_right{animation:pan 8s ease-out both}.camera.pull_out{animation:pull 8s ease-out both}.camera h2{margin:8px 0;font-size:clamp(32px,7vw,70px);line-height:1}.camera p{max-width:42ch;font-size:clamp(16px,2.4vw,25px);line-height:1.45}.camera footer{color:var(--muted)}.timeline{display:flex;gap:7px;overflow:auto;margin:12px 0}.tick{min-width:55px;padding:7px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--muted)}.tick.active{border-color:var(--accent);color:var(--text)}.tick small{display:block}.bottom{font-size:12px;color:var(--muted)}@keyframes push{from{transform:scale(1)}to{transform:scale(1.08)}}@keyframes pull{from{transform:scale(1.08)}to{transform:scale(1)}}@keyframes pan{from{transform:translateX(-2%)}to{transform:translateX(2%)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
  </style></head><body><main class="shell" data-testid="l99-video-artifact" data-job-id="${html(jobId)}" data-target-mode="${html(blueprint.target_mode)}"><header class="top"><div><div class="eyebrow">L99 Story Video Engine · free deterministic preview</div><h1>${html(blueprint.title)}</h1></div><strong data-testid="video-render-status">${html(blueprint.renderer_status)}</strong></header><section class="stage" data-testid="video-stage">${shotMarkup}</section><nav class="timeline" data-testid="video-timeline">${ticks}</nav><footer class="bottom"><span>${blueprint.shot_count} shots · ${blueprint.duration_seconds}s · ${html(blueprint.aspect_ratio)}</span><span>Provider cost: $0.00</span></footer></main><script>
  const shots=[...document.querySelectorAll('[data-testid="video-shot"]')],ticks=[...document.querySelectorAll('.tick')];let current=0,timer;function show(next){current=(next+shots.length)%shots.length;shots.forEach((item,index)=>item.classList.toggle('active',index===current));ticks.forEach((item,index)=>item.classList.toggle('active',index===current));clearTimeout(timer);timer=setTimeout(()=>show(current+1),Number(shots[current].dataset.duration||6)*1000)}ticks.forEach((item,index)=>item.addEventListener('click',()=>show(index)));show(0);
  </script></body></html>`;
}

function hydrate(row) { return row ? { ...row, blueprint: safeJson(row.blueprint_json, {}), validation: safeJson(row.validation_json, {}) } : null; }

export function createStoryVideoJob(db, input = {}) {
  ensureVideoEngineSchema(db);
  const blueprint = buildStoryVideoBlueprint(db, input);
  const jobId = `video_job_${randomUUID()}`;
  const now = Date.now();
  db.prepare(`INSERT INTO story_video_jobs (job_id,workspace_id,source_revision_id,mode,quality,aspect_ratio,status,max_cost_usd,estimated_cost_usd,actual_cost_usd,blueprint_json,artifact_id,validation_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'rendering',0,0,0,?,NULL,'{}',?,?)`).run(jobId, blueprint.workspace_id, blueprint.source_revision_id, blueprint.target_mode, blueprint.quality, blueprint.aspect_ratio, JSON.stringify(blueprint), now, now);
  log(db, { workspace_id: blueprint.workspace_id, mode: 'video_engine', event_type: 'video.plan.completed', payload: { job_id: jobId, blueprint_id: blueprint.blueprint_id, target_mode: blueprint.target_mode, shot_count: blueprint.shot_count, estimated_cost_usd: 0 } });

  const artifactId = `artifact_${randomUUID()}`;
  const artifactHtml = renderArtifact(blueprint, jobId);
  const metadata = { video_job_id: jobId, blueprint_id: blueprint.blueprint_id, workspace_id: blueprint.workspace_id, target_mode: blueprint.target_mode, preview_renderer: blueprint.preview_renderer, shot_count: blueprint.shot_count, duration_seconds: blueprint.duration_seconds, cost_plan: blueprint.cost_plan, playwright_required: true };
  db.prepare(`INSERT INTO story_artifacts (artifact_id,run_id,workspace_id,kind,title,status,content_hash,html,metadata_json,validation_json,created_at,updated_at) VALUES (?,?,?,'motion_book_video_preview',?,'generated',?,?,?,'{}',?,?)`).run(artifactId, jobId, blueprint.workspace_id, blueprint.title, createHash('sha256').update(artifactHtml).digest('hex'), artifactHtml, JSON.stringify(metadata), now, now);
  db.prepare(`UPDATE story_video_jobs SET status='ready_for_validation',artifact_id=?,updated_at=? WHERE job_id=?`).run(artifactId, Date.now(), jobId);
  log(db, { workspace_id: blueprint.workspace_id, mode: 'video_engine', event_type: 'video.artifact.generated', payload: { job_id: jobId, artifact_id: artifactId, preview_renderer: blueprint.preview_renderer, target_mode: blueprint.target_mode, cost_usd: 0 } });
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
    const title = await page.title();
    await browser.close();
    return { available: true, passed: artifactCount === 1 && shotCount === blueprint.shot_count && shotCount > 0 && timelineCount === 1 && activeCount === 1 && title.trim().length > 0 && consoleErrors.length === 0, artifact_count: artifactCount, shot_count: shotCount, expected_shot_count: blueprint.shot_count, timeline_count: timelineCount, active_shot_count: activeCount, console_errors: consoleErrors, title };
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
  log(db, { workspace_id: job.workspace_id, mode: 'video_engine', event_type: validation.passed ? 'video.playwright_validated' : 'video.playwright_failed', payload: { job_id: jobId, artifact_id: artifact.artifact_id, validation } });
  return getStoryVideoJob(db, jobId);
}

export function storyVideoEngineOverview(db) {
  if (!tableExists(db, 'story_video_jobs')) return { status: 'not_initialized', total_jobs: 0, validated_count: 0, failed_count: 0, ready_for_validation_count: 0, total_estimated_cost_usd: 0, recent_jobs: [] };
  const totals = db.prepare(`SELECT COUNT(*) total_jobs,SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) validated_count,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count,SUM(CASE WHEN status='ready_for_validation' THEN 1 ELSE 0 END) ready_for_validation_count,COALESCE(SUM(estimated_cost_usd),0) total_estimated_cost_usd FROM story_video_jobs`).get();
  const recentJobs = db.prepare(`SELECT job_id,workspace_id,mode,quality,aspect_ratio,status,estimated_cost_usd,actual_cost_usd,artifact_id,created_at,updated_at FROM story_video_jobs ORDER BY created_at DESC LIMIT 10`).all();
  const failed = Number(totals.failed_count || 0), ready = Number(totals.ready_for_validation_count || 0), validated = Number(totals.validated_count || 0);
  return { status: failed ? 'error' : ready ? 'awaiting_validation' : validated ? 'verified' : 'idle', total_jobs: Number(totals.total_jobs || 0), validated_count: validated, failed_count: failed, ready_for_validation_count: ready, total_estimated_cost_usd: Number(totals.total_estimated_cost_usd || 0), recent_jobs: recentJobs };
}
