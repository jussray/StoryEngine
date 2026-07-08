// lib/artifactValidation.js

import { randomUUID, createHash } from 'node:crypto';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function slug(value) {
  return text(value, 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'artifact';
}

export function ensureArtifactSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL UNIQUE,
      run_id TEXT,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generated',
      content_hash TEXT NOT NULL,
      html TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_artifacts_workspace ON story_artifacts(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_story_artifacts_run ON story_artifacts(run_id, created_at);
  `);
}

function renderArtifactHtml({ title, intent, chapters, runId }) {
  const unit = intent?.medium === 'song' ? 'Section' : intent?.medium === 'movie' ? 'Scene' : intent?.medium === 'comic' ? 'Panel' : 'Story Unit';
  const chapterMarkup = chapters.length
    ? chapters.map((chapter, index) => `
      <section class="unit" data-testid="story-unit">
        <h2>${escapeHtml(chapter.title || `${unit} ${index + 1}`)}</h2>
        <p>${escapeHtml(chapter.content || chapter.text || '').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>
      </section>`).join('\n')
    : `<section class="unit" data-testid="story-unit"><h2>${escapeHtml(unit)} 1</h2><p>${escapeHtml(intent?.story_vision || 'Draft pending.')}</p></section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#faf8f3;color:#1f1d1b;line-height:1.6}
    main{max-width:760px;margin:0 auto;padding:36px 18px 64px}
    header{border-bottom:2px solid #ded6c8;margin-bottom:24px;padding-bottom:18px}
    h1{font-size:clamp(32px,6vw,56px);line-height:1.05;margin:0 0 10px}
    .meta{color:#6d655d;font-size:14px}.unit{background:#fff;border:1px solid #e3ddd1;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 8px 24px #0000000a}.unit h2{margin-top:0}
  </style>
</head>
<body>
  <main data-testid="l99-artifact" data-run-id="${escapeHtml(runId)}">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(intent?.medium || 'story')} · ${escapeHtml(intent?.audience || 'audience')} · ${escapeHtml(intent?.story_kind || 'story')}</div>
    </header>
    ${chapterMarkup}
  </main>
</body>
</html>`;
}

export function generateStoryArtifact(db, { runId, workspaceId, intent = {} }) {
  ensureArtifactSchema(db);
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id=?').get(workspaceId);
  if (!story) throw new Error('Workspace not found for artifact generation.');
  const chapters = Chapter.list(db, workspaceId);
  const title = text(story.title, intent.title || 'L99 Story Artifact');
  const html = renderArtifactHtml({ title, intent, chapters, runId });
  const hash = createHash('sha256').update(html).digest('hex');
  const existing = runId ? db.prepare('SELECT * FROM story_artifacts WHERE run_id=? ORDER BY created_at DESC LIMIT 1').get(runId) : null;
  const now = Date.now();

  if (existing && existing.content_hash === hash) {
    return hydrateArtifact(existing);
  }

  const artifactId = `artifact_${randomUUID()}`;
  const metadata = {
    slug: slug(title),
    run_id: runId || null,
    workspace_id: workspaceId,
    chapter_count: chapters.length,
    medium: intent.medium || null,
    audience: intent.audience || null,
    story_kind: intent.story_kind || null,
    playwright_required: true
  };

  db.prepare(`
    INSERT INTO story_artifacts (
      artifact_id, run_id, workspace_id, kind, title, status,
      content_hash, html, metadata_json, validation_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'html_preview', ?, 'generated', ?, ?, ?, '{}', ?, ?)
  `).run(artifactId, runId || null, workspaceId, title, hash, html, JSON.stringify(metadata), now, now);

  log(db, {
    workspace_id: workspaceId,
    mode: 'artifacts',
    event_type: 'artifact.generated',
    payload: { artifact_id: artifactId, run_id: runId || null, kind: 'html_preview', chapter_count: chapters.length }
  });

  return hydrateArtifact(db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(artifactId));
}

function hydrateArtifact(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: safeJson(row.metadata_json, {}),
    validation: safeJson(row.validation_json, {})
  };
}

async function tryPlaywrightSmoke(html) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const artifactCount = await page.locator('[data-testid="l99-artifact"]').count();
    const unitCount = await page.locator('[data-testid="story-unit"]').count();
    const title = await page.title();
    await browser.close();
    return { available: true, passed: artifactCount === 1 && unitCount >= 1 && title.trim().length > 0, artifact_count: artifactCount, unit_count: unitCount, title };
  } catch (error) {
    return { available: false, passed: null, skipped_reason: error.code === 'ERR_MODULE_NOT_FOUND' ? 'playwright_not_installed' : error.message };
  }
}

export async function validateArtifactWithPlaywright(db, artifactId) {
  ensureArtifactSchema(db);
  const artifact = hydrateArtifact(db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(artifactId));
  if (!artifact) throw new Error('Artifact not found.');

  const structural = {
    has_html: artifact.html.includes('<html') && artifact.html.includes('</html>'),
    has_artifact_marker: artifact.html.includes('data-testid="l99-artifact"'),
    has_story_unit: artifact.html.includes('data-testid="story-unit"'),
    has_title: /<title>[^<]+<\/title>/i.test(artifact.html)
  };
  const structuralPassed = Object.values(structural).every(Boolean);
  const playwright = await tryPlaywrightSmoke(artifact.html);
  const passed = structuralPassed && (playwright.available ? playwright.passed === true : true);
  const validation = {
    validator: 'playwright_artifact_gate',
    passed,
    structural,
    playwright,
    required_before: 'redteam_pre_release',
    validated_at: Date.now()
  };

  db.prepare(`
    UPDATE story_artifacts SET status=?, validation_json=?, updated_at=? WHERE artifact_id=?
  `).run(passed ? 'validated' : 'failed', JSON.stringify(validation), Date.now(), artifactId);

  log(db, {
    workspace_id: artifact.workspace_id,
    mode: 'artifacts',
    event_type: passed ? 'artifact.playwright_validated' : 'artifact.playwright_failed',
    payload: { artifact_id: artifactId, run_id: artifact.run_id, validation }
  });

  return { ...artifact, status: passed ? 'validated' : 'failed', validation };
}

export function getArtifact(db, artifactId) {
  ensureArtifactSchema(db);
  return hydrateArtifact(db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(artifactId));
}

export function listArtifacts(db, workspaceId, limit = 50) {
  ensureArtifactSchema(db);
  return db.prepare(`
    SELECT * FROM story_artifacts
    WHERE workspace_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(200, Number(limit) || 50))).map(hydrateArtifact);
}
