import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PIPELINE_STAGES,
  parseStoryIntent,
  startStoryEngineRun,
  approveStoryEngineRun,
  getStoryEngineRun,
  storyEngineBrainSnapshot
} from '../lib/storyEngineOrchestrator.js';
import { updateOperatorProfile } from '../lib/operatorProfile.js';
import { writeRunSummary, getRunSummary } from '../lib/runSummary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('intent parser resolves medium, audience, and story kind from one request', () => {
  const intent = parseStoryIntent({
    prompt: 'Write me a middle-grade fantasy novel about a girl who finds a sleeping moon.'
  });
  assert.equal(intent.medium, 'book');
  assert.equal(intent.audience, 'middle_grade');
  assert.equal(intent.story_kind, 'fantasy');
  assert.match(intent.title, /Middle-Grade Fantasy Novel/i);
});

test('all required L99 OS Alpha stages have one canonical order', () => {
  assert.deepEqual(PIPELINE_STAGES, [
    'story_engine','intent_parser','creative_profile','ghost','lindymode','ooda',
    'redteam_pre_runtime','runtime','story_memory','learning_engine',
    'playwright_validation','redteam_pre_release','artifacts','release_gate',
    'control_room','complete'
  ]);
});

test('one Story Engine request creates workspace, profile, Ghost plan, Lindymode state, OODA decision, and runtime dispatch', () => {
  const db = createDb();
  const run = startStoryEngineRun(db, {
    story_vision: 'Write a middle-grade fantasy novel about a girl who finds a sleeping moon.',
    medium: 'book',
    audience: 'middle_grade',
    story_kind: 'fantasy',
    emotional_effect: 'wonder',
    estimated_cost: 0
  });

  assert.equal(run.status, 'runtime_queued');
  assert.equal(run.current_stage, 'runtime');
  assert.equal(run.intent.medium, 'book');
  assert.equal(run.ghost_plan.tasks.length, 8);
  assert.ok(run.ooda_decision.decision_id);
  assert.ok(run.dispatch_id);
  assert.ok(run.stages.some(stage => stage.stage === 'redteam_pre_runtime' && stage.status === 'completed'));
  assert.ok(db.prepare('SELECT * FROM creative_profiles WHERE workspace_id=?').get(run.workspace_id));
  assert.ok(db.prepare('SELECT * FROM lindymode_state WHERE workspace_id=?').get(run.workspace_id));
  assert.ok(db.prepare('SELECT * FROM runtime_dispatch_queue WHERE dispatch_id=?').get(run.dispatch_id));

  const brain = storyEngineBrainSnapshot(db);
  assert.equal(brain.active_count, 1);
  assert.equal(brain.current.active_agent, 'Runtime');
  db.close();
});

test('paid Story Engine work pauses for human operator approval', () => {
  const db = createDb();
  updateOperatorProfile(db, {
    mode: 'bootstrap',
    monthly_budget: 0,
    approval_threshold: 0,
    prefer_free: true,
    require_recurring_approval: true
  });

  const blocked = startStoryEngineRun(db, {
    story_vision: 'Create an ELI10 educational comic about how rain forms.',
    medium: 'comic',
    audience: 'eli10',
    story_kind: 'educational',
    emotional_effect: 'wonder',
    estimated_cost: 0.25
  });
  assert.equal(blocked.status, 'awaiting_approval');
  assert.equal(blocked.current_stage, 'redteam_pre_runtime');
  assert.ok(blocked.pre_runtime_findings.some(finding => finding.code === 'operator_approval'));

  const approved = approveStoryEngineRun(db, blocked.run_id);
  assert.equal(approved.status, 'runtime_queued');
  assert.equal(approved.current_stage, 'runtime');
  assert.ok(approved.dispatch_id);
  db.close();
});

test('run retrieval exposes the full operating-system trace', async () => {
  const db = createDb();
  const started = startStoryEngineRun(db, {
    story_vision: 'Write a mystery podcast for teens.',
    medium: 'podcast',
    audience: 'teen',
    story_kind: 'mystery',
    emotional_effect: 'excitement',
    estimated_cost: 0
  });
  const run = await getStoryEngineRun(db, started.run_id, { resume: false });
  const stages = run.stages.map(stage => stage.stage);
  assert.deepEqual(stages.slice(0, 8), [
    'story_engine','intent_parser','creative_profile','ghost',
    'lindymode','ooda','redteam_pre_runtime','runtime'
  ]);
  assert.equal(run.active_agent, 'Runtime');
  db.close();
});

test('Control Room historian writes a searchable permanent run summary', () => {
  const db = createDb();
  const run = startStoryEngineRun(db, {
    story_vision: 'Write an ELI10 adventure about a small robot learning courage.',
    medium: 'book',
    audience: 'eli10',
    story_kind: 'adventure',
    emotional_effect: 'hope',
    estimated_cost: 0
  });

  db.prepare(`
    INSERT INTO release_audits (
      audit_id, workspace_id, result, confidence_score,
      checks_json, blockers_json, created_at
    ) VALUES ('audit-test', ?, 'READY', 91, '[]', '[]', ?)
  `).run(run.workspace_id, Date.now());
  db.prepare('UPDATE story_engine_runs SET release_audit_id=? WHERE run_id=?').run('audit-test', run.run_id);

  const summary = writeRunSummary(db, run.run_id, {
    final_status: 'complete',
    release_result: 'READY',
    confidence_before: 82,
    confidence_after: 91
  });
  assert.equal(summary.final_status, 'complete');
  assert.equal(summary.release_result, 'READY');
  assert.equal(summary.confidence_before, 82);
  assert.equal(summary.confidence_after, 91);
  assert.equal(summary.summary.request, run.request_text);
  assert.ok(summary.stage_timings.length >= 8);
  assert.equal(getRunSummary(db, run.run_id).summary_id, summary.summary_id);
  db.close();
});
