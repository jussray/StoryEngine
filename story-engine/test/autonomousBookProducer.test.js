import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { startStoryEngineRun, getStoryEngineRun } from '../lib/storyEngineOrchestrator.js';
import { setWorkspaceAssist } from '../lib/assistMode.js';
import { drainRuntimeQueue } from '../lib/runtimeDispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
const TEST_IDENTITY = Object.freeze({ tenant_id: 'tenant-book-test', actor_id: 'actor-book-test', role: 'creator' });

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function chapterContent(number) {
  return [
    `Chapter ${number} opens with Mara following a pale blue light through the closed library after midnight.`,
    'The old building answers every careful step with a wooden sigh, and the map in her pocket grows warmer as she nears the astronomy room.',
    'She makes a concrete choice, learns something that changes what she believed about her family, and pays a small but real cost for moving forward.',
    'By the final page of the chapter, a new fact changes the direction of the mystery and forces her to decide whether courage means continuing alone or trusting someone else.'
  ].join(' ');
}

async function startProviderStub() {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const prompt = body.messages?.at(-1)?.content || '';
    const isManuscript = /JSON schema:/i.test(prompt) && /complete compact first-draft book manuscript/i.test(prompt);
    const content = isManuscript
      ? JSON.stringify({
          chapters: Array.from({ length: 6 }, (_, index) => ({
            chapter_number: index + 1,
            title: `The Library Light ${index + 1}`,
            content: chapterContent(index + 1)
          }))
        })
      : `${chapterContent(1)} ${chapterContent(1)}`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: isManuscript ? 'response-manuscript-test' : 'response-opening-test',
      model: 'test-local-model',
      choices: [{ message: { content } }]
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

test('Autonomous Studio persists a complete book before runtime and cannot release without real-route Playwright proof', async () => {
  const provider = await startProviderStub();
  const previous = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GHOST_WRITER_PROVIDER: process.env.GHOST_WRITER_PROVIDER,
    DEFAULT_WRITING_LLM: process.env.DEFAULT_WRITING_LLM,
    AUTONOMOUS_BOOK_CHAPTER_COUNT: process.env.AUTONOMOUS_BOOK_CHAPTER_COUNT
  };
  process.env.LLM_BASE_URL = provider.baseUrl;
  process.env.OPENROUTER_API_KEY = 'test-only-key';
  process.env.GHOST_WRITER_PROVIDER = 'openrouter';
  process.env.DEFAULT_WRITING_LLM = 'openrouter';
  process.env.AUTONOMOUS_BOOK_CHAPTER_COUNT = '6';

  const db = createDb();
  try {
    const started = await startStoryEngineRun(db, {
      story_vision: 'Write a fantasy mystery about a girl who finds a map that only appears in moonlight.',
      medium: 'book',
      audience: 'adult',
      story_kind: 'fantasy',
      emotional_effect: 'wonder',
      estimated_cost: 0,
      ...TEST_IDENTITY
    });
    setWorkspaceAssist(db, started.workspace_id, { assist_mode: 'autonomous_studio' });

    const processed = await drainRuntimeQueue(db, 5);
    assert.equal(processed.length, 1);
    assert.equal(processed[0].status, 'completed');
    assert.equal(processed[0].manuscript.status, 'persisted');
    assert.equal(processed[0].manuscript.chapter_count, 6);
    assert.ok(processed[0].manuscript.word_count > 300);

    const chapters = db.prepare('SELECT title, content, position FROM chapters WHERE workspace_id=? ORDER BY position').all(started.workspace_id);
    assert.equal(chapters.length, 6);
    assert.ok(chapters.every(chapter => chapter.title && chapter.content.length >= 240));
    assert.deepEqual(chapters.map(chapter => chapter.position), [0, 1, 2, 3, 4, 5]);
    assert.ok(db.prepare('SELECT content FROM outlines WHERE workspace_id=?').get(started.workspace_id)?.content.includes('## Act 1'));

    const runAfterRuntime = await getStoryEngineRun(db, started.run_id, { resume: true });
    assert.equal(runAfterRuntime.status, 'needs_review');
    assert.equal(runAfterRuntime.artifact.validation.passed, false);
    assert.equal(runAfterRuntime.artifact.validation.real_route_proof, false);
    assert.equal(runAfterRuntime.artifact.validation.requires_real_route, true);
    assert.equal(runAfterRuntime.artifact.validation.structural.has_persisted_units, true);

    const audit = db.prepare('SELECT blockers_json, checks_json FROM release_audits WHERE audit_id=?').get(runAfterRuntime.release_audit_id);
    const blockers = JSON.parse(audit.blockers_json);
    assert.ok(blockers.includes('artifact_validated'));
    assert.ok(blockers.includes('artifact_real_route_playwright'));
    assert.ok(!blockers.includes('chapter_presence'));
    assert.ok(!blockers.includes('chapter_completeness'));
  } finally {
    db.close();
    await provider.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
