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

function profileForWorkspace(db, workspaceId) {
  const row = db.prepare('SELECT * FROM creative_profiles WHERE workspace_id=?').get(workspaceId);
  if (!row) return null;
  return { ...row, resolved_rules: safeJson(row.resolved_rules_json, {}) };
}

function illustrationBrief(chapters, profile) {
  const child = profile?.resolved_rules?.children_book_profile;
  if (!child) return [];
  return chapters.map((chapter, index) => ({
    unit: index + 1,
    title: chapter.title || `Story Unit ${index + 1}`,
    cue: `Illustrate the central action and emotion from this unit. Maintain ${child.illustration_density} coverage and ${child.page_turn_strategy} pacing.`,
    source_excerpt: text(chapter.content || chapter.text).slice(0, 240)
  }));
}

function vocabularyList(chapters, profile) {
  const child = profile?.resolved_rules?.children_book_profile;
  if (!child) return [];
  const all = chapters.flatMap(chapter => String(chapter.content || chapter.text || '').toLowerCase().match(/[a-z']{6,}/g) || []);
  const unique = [...new Set(all)].slice(0, child.vocabulary_words || 8);
  return unique.map(word => ({ word, note: 'Define in child-friendly language using story context.' }));
}

function discussionQuestions(profile) {
  const child = profile?.resolved_rules?.children_book_profile;
  if (!child) return [];
  const count = child.discussion_questions || 5;
  const pool = [
    'What did the main character want most?',
    'What problem did the character face?',
    'How did the character feel at the beginning and the end?',
    'What choice would you have made?',
    'What did this story help you understand?',
    'Which picture or scene felt most important?',
    'What new word did you notice?',
    'How could this lesson help in real life?',
    'What might happen next?',
    'Which character changed the most?'
  ];
  return pool.slice(0, count);
}

function renderCompanionMaterials(profile, chapters) {
  const child = profile?.resolved_rules?.children_book_profile;
  if (!child) return '';
  const illustrations = illustrationBrief(chapters, profile);
  const vocabulary = vocabularyList(chapters, profile);
  const questions = discussionQuestions(profile);
  return `
    <section class="companion" data-testid="children-book-profile">
      <h2>Children’s Book Production Profile</h2>
      <dl>
        <dt>Age band</dt><dd>${escapeHtml(child.age_band)}</dd>
        <dt>Developmental stage</dt><dd>${escapeHtml(child.developmental_stage)}</dd>
        <dt>Target words</dt><dd>${escapeHtml(`${child.target_word_count[0]}–${child.target_word_count[1]}`)}</dd>
        <dt>Plot complexity</dt><dd>${escapeHtml(child.plot_complexity)}</dd>
        <dt>Emotional ceiling</dt><dd>${escapeHtml(child.conflict_level)}</dd>
        <dt>Learning design</dt><dd>${escapeHtml(child.learning_design)}</dd>
      </dl>
    </section>
    <section class="companion" data-testid="illustration-brief">
      <h2>Illustration Brief</h2>
      ${illustrations.map(item => `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.cue)}</p><small>${escapeHtml(item.source_excerpt)}</small></article>`).join('') || '<p>Add story units to generate illustration cues.</p>'}
    </section>
    <section class="companion" data-testid="parent-guide">
      <h2>Parent or Educator Guide</h2>
      <p>Read for enjoyment first. On a second reading, pause at page or chapter turns to ask what the child predicts, notices, and feels.</p>
      <h3>Vocabulary</h3>
      <ul>${vocabulary.map(item => `<li><strong>${escapeHtml(item.word)}</strong> — ${escapeHtml(item.note)}</li>`).join('') || '<li>No vocabulary terms extracted yet.</li>'}</ul>
      <h3>Discussion Questions</h3>
      <ol>${questions.map(question => `<li>${escapeHtml(question)}</li>`).join('')}</ol>
    </section>`;
}

function renderArtifactHtml({ title, intent, chapters, runId, profile }) {
  const unit = intent?.medium === 'song' ? 'Section' : intent?.medium === 'movie' ? 'Scene' : intent?.medium === 'comic' ? 'Panel' : intent?.medium === 'picture_book' ? 'Page' : 'Story Unit';
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
    main{max-width:820px;margin:0 auto;padding:36px 18px 64px}
    header{border-bottom:2px solid #ded6c8;margin-bottom:24px;padding-bottom:18px}
    h1{font-size:clamp(32px,6vw,56px);line-height:1.05;margin:0 0 10px}
    .meta{color:#6d655d;font-size:14px}.unit,.companion{background:#fff;border:1px solid #e3ddd1;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 8px 24px #0000000a}.unit h2,.companion h2{margin-top:0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}dt{font-weight:700}dd{margin:0}.companion article{border-top:1px solid #eee5d8;padding:12px 0}.companion small{color:#6d655d}
  </style>
</head>
<body>
  <main data-testid="l99-artifact" data-run-id="${escapeHtml(runId)}">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(intent?.medium || 'story')} · ${escapeHtml(intent?.audience || 'audience')} · ${escapeHtml(intent?.story_kind || 'story')}</div>
    </header>
    ${chapterMarkup}
    ${renderCompanionMaterials(profile, chapters)}
  </main>
</body>
</html>`;
}

export function generateStoryArtifact(db, { runId, workspaceId, intent = {} }) {
  ensureArtifactSchema(db);
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id=?').get(workspaceId);
  if (!story) throw new Error('Workspace not found for artifact generation.');
  const chapters = Chapter.list(db, workspaceId);
  const profile = profileForWorkspace(db, workspaceId);
  const title = text(story.title, intent.title || 'L99 Story Artifact');
  const html = renderArtifactHtml({ title, intent, chapters, runId, profile });
  const hash = createHash('sha256').update(html).digest('hex');
  const existing = runId ? db.prepare('SELECT * FROM story_artifacts WHERE run_id=? ORDER BY created_at DESC LIMIT 1').get(runId) : null;
  const now = Date.now();

  if (existing && existing.content_hash === hash) return hydrateArtifact(existing);

  const artifactId = `artifact_${randomUUID()}`;
  const childProfile = profile?.resolved_rules?.children_book_profile || null;
  const metadata = {
    slug: slug(title),
    run_id: runId || null,
    workspace_id: workspaceId,
    chapter_count: chapters.length,
    medium: intent.medium || null,
    audience: intent.audience || null,
    story_kind: intent.story_kind || null,
    children_book_profile: childProfile,
    companion_artifacts: childProfile ? ['illustration_brief', 'parent_educator_guide', 'vocabulary_list', 'discussion_questions'] : [],
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
    payload: { artifact_id: artifactId, run_id: runId || null, kind: 'html_preview', chapter_count: chapters.length, children_book_profile: Boolean(childProfile) }
  });

  return hydrateArtifact(db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(artifactId));
}

function hydrateArtifact(row) {
  if (!row) return null;
  return { ...row, metadata: safeJson(row.metadata_json, {}), validation: safeJson(row.validation_json, {}) };
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

  const childRequired = Boolean(artifact.metadata.children_book_profile);
  const structural = {
    has_html: artifact.html.includes('<html') && artifact.html.includes('</html>'),
    has_artifact_marker: artifact.html.includes('data-testid="l99-artifact"'),
    has_story_unit: artifact.html.includes('data-testid="story-unit"'),
    has_title: /<title>[^<]+<\/title>/i.test(artifact.html),
    has_children_profile: !childRequired || artifact.html.includes('data-testid="children-book-profile"'),
    has_illustration_brief: !childRequired || artifact.html.includes('data-testid="illustration-brief"'),
    has_parent_guide: !childRequired || artifact.html.includes('data-testid="parent-guide"')
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
