// lib/bootstrapEngine.js

import { randomUUID } from 'node:crypto';
import { getOperatorProfile, getOperatorSummary } from './operatorProfile.js';
import { log } from '../models/eventModel.js';

export const DEFAULT_BOOTSTRAP_PROVIDERS = Object.freeze([
  { category: 'compute', provider: 'Fly.io', purpose: 'Host the Node API and worker processes', free_limit: 'Use current free/low-cost allowance while available', upgrade_trigger: 'Sustained CPU pressure, repeated restarts, or paid usage with better alternatives', replacement: 'Render, Railway, Cloudflare Workers, or managed container host' },
  { category: 'database', provider: 'Turso', purpose: 'Remote SQLite-compatible data layer', free_limit: '500 MB target ceiling configured by operator', upgrade_trigger: 'Storage above 80%, write contention, regional latency, or multi-tenant integrity needs', replacement: 'Managed PostgreSQL' },
  { category: 'ai_routing', provider: 'OpenRouter', purpose: 'Route free and paid writing models beside OpenAI and Anthropic', free_limit: 'Free model availability varies by model and provider', upgrade_trigger: 'Quality, reliability, privacy, or latency cannot meet the active writing profile', replacement: 'Direct OpenAI/Anthropic or another compatible gateway' },
  { category: 'authentication', provider: 'Clerk', purpose: 'Users, sessions, organizations, and roles', free_limit: 'Operator-configured free-tier ceiling', upgrade_trigger: 'Active users or required enterprise controls exceed the free tier', replacement: 'Supabase Auth, Auth0, or self-managed auth' },
  { category: 'storage', provider: 'Cloudflare R2', purpose: 'Books, images, video, storyboards, and campaign artifacts', free_limit: 'Operator-configured free storage and request allowance', upgrade_trigger: 'Storage/request costs exceed the approved budget or workflow needs another object store', replacement: 'S3-compatible storage' },
  { category: 'email', provider: 'Resend', purpose: 'Invites, reports, receipts, and release notifications', free_limit: '3,000 emails/month target ceiling', upgrade_trigger: '80% of monthly allowance or delivery requirements exceed current plan', replacement: 'Postmark, SES, or another transactional provider' },
  { category: 'payments', provider: 'Stripe', purpose: 'Subscriptions and one-time payments', free_limit: 'No recurring platform charge before payment processing', upgrade_trigger: 'Only replace for unsupported markets, pricing, or payout requirements', replacement: 'Alternative payment processor' },
  { category: 'errors', provider: 'Sentry', purpose: 'Exceptions, traces, and production failure alerts', free_limit: 'Operator-configured event allowance', upgrade_trigger: 'Dropped errors, retention gaps, or alerting limits hide production incidents', replacement: 'OpenTelemetry plus another error backend' },
  { category: 'analytics', provider: 'PostHog', purpose: 'Funnels, feature adoption, and product analytics', free_limit: 'Operator-configured event allowance', upgrade_trigger: 'Event volume exceeds free tier or privacy/hosting requirements change', replacement: 'Self-hosted PostHog or another analytics system' }
]);

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_providers (
      provider_id TEXT PRIMARY KEY,
      category TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      enabled INTEGER NOT NULL DEFAULT 1,
      monthly_cost REAL NOT NULL DEFAULT 0,
      usage_value REAL NOT NULL DEFAULT 0,
      limit_value REAL,
      usage_unit TEXT,
      free_limit TEXT NOT NULL DEFAULT '',
      upgrade_trigger TEXT NOT NULL DEFAULT '',
      replacement TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bootstrap_decisions (
      decision_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      action TEXT NOT NULL,
      lindy_score INTEGER NOT NULL,
      confidence_score INTEGER NOT NULL,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_decisions_created ON bootstrap_decisions(created_at DESC);
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bootstrap_providers (
      provider_id, category, provider, purpose, status, enabled, monthly_cost,
      usage_value, limit_value, usage_unit, free_limit, upgrade_trigger,
      replacement, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'planned', 1, 0, 0, NULL, NULL, ?, ?, ?, '{}', ?, ?)
  `);
  const now = Date.now();
  for (const item of DEFAULT_BOOTSTRAP_PROVIDERS) {
    insert.run(`provider_${item.category}`, item.category, item.provider, item.purpose, item.free_limit, item.upgrade_trigger, item.replacement, now, now);
  }
}

function hydrate(row) {
  if (!row) return null;
  return { ...row, enabled: Boolean(row.enabled), metadata: parseJson(row.metadata_json, {}) };
}

export function listBootstrapProviders(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM bootstrap_providers ORDER BY category').all().map(hydrate);
}

export function updateBootstrapProvider(db, category, input = {}) {
  ensureSchema(db);
  const current = db.prepare('SELECT * FROM bootstrap_providers WHERE category=?').get(category);
  if (!current) throw new Error(`Unknown bootstrap provider category: ${category}.`);
  const now = Date.now();
  db.prepare(`
    UPDATE bootstrap_providers SET
      provider=?, purpose=?, status=?, enabled=?, monthly_cost=?, usage_value=?,
      limit_value=?, usage_unit=?, free_limit=?, upgrade_trigger=?, replacement=?,
      metadata_json=?, updated_at=?
    WHERE category=?
  `).run(
    String(input.provider || current.provider),
    String(input.purpose || current.purpose),
    String(input.status || current.status),
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    Math.max(0, number(input.monthly_cost, current.monthly_cost)),
    Math.max(0, number(input.usage_value, current.usage_value)),
    input.limit_value === null ? null : Math.max(0, number(input.limit_value, current.limit_value)),
    input.usage_unit === undefined ? current.usage_unit : String(input.usage_unit || '') || null,
    String(input.free_limit || current.free_limit),
    String(input.upgrade_trigger || current.upgrade_trigger),
    String(input.replacement || current.replacement),
    JSON.stringify(input.metadata || parseJson(current.metadata_json, {})),
    now,
    category
  );
  const provider = hydrate(db.prepare('SELECT * FROM bootstrap_providers WHERE category=?').get(category));
  log(db, { workspace_id: 'control-room', mode: 'bootstrap_engine', event_type: 'bootstrap.provider.updated', payload: { category, provider: provider.provider, monthly_cost: provider.monthly_cost, status: provider.status } });
  return provider;
}

function evaluateProvider(provider, profile) {
  const limit = provider.limit_value == null ? null : Number(provider.limit_value);
  const usage = Number(provider.usage_value || 0);
  const usageRatio = limit && limit > 0 ? usage / limit : null;
  const monthlyCost = Number(provider.monthly_cost || 0);
  const reasons = [];
  let action = 'stay';
  let score = 100;

  if (!provider.enabled) {
    action = 'disabled';
    score = 50;
    reasons.push('Provider is disabled.');
  }
  if (usageRatio != null && usageRatio >= 1) {
    action = 'migrate_or_upgrade';
    score -= 45;
    reasons.push('Usage is at or above the configured limit.');
  } else if (usageRatio != null && usageRatio >= 0.8) {
    action = 'prepare_upgrade';
    score -= 20;
    reasons.push('Usage is above 80% of the configured limit.');
  } else if (usageRatio != null) {
    reasons.push(`Usage is ${Math.round(usageRatio * 100)}% of the configured limit.`);
  }

  if (profile.prefer_free && monthlyCost > 0) {
    score -= Math.min(35, Math.ceil(monthlyCost));
    reasons.push('Bootstrap Mode prefers a free alternative until the cost proves measurable value.');
  }
  if (monthlyCost > Number(profile.approval_threshold || 0) && monthlyCost > 0) {
    action = action === 'stay' ? 'operator_review' : action;
    score -= 15;
    reasons.push('Monthly cost exceeds the operator approval threshold.');
  }
  if (!reasons.length) reasons.push('No configured usage or cost pressure requires a change.');

  const lindyScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    category: provider.category,
    provider: provider.provider,
    status: provider.status,
    monthly_cost: monthlyCost,
    usage: { value: usage, limit, unit: provider.usage_unit, ratio: usageRatio },
    action,
    lindy_score: lindyScore,
    confidence_score: limit == null ? 72 : 92,
    reasons,
    upgrade_trigger: provider.upgrade_trigger,
    replacement: provider.replacement
  };
}

export function evaluateBootstrapStack(db, { persist = false } = {}) {
  ensureSchema(db);
  const profile = getOperatorProfile(db);
  const providers = listBootstrapProviders(db);
  const evaluations = providers.map(provider => evaluateProvider(provider, profile));
  const monthlyCost = providers.reduce((sum, provider) => sum + Number(provider.monthly_cost || 0), 0);
  const atRisk = evaluations.filter(item => ['prepare_upgrade', 'migrate_or_upgrade', 'operator_review'].includes(item.action));
  const freeCount = providers.filter(provider => Number(provider.monthly_cost || 0) === 0).length;
  const stackScore = evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + item.lindy_score, 0) / evaluations.length) : 100;

  if (persist) {
    const insert = db.prepare(`INSERT INTO bootstrap_decisions (decision_id, category, provider, action, lindy_score, confidence_score, reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = Date.now();
    db.transaction(() => {
      for (const item of evaluations) insert.run(`bootstrap_${randomUUID()}`, item.category, item.provider, item.action, item.lindy_score, item.confidence_score, JSON.stringify(item.reasons), now);
    })();
    log(db, { workspace_id: 'control-room', mode: 'bootstrap_engine', event_type: 'bootstrap.stack.evaluated', payload: { stack_score: stackScore, monthly_cost: monthlyCost, at_risk_count: atRisk.length } });
  }

  return {
    mode: profile.mode,
    principle: 'Being broke is the Lindy filter: spend only when the simpler free path no longer protects quality, reliability, or revenue.',
    monthly_stack_cost: monthlyCost,
    free_provider_count: freeCount,
    provider_count: providers.length,
    free_tier_share: providers.length ? Math.round((freeCount / providers.length) * 100) : 100,
    lindy_score: stackScore,
    at_risk_count: atRisk.length,
    recommended_next_paid_upgrade: atRisk.sort((a, b) => a.lindy_score - b.lindy_score)[0] || null,
    evaluations
  };
}

export function founderEconomicsOverview(db) {
  const stack = evaluateBootstrapStack(db);
  const operator = getOperatorSummary(db);
  return {
    ...stack,
    monthly_spend: operator.monthly_spend,
    monthly_revenue: operator.monthly_revenue,
    monthly_profit: operator.monthly_profit,
    budget_remaining: operator.budget_remaining,
    runway: operator.runway,
    recommendation: stack.at_risk_count
      ? 'Prepare only the lowest-scoring required upgrade; do not migrate the entire stack.'
      : 'Stay lean. The current stack has not earned a paid migration.'
  };
}
