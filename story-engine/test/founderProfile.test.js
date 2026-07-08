import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getOperatorProfile,
  updateOperatorProfile,
  recordOperatorEvent,
  getOperatorSummary,
  evaluateOperatorConstraint,
  getOperatorAlerts
} from '../lib/operatorProfile.js';
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

function seedWorkspace(db, workspaceId = 'operator-workspace') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, schema_version, created_at, updated_at)
    VALUES (?, 'Operator Story', 'fantasy', 'A child finds a sleeping star.', '1.0.0', ?, ?)
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

test('Operator Profile defaults to Bootstrap with zero-cost controls', () => {
  const db = createDb();
  const profile = getOperatorProfile(db);
  assert.equal(profile.operator_name, 'Operator');
  assert.equal(profile.mode, 'bootstrap');
  assert.equal(profile.monthly_budget, 0);
  assert.equal(profile.approval_threshold, 0);
  assert.equal(profile.prefer_free, true);
  assert.equal(profile.require_recurring_approval, true);
  db.close();
});

test('Operator Profile updates while preserving human control', () => {
  const db = createDb();
  const profile = updateOperatorProfile(db, {
    operator_name: 'Studio Operator',
    mode: 'bootstrap',
    monthly_budget: 25,
    approval_threshold: 1,
    monthly_revenue: 29,
    cash_available: 29,
    prefer_free: true,
    require_recurring_approval: true
  });
  assert.equal(profile.version, 2);
  assert.equal(profile.operator_name, 'Studio Operator');
  assert.equal(profile.monthly_budget, 25);
  assert.equal(profile.monthly_revenue, 29);
  assert.equal(profile.require_recurring_approval, true);
  db.close();
});

test('Cost ledger calculates revenue, spend, profit, burn, and runway', () => {
  const db = createDb();
  updateOperatorProfile(db, { monthly_budget: 10, cash_available: 20 });
  recordOperatorEvent(db, { category: 'sale', description: 'Continuity Audit', amount: 29, revenue: true });
  recordOperatorEvent(db, { category: 'ai', provider: 'OpenRouter', description: 'Audit inference', amount: 0.45 });
  recordOperatorEvent(db, { category: 'hosting', description: 'Paid host', amount: 2, recurring: true });
  const summary = getOperatorSummary(db);
  assert.equal(summary.monthly_revenue, 29);
  assert.equal(summary.monthly_spend, 2.45);
  assert.equal(summary.monthly_recurring_spend, 2);
  assert.equal(summary.monthly_profit, 26.55);
  assert.equal(summary.runway, 10);
  db.close();
});

test('Bootstrap Operator Profile requires approval for paid work', () => {
  const db = createDb();
  const free = evaluateOperatorConstraint(db, { estimated_cost: 0 });
  const paid = evaluateOperatorConstraint(db, { estimated_cost: 0.45 });
  const recurring = evaluateOperatorConstraint(db, { estimated_cost: 1, recurring: true });
  assert.equal(free.allowed_without_approval, true);
  assert.equal(paid.requires_approval, true);
  assert.ok(paid.reasons.some(reason => /free alternative/i.test(reason)));
  assert.equal(recurring.requires_approval, true);
  assert.ok(recurring.reasons.some(reason => /recurring/i.test(reason)));
  db.close();
});

test('Operator Alerts surface budget, recurring, growth, and operations signals', () => {
  const db = createDb();
  updateOperatorProfile(db, { monthly_budget: 1, recurring_budget: 0, monthly_revenue: 5 });
  recordOperatorEvent(db, { category: 'hosting', description: 'Paid host', amount: 2, recurring: true });
  const alerts = getOperatorAlerts(db, { runtime_failures: 1, release_gate_blocked_count: 2, active_incidents: 3 });
  assert.ok(alerts.some(alert => alert.code === 'budget_exceeded'));
  assert.ok(alerts.some(alert => alert.code === 'recurring_budget_exceeded'));
  assert.ok(alerts.some(alert => alert.code === 'runtime_failures'));
  assert.ok(alerts.some(alert => alert.code === 'release_blocked'));
  assert.ok(alerts.some(alert => alert.code === 'active_incidents'));
  db.close();
});

test('Control Room overview includes Operator Profile and alerts', () => {
  const db = createDb();
  seedWorkspace(db);
  const overview = buildControlRoomOverview(db);
  assert.equal(overview.operator.profile.mode, 'bootstrap');
  assert.equal(overview.operator.monthly_spend, 0);
  assert.match(overview.operator.recommendation, /Bootstrap/i);
  assert.ok(Array.isArray(overview.operator_alerts));
  assert.ok(overview.operator_alerts.some(alert => alert.code === 'bootstrap_active'));
  db.close();
});

test('OODA includes Operator Profile constraints in every decision', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const decision = evaluateWorkspace(db, workspaceId);
  assert.equal(decision.operator_constraints.mode, 'bootstrap');
  assert.equal(decision.operator_constraints.monthly_budget, 0);
  assert.equal(decision.operator_constraints.prefer_free, true);
  assert.equal(decision.operator_constraints.require_recurring_approval, true);
  assert.equal(decision.operator_constraints.zero_cost_evaluation.allowed_without_approval, true);
  assert.equal(decision.evidence.operator_profile.operator_name, 'Operator');
  db.close();
});
