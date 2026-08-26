import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveStoryEngineAssistMode,
  startHumanLedStoryEngineRun
} from '../lib/storyEngineAssistAuthority.js';
import { setOperatorAssistDefault } from '../lib/assistMode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function storyInput(overrides = {}) {
  return {
    story_vision: 'Write a middle-grade fantasy novel about a girl who finds a sleeping moon.',
    medium: 'book',
    audience: 'middle_grade',
    story_kind: 'fantasy',
    emotional_effect: 'wonder',
    ...overrides
  };
}

function assertNoProviderPipelineWork(db, run) {
  assert.deepEqual(run.ghost_plan, {});
  assert.deepEqual(run.ooda_decision, {});
  assert.equal(run.dispatch_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lindymode_state WHERE workspace_id=?').get(run.workspace_id).count, 0);
  assert.equal(run.stages.some(stage => stage.stage === 'ghost'), false);
  assert.equal(run.stages.some(stage => stage.stage === 'ooda'), false);
  assert.equal(run.stages.some(stage => stage.stage === 'runtime'), false);
}

test('default Writer authority is resolved before any Ghost or runtime work starts', async () => {
  const db = createDb();
  assert.equal(resolveStoryEngineAssistMode(db), 'writer');

  const run = await startHumanLedStoryEngineRun(db, storyInput(), 'writer');

  assert.equal(run.status, 'writer_active');
  assert.equal(run.current_stage, 'story_engine');
  assert.equal(run.active_agent, 'Human');
  assert.equal(run.assist_profile.assist_mode, 'writer');
  assert.equal(run.assist_profile.permissions.may_draft_without_request, false);
  assert.equal(run.assist_profile.permissions.may_run_full_pipeline, false);
  assert.ok(db.prepare('SELECT * FROM creative_profiles WHERE workspace_id=?').get(run.workspace_id));
  assertNoProviderPipelineWork(db, run);
  db.close();
});

test('Co-Writer initializes shared authority without silently drafting or dispatching', async () => {
  const db = createDb();
  const run = await startHumanLedStoryEngineRun(db, storyInput({ assist_mode: 'co_writer' }), 'co_writer');

  assert.equal(run.status, 'co_writer_ready');
  assert.equal(run.active_agent, 'Human + L99');
  assert.equal(run.assist_profile.assist_mode, 'co_writer');
  assert.equal(run.assist_profile.permissions.may_draft_without_request, false);
  assert.equal(run.assist_profile.permissions.may_run_full_pipeline, false);
  assertNoProviderPipelineWork(db, run);
  db.close();
});

test('legacy/default assist aliases resolve before orchestration authority is selected', () => {
  const db = createDb();
  assert.equal(resolveStoryEngineAssistMode(db, 'human_first'), 'writer');
  assert.equal(resolveStoryEngineAssistMode(db, 'system_first'), 'director');
  setOperatorAssistDefault(db, 'co_writer');
  assert.equal(resolveStoryEngineAssistMode(db), 'co_writer');
  assert.throws(() => resolveStoryEngineAssistMode(db, 'not-a-mode'), /Unsupported assist mode/);
  db.close();
});
