import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  listBootstrapProviders,
  updateBootstrapProvider,
  evaluateBootstrapStack,
  founderEconomicsOverview
} from '../lib/bootstrapEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('Bootstrap Engine initializes the founder stack', () => {
  const db = createDb();
  const providers = listBootstrapProviders(db);
  const names = new Set(providers.map(item => item.provider));
  assert.equal(providers.length, 9);
  assert.ok(names.has('Fly.io'));
  assert.ok(names.has('Turso'));
  assert.ok(names.has('OpenRouter'));
  assert.ok(names.has('Clerk'));
  assert.ok(names.has('Cloudflare R2'));
  assert.ok(names.has('Resend'));
  assert.ok(names.has('Stripe'));
  assert.ok(names.has('Sentry'));
  assert.ok(names.has('PostHog'));
  db.close();
});

test('Bootstrap Engine recommends staying lean when usage and cost are low', () => {
  const db = createDb();
  const result = evaluateBootstrapStack(db);
  assert.equal(result.monthly_stack_cost, 0);
  assert.equal(result.free_tier_share, 100);
  assert.equal(result.at_risk_count, 0);
  assert.match(result.principle, /Lindy filter/);
  db.close();
});

test('Bootstrap Engine prepares an upgrade near a configured limit', () => {
  const db = createDb();
  updateBootstrapProvider(db, 'database', {
    status: 'active',
    usage_value: 425,
    limit_value: 500,
    usage_unit: 'MB'
  });
  const result = evaluateBootstrapStack(db, { persist: true });
  const database = result.evaluations.find(item => item.category === 'database');
  assert.equal(database.action, 'prepare_upgrade');
  assert.equal(database.usage.ratio, 0.85);
  assert.ok(result.at_risk_count >= 1);
  const decisions = db.prepare('SELECT * FROM bootstrap_decisions WHERE category=?').all('database');
  assert.equal(decisions.length, 1);
  db.close();
});

test('Founder Economics combines provider and operator economics', () => {
  const db = createDb();
  const overview = founderEconomicsOverview(db);
  assert.equal(overview.monthly_stack_cost, 0);
  assert.equal(overview.monthly_spend, 0);
  assert.equal(overview.monthly_revenue, 0);
  assert.match(overview.recommendation, /Stay lean/);
  db.close();
});
