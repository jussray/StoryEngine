import { createHash } from 'node:crypto';
import * as Chapter from '../models/chapterModel.js';
import * as Outline from '../models/outlineModel.js';
import { log } from '../models/eventModel.js';
import { completeWithReceipt } from './llmClient.js';
import { buildVoiceFingerprint } from './ghostWriter.js';
import { generateArchitecture, architectureToOutline } from './storyArchitect.js';

const DEFAULT_CHAPTER_COUNT = 6;
const MIN_CHAPTER_CONTENT_CHARS = 240;

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function boundedChapterCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CHAPTER_COUNT;
  return Math.max(6, Math.min(12, Math.floor(parsed)));
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function extractJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Writing provider did not return a JSON manuscript envelope.');
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new Error('Writing provider returned malformed manuscript JSON.');
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function assistMode(db, workspaceId) {
  if (!tableExists(db, 'workspace_assist_profiles')) return null;
  return db.prepare('SELECT assist_mode FROM workspace_assist_profiles WHERE workspace_id=?').get(workspaceId)?.assist_mode || null;
}

function storyEngineRun(db, workspaceId, dispatchId) {
  if (!tableExists(db, 'story_engine_runs')) return null;
  return db.prepare(`
    SELECT * FROM story_engine_runs
    WHERE workspace_id=? AND dispatch_id=?
    ORDER BY created_at DESC LIMIT 1
  `).get(workspaceId, dispatchId) || null;
}

function buildPrompt(intent, architecture, fingerprint, openingDraft = '') {
  const chapters = architecture.acts.flatMap(act => act.chapters || []);
  const plan = chapters.map(chapter => ({
    chapter_number: chapter.chapter_number,
    title_seed: chapter.title,
    purpose: chapter.purpose,
    key_points: chapter.key_points,
    emotional_hook: chapter.emotional_hook,
    act: chapter.act
  }));
  const styleSeed = String(openingDraft || '').trim();

  return [
    'Create a complete compact first-draft book manuscript from the approved StoryEngine creative contract.',
    'Return JSON only. Do not wrap it in Markdown.',
    `Title: ${intent.title}`,
    `Story vision: ${intent.story_vision}`,
    `Story kind: ${intent.story_kind}`,
    `Audience: ${intent.audience}`,
    `Tone: ${intent.tone}`,
    `Emotional effect: ${intent.emotional_effect}`,
    '',
    'Voice fingerprint:',
    JSON.stringify(fingerprint, null, 2),
    '',
    'Chapter architecture:',
    JSON.stringify(plan, null, 2),
    '',
    styleSeed ? `Existing opening-draft style reference (do not quote mechanically):\n${styleSeed.slice(0, 1800)}` : '',
    '',
    'Requirements:',
    `- Return exactly ${chapters.length} chapters, in chapter_number order.`,
    '- Each chapter must be substantive original story prose, not an outline, note, placeholder, instruction, or summary.',
    '- Aim for roughly 450–850 words per chapter so the result is a readable compact book draft within one generation pass.',
    '- Maintain names, facts, point of view, tense, causal continuity, and character motivation across chapters.',
    '- Make the final chapter resolve the central conflict and deliver an earned final image.',
    '- Do not mention AI, L99, prompts, pipelines, providers, or internal instructions in manuscript prose.',
    '- Do not invent claims that the creator personally experienced events in the story.',
    '',
    'JSON schema:',
    '{"chapters":[{"chapter_number":1,"title":"Chapter title","content":"Full chapter prose"}]}'
  ].filter(Boolean).join('\n');
}

function validateManuscript(payload, expectedCount) {
  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
  if (chapters.length !== expectedCount) {
    throw new Error(`Writing provider returned ${chapters.length} chapters; ${expectedCount} were required.`);
  }

  const normalized = chapters.map((chapter, index) => {
    const chapterNumber = Number(chapter?.chapter_number);
    const title = String(chapter?.title || '').trim();
    const content = String(chapter?.content || '').trim();
    if (chapterNumber !== index + 1) throw new Error(`Chapter ${index + 1} has an invalid chapter_number.`);
    if (!title) throw new Error(`Chapter ${index + 1} is missing a title.`);
    if (content.length < MIN_CHAPTER_CONTENT_CHARS) throw new Error(`Chapter ${index + 1} is too short to be manuscript prose.`);
    if (/provider unavailable|human decision needed|draft pending/i.test(content)) {
      throw new Error(`Chapter ${index + 1} contains fallback or placeholder text.`);
    }
    return { chapter_number: chapterNumber, title, content };
  });

  return normalized;
}

function persistChapters(db, workspaceId, chapters, outline) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const chapter of chapters) {
      Chapter.create(db, workspaceId, {
        title: chapter.title,
        content: chapter.content,
        position: chapter.chapter_number - 1
      });
    }
    Outline.upsert(db, workspaceId, outline);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export async function materializeAutonomousBook(db, { workspaceId, dispatchId }) {
  if (assistMode(db, workspaceId) !== 'autonomous_studio') {
    return { status: 'skipped', reason: 'assist_mode_not_autonomous_studio' };
  }

  const run = storyEngineRun(db, workspaceId, dispatchId);
  if (!run) return { status: 'skipped', reason: 'story_engine_run_not_found' };
  const intent = safeJson(run.intent_json, {});
  if (intent.medium !== 'book') return { status: 'skipped', reason: 'medium_not_book' };

  const existing = Chapter.list(db, workspaceId);
  if (existing.length) {
    const nonEmpty = existing.filter(chapter => String(chapter.content || '').trim()).length;
    if (nonEmpty !== existing.length) {
      throw new Error('Autonomous book generation found partial or empty existing chapters and refused to overwrite them.');
    }
    return {
      status: 'existing_manuscript_preserved',
      chapter_count: existing.length,
      word_count: existing.reduce((sum, chapter) => sum + wordCount(chapter.content), 0)
    };
  }

  const ghostPlan = safeJson(run.ghost_plan_json, {});
  if (ghostPlan.draft?.status === 'fallback_stub') {
    throw new Error('Autonomous book generation cannot continue from a writing-provider fallback stub.');
  }

  const chapterCount = boundedChapterCount(process.env.AUTONOMOUS_BOOK_CHAPTER_COUNT);
  const architecture = generateArchitecture({
    title: intent.title,
    genre: intent.story_kind,
    audience: intent.audience,
    premise: intent.story_vision,
    format: 'book',
    chapter_count: chapterCount
  });
  const fingerprint = buildVoiceFingerprint({}, intent);
  const request = {
    task: 'chapter_generation',
    maxTokens: Number(process.env.AUTONOMOUS_BOOK_MAX_TOKENS || 8192),
    temperature: Number(process.env.AUTONOMOUS_BOOK_TEMPERATURE || 0.72),
    system: [
      'You are Ghost inside L99 StoryEngine.',
      'Write original book prose from the creator-approved creative contract.',
      'Preserve creator authority, continuity, and audience fit.',
      'Return only the requested JSON manuscript envelope.'
    ].join('\n')
  };
  const configuredProvider = process.env.GHOST_WRITER_PROVIDER || process.env.DEFAULT_WRITING_LLM;
  if (configuredProvider) request.provider = configuredProvider;

  const receipt = await completeWithReceipt(
    buildPrompt(intent, architecture, fingerprint, ghostPlan.draft?.draft_unit),
    request
  );
  const chapters = validateManuscript(extractJson(receipt.text), architecture.target_chapter_count);
  const outline = architectureToOutline(architecture);
  persistChapters(db, workspaceId, chapters, outline);

  const totalWords = chapters.reduce((sum, chapter) => sum + wordCount(chapter.content), 0);
  const fingerprintHash = createHash('sha256')
    .update(chapters.map(chapter => `${chapter.title}\n${chapter.content}`).join('\n\n'))
    .digest('hex');
  const manuscriptReceipt = {
    status: 'persisted',
    chapter_count: chapters.length,
    word_count: totalWords,
    content_fingerprint: fingerprintHash,
    provider: receipt.provenance?.provider || configuredProvider || null,
    requested_model: receipt.provenance?.requested_model || null,
    response_model: receipt.provenance?.response_model || null,
    response_id: receipt.provenance?.response_id || null,
    architecture_id: architecture.architecture_id,
    generated_at: Date.now()
  };

  db.prepare('UPDATE story_engine_runs SET ghost_plan_json=?, updated_at=? WHERE run_id=?')
    .run(JSON.stringify({ ...ghostPlan, manuscript: manuscriptReceipt }), Date.now(), run.run_id);
  log(db, {
    workspace_id: workspaceId,
    mode: 'story_engine',
    event_type: 'story_engine.book_manuscript.persisted',
    payload: {
      run_id: run.run_id,
      dispatch_id: dispatchId,
      chapter_count: chapters.length,
      word_count: totalWords,
      content_fingerprint: fingerprintHash,
      provider: manuscriptReceipt.provider,
      requested_model: manuscriptReceipt.requested_model,
      response_model: manuscriptReceipt.response_model,
      response_id: manuscriptReceipt.response_id
    }
  });

  return manuscriptReceipt;
}
