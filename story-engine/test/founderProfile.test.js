import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getFounderProfile,
  updateFounderProfile,
  recordFounderEvent,
  getFounderSummary,
  evaluateFounderConstraint
} from '../lib/founderProfile.js';
import { buildControlRoomOverview } from '../routes/controlRoom.js';
import { evaluateWorkspace } from '../lib/decisionEngine.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'founder-workspace') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, schema_version, created_at, updated_at)
    VALUES (?, 'Founder Story', 'fantasy', 'A child finds a sleeping star.', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, 'Healthy', 'third_person', 'opening', 4000, '{}', 1, ?)
  `).run(workspaceId, now);
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'A child finds a sleeping star and helps it return home.',
    story_kind: 'fantasy',
    emotional_effect: 'wonder',
    medium: 'picture_book',
    audience: 'eli10',
    tone: 'gentle',
    goal: 'entertain_and_teach'
  });
  return workspaceId;
}

test('Founder Profile defaults to Bootstrap with zero-cost controls', () => {
  const db = createDb();
  const profile = getFounderProfile(db);
  assert.equal(profile.founder_name, 'Raylene');
  assert.equal(profile.mode, 'bootstrap');
  assert.equal(profile.monthly_budget, 0);
  assert.equal(profile.approval_threshold, 0);
  assert.equal(profile.prefer_free, true);
  assert.equal(profile.require_recurring_approval, true);
  db.close();
});

test('Founder Profile updates while preserving human control', () => {
  const db = createDb();
  const profile = updateFounderProfile(db, {
    mode: 'bootstrap',
    monthly_budget: 25,
    approval_threshold: 1,
    monthly_revenue: 29,
    cash_available: 29,
    prefer_free: true,
    require_recurring_approval: true
  });
  assert.equal(profile.version, 2);
  assert.equal(profile.monthly_budget, 25);
  assert.equal(profile.monthly_revenue, 29);
  assert.equal(profile.require_recurring_approval, true);
  db.close();
});

test('Cost ledger calculates revenue, spend, profit, burn, and runway', () => {
  const db = createDb();
  updateFounderProfile(db, { monthly_budget: 10, cash_available: 20 });
  recordFounderEvent(db, { category: 'sale', description: 'Continuity Audit', amount: 29, revenue: true });
  recordFounderEvent(db, { category: 'ai', provider: 'OpenRouter', description: 'Audit inference', amount: 0.45 });
  recordFounderEvent(db, { category: 'hosting', description: 'Paid host', amount: 2, recurring: true });
  const summary = getFounderSummary(db);
  assert.equal(summary.monthly_revenue, 29);
  assert.equal(summary.monthly_spend, 2.45);
  assert.equal(summary.monthly_recurring_spend, 2);
  assert.equal(summary.monthly_profit, 26.55);
  assert.equal(summary.runway, 10);
  db.close();
});

test('Bootstrap Founder Profile requires approval for paid work', () => {
  const db = createDb();
  const free = evaluateFounderConstraint(db, { estimated_cost: 0 });
  const paid = evaluateFounderConstraint(db, { estimated_cost: 0.45 });
  const recurring = evaluateFounderConstraint(db, { estimated_cost: 1, recurring: true });
  assert.equal(free.allowed_without_approval, true);
  assert.equal(paid.requires_approval, true);
  assert.ok(paid.reasons.some(reason => /free alternative/i.test(reason)));
  assert.equal(recurring.requires_approval, true);
  assert.ok(recurring.reasons.some(reason => /recurring/i.test(reason)));
  db.close();
});

test('Control Room overview includes Founder Profile', () => {
  const db = createDb();
  seedWorkspace(db);
  const overview = buildControlRoomOverview(db);
  assert.equal(overview.founder.profile.mode, 'bootstrap');
  assert.equal(overview.founder.monthly_spend, 0);
  assert.match(overview.founder.recommendation, /Bootstrap/i);
  db.close();
});

test('OODA includes Founder Profile constraints in every decision', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const decision = evaluateWorkspace(db, workspaceId);
  assert.equal(decision.founder_constraints.mode, 'bootstrap');
  assert.equal(decision.founder_constraints.monthly_budget, 0);
  assert.equal(decision.founder_constraints.prefer_free, true);
  assert.equal(decision.founder_constraints.require_recurring_approval, true);
  assert.equal(decision.founder_constraints.zero_cost_evaluation.allowed_without_approval, true);
  assert.equal(decision.evidence.founder_profile.founder_name, 'Raylene');
  db.close();
});
