// lib/founderProfile.js

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';

const MODES = new Set(['bootstrap', 'growth', 'enterprise', 'research']);

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function bool(value, fallback = false) {
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  return fallback;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function ensureFounderSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS founder_profiles (
      profile_id TEXT PRIMARY KEY,
      founder_name TEXT NOT NULL DEFAULT 'Founder',
      mode TEXT NOT NULL DEFAULT 'bootstrap',
      monthly_budget REAL NOT NULL DEFAULT 0,
      recurring_budget REAL NOT NULL DEFAULT 0,
      approval_threshold REAL NOT NULL DEFAULT 0,
      monthly_revenue REAL NOT NULL DEFAULT 0,
      cash_available REAL NOT NULL DEFAULT 0,
      prefer_free INTEGER NOT NULL DEFAULT 1,
      require_recurring_approval INTEGER NOT NULL DEFAULT 1,
      preferred_quality TEXT NOT NULL DEFAULT 'acceptable',
      notes TEXT NOT NULL DEFAULT '',
      rules_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS founder_cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cost_id TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      provider TEXT,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      recurring INTEGER NOT NULL DEFAULT 0,
      revenue INTEGER NOT NULL DEFAULT 0,
      workspace_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_founder_cost_events_created ON founder_cost_events(created_at);
  `);

  if (!db.prepare("SELECT 1 FROM founder_profiles WHERE profile_id='primary'").get()) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO founder_profiles (
        profile_id, founder_name, mode, monthly_budget, recurring_budget,
        approval_threshold, monthly_revenue, cash_available, prefer_free,
        require_recurring_approval, preferred_quality, notes, rules_json,
        version, created_at, updated_at
      ) VALUES ('primary', 'Raylene', 'bootstrap', 0, 0, 0, 0, 0, 1, 1,
                'acceptable', 'Founder remains in control.', ?, 1, ?, ?)
    `).run(JSON.stringify([
      'Prefer free services when quality is acceptable.',
      'Require founder approval for recurring costs.',
      'Receive customer revenue before paid execution when possible.',
      'Keep the human founder as final decision-maker.'
    ]), now, now);
  }
}

function hydrate(row) {
  return row ? {
    ...row,
    prefer_free: Boolean(row.prefer_free),
    require_recurring_approval: Boolean(row.require_recurring_approval),
    rules: parseJson(row.rules_json, [])
  } : null;
}

export function getFounderProfile(db) {
  ensureFounderSchema(db);
  return hydrate(db.prepare("SELECT * FROM founder_profiles WHERE profile_id='primary'").get());
}

export function updateFounderProfile(db, input = {}) {
  const current = getFounderProfile(db);
  const mode = text(input.mode, current.mode).toLowerCase();
  if (!MODES.has(mode)) throw new Error(`Unsupported founder mode: ${mode}.`);
  const rules = Array.isArray(input.rules) ? input.rules.map(String).map(item => item.trim()).filter(Boolean) : current.rules;
  const now = Date.now();

  db.prepare(`
    UPDATE founder_profiles SET
      founder_name=?, mode=?, monthly_budget=?, recurring_budget=?, approval_threshold=?,
      monthly_revenue=?, cash_available=?, prefer_free=?, require_recurring_approval=?,
      preferred_quality=?, notes=?, rules_json=?, version=version+1, updated_at=?
    WHERE profile_id='primary'
  `).run(
    text(input.founder_name, current.founder_name), mode,
    Math.max(0, num(input.monthly_budget, current.monthly_budget)),
    Math.max(0, num(input.recurring_budget, current.recurring_budget)),
    Math.max(0, num(input.approval_threshold, current.approval_threshold)),
    Math.max(0, num(input.monthly_revenue, current.monthly_revenue)),
    Math.max(0, num(input.cash_available, current.cash_available)),
    bool(input.prefer_free, current.prefer_free) ? 1 : 0,
    bool(input.require_recurring_approval, current.require_recurring_approval) ? 1 : 0,
    text(input.preferred_quality, current.preferred_quality),
    text(input.notes, current.notes), JSON.stringify(rules), now
  );

  const profile = getFounderProfile(db);
  log(db, {
    workspace_id: 'control-room', mode: 'founder_profile', event_type: 'founder_profile.updated',
    payload: { mode: profile.mode, monthly_budget: profile.monthly_budget, approval_threshold: profile.approval_threshold, version: profile.version }
  });
  return profile;
}

export function recordFounderEvent(db, input = {}) {
  ensureFounderSchema(db);
  const amount = Math.max(0, num(input.amount));
  const description = text(input.description);
  if (!description) throw new Error('description is required.');
  if (amount <= 0) throw new Error('amount must be greater than zero.');
  const costId = randomUUID();
  const now = Date.now();
  const revenue = bool(input.revenue);
  db.prepare(`
    INSERT INTO founder_cost_events (
      cost_id, category, provider, description, amount, recurring, revenue,
      workspace_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    costId, text(input.category, 'other').toLowerCase(), text(input.provider) || null,
    description, amount, bool(input.recurring) ? 1 : 0, revenue ? 1 : 0,
    text(input.workspace_id) || null, JSON.stringify(input.metadata || {}), now
  );
  log(db, {
    workspace_id: text(input.workspace_id, 'control-room'), mode: 'founder_profile',
    event_type: revenue ? 'founder.revenue_recorded' : 'founder.cost_recorded',
    payload: { cost_id: costId, amount, category: input.category || 'other' }
  });
  return { cost_id: costId, amount, revenue, created_at: now };
}

export function getFounderSummary(db, now = Date.now()) {
  const profile = getFounderProfile(db);
  const date = new Date(now);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const rows = db.prepare('SELECT * FROM founder_cost_events WHERE created_at >= ? ORDER BY created_at DESC').all(monthStart);
  const trackedRevenue = rows.filter(row => row.revenue).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const spend = rows.filter(row => !row.revenue).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const recurringSpend = rows.filter(row => !row.revenue && row.recurring).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenue = Math.max(Number(profile.monthly_revenue || 0), trackedRevenue);
  const profit = revenue - spend;
  let recommendation = 'Stay in Bootstrap Mode. Use free infrastructure and ship.';
  if (profile.mode !== 'bootstrap') recommendation = `Operate in ${profile.mode} mode while preserving founder approval.`;
  else if (spend > revenue) recommendation = 'Freeze optional spending until revenue catches up.';
  else if (revenue > 0 && profit > 0) recommendation = 'Stay lean. Reinvest only where the return is measurable.';

  return {
    profile, monthly_spend: spend, monthly_recurring_spend: recurringSpend,
    monthly_revenue: revenue, monthly_profit: profit,
    budget_remaining: Math.max(0, Number(profile.monthly_budget || 0) - spend),
    burn_rate: recurringSpend,
    runway: recurringSpend > 0 ? Number(profile.cash_available || 0) / recurringSpend : null,
    recommendation, recent_events: rows.slice(0, 20), generated_at: now
  };
}

export function evaluateFounderConstraint(db, estimate = {}) {
  const summary = getFounderSummary(db);
  const profile = summary.profile;
  const amount = Math.max(0, num(estimate.estimated_cost));
  const recurring = bool(estimate.recurring);
  const reasons = [];
  if (profile.prefer_free && amount > 0) reasons.push('Consider a free alternative first.');
  if (recurring && profile.require_recurring_approval) reasons.push('Founder approval is required for recurring spend.');
  if (amount > Number(profile.approval_threshold || 0)) reasons.push('Estimated cost exceeds the founder approval threshold.');
  if (summary.monthly_spend + amount > Number(profile.monthly_budget || 0)) reasons.push('The job would exceed the monthly founder budget.');
  const requiresApproval = amount > 0 && reasons.length > 0;
  return {
    mode: profile.mode, estimated_cost: amount, recurring,
    requires_approval: requiresApproval,
    allowed_without_approval: !requiresApproval, reasons,
    recommendation: requiresApproval ? 'Wait for the founder or route to a free alternative.' : 'Proceed within Founder Profile constraints.'
  };
}

export const FOUNDER_PROFILE_OPTIONS = Object.freeze({ modes: [...MODES] });
