// lib/operatorProfile.js

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

export function ensureOperatorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS founder_profiles (
      profile_id TEXT PRIMARY KEY,
      founder_name TEXT NOT NULL DEFAULT 'Operator',
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

  const existing = db.prepare("SELECT * FROM founder_profiles WHERE profile_id='primary'").get();
  if (!existing) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO founder_profiles (
        profile_id, founder_name, mode, monthly_budget, recurring_budget,
        approval_threshold, monthly_revenue, cash_available, prefer_free,
        require_recurring_approval, preferred_quality, notes, rules_json,
        version, created_at, updated_at
      ) VALUES ('primary', 'Operator', 'bootstrap', 0, 0, 0, 0, 0, 1, 1,
                'acceptable', 'The human operator remains in control.', ?, 1, ?, ?)
    `).run(JSON.stringify([
      'Prefer free services when quality is acceptable.',
      'Require operator approval for recurring costs.',
      'Receive customer revenue before paid execution when possible.',
      'Keep the human operator as final decision-maker.'
    ]), now, now);
  } else if (['Raylene', 'Founder'].includes(existing.founder_name)) {
    db.prepare(`
      UPDATE founder_profiles
      SET founder_name='Operator', notes='The human operator remains in control.', updated_at=?
      WHERE profile_id='primary'
    `).run(Date.now());
  }
}

function hydrate(row) {
  return row ? {
    ...row,
    operator_name: row.founder_name,
    prefer_free: Boolean(row.prefer_free),
    require_recurring_approval: Boolean(row.require_recurring_approval),
    rules: parseJson(row.rules_json, [])
  } : null;
}

export function getOperatorProfile(db) {
  ensureOperatorSchema(db);
  return hydrate(db.prepare("SELECT * FROM founder_profiles WHERE profile_id='primary'").get());
}

export function updateOperatorProfile(db, input = {}) {
  const current = getOperatorProfile(db);
  const mode = text(input.mode, current.mode).toLowerCase();
  if (!MODES.has(mode)) throw new Error(`Unsupported operator mode: ${mode}.`);
  const rules = Array.isArray(input.rules)
    ? input.rules.map(String).map(item => item.trim()).filter(Boolean)
    : current.rules;
  const now = Date.now();

  db.prepare(`
    UPDATE founder_profiles SET
      founder_name=?, mode=?, monthly_budget=?, recurring_budget=?, approval_threshold=?,
      monthly_revenue=?, cash_available=?, prefer_free=?, require_recurring_approval=?,
      preferred_quality=?, notes=?, rules_json=?, version=version+1, updated_at=?
    WHERE profile_id='primary'
  `).run(
    text(input.operator_name, current.operator_name || 'Operator'), mode,
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

  const profile = getOperatorProfile(db);
  log(db, {
    workspace_id: 'control-room', mode: 'operator_profile', event_type: 'operator_profile.updated',
    payload: { mode: profile.mode, monthly_budget: profile.monthly_budget, approval_threshold: profile.approval_threshold, version: profile.version }
  });
  return profile;
}

export function recordOperatorEvent(db, input = {}) {
  ensureOperatorSchema(db);
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
    workspace_id: text(input.workspace_id, 'control-room'), mode: 'operator_profile',
    event_type: revenue ? 'operator.revenue_recorded' : 'operator.cost_recorded',
    payload: { cost_id: costId, amount, category: input.category || 'other' }
  });
  return { cost_id: costId, amount, revenue, created_at: now };
}

export function getOperatorSummary(db, now = Date.now()) {
  const profile = getOperatorProfile(db);
  const date = new Date(now);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const rows = db.prepare('SELECT * FROM founder_cost_events WHERE created_at >= ? ORDER BY created_at DESC').all(monthStart);
  const trackedRevenue = rows.filter(row => row.revenue).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const spend = rows.filter(row => !row.revenue).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const recurringSpend = rows.filter(row => !row.revenue && row.recurring).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenue = Math.max(Number(profile.monthly_revenue || 0), trackedRevenue);
  const profit = revenue - spend;
  let recommendation = 'Stay in Bootstrap Mode. Use free infrastructure and ship.';
  if (profile.mode !== 'bootstrap') recommendation = `Operate in ${profile.mode} mode while preserving operator approval.`;
  else if (spend > revenue) recommendation = 'Freeze optional spending until revenue catches up.';
  else if (revenue > 0 && profit > 0) recommendation = 'Stay lean. Reinvest only where the return is measurable.';

  return {
    profile,
    monthly_spend: spend,
    monthly_recurring_spend: recurringSpend,
    monthly_revenue: revenue,
    monthly_profit: profit,
    budget_remaining: Math.max(0, Number(profile.monthly_budget || 0) - spend),
    burn_rate: recurringSpend,
    runway: recurringSpend > 0 ? Number(profile.cash_available || 0) / recurringSpend : null,
    recommendation,
    recent_events: rows.slice(0, 20),
    generated_at: now
  };
}

export function evaluateOperatorConstraint(db, estimate = {}) {
  const summary = getOperatorSummary(db);
  const profile = summary.profile;
  const amount = Math.max(0, num(estimate.estimated_cost));
  const recurring = bool(estimate.recurring);
  const reasons = [];
  if (profile.prefer_free && amount > 0) reasons.push('Consider a free alternative first.');
  if (recurring && profile.require_recurring_approval) reasons.push('Operator approval is required for recurring spend.');
  if (amount > Number(profile.approval_threshold || 0)) reasons.push('Estimated cost exceeds the operator approval threshold.');
  if (summary.monthly_spend + amount > Number(profile.monthly_budget || 0)) reasons.push('The job would exceed the monthly operator budget.');
  const requiresApproval = amount > 0 && reasons.length > 0;
  return {
    mode: profile.mode,
    estimated_cost: amount,
    recurring,
    requires_approval: requiresApproval,
    allowed_without_approval: !requiresApproval,
    reasons,
    recommendation: requiresApproval
      ? 'Wait for the operator or route to a free alternative.'
      : 'Proceed within Operator Profile constraints.'
  };
}

export function getOperatorAlerts(db, context = {}) {
  const summary = getOperatorSummary(db);
  const profile = summary.profile;
  const alerts = [];
  const push = (severity, category, code, title, message, action = null) => alerts.push({
    alert_id: `${code}:${severity}`,
    severity,
    category,
    code,
    title,
    message,
    action
  });

  if (summary.monthly_spend > Number(profile.monthly_budget || 0)) {
    push('critical', 'cost', 'budget_exceeded', 'Monthly budget exceeded',
      `Tracked spend is $${summary.monthly_spend.toFixed(2)} against a $${Number(profile.monthly_budget || 0).toFixed(2)} budget.`,
      'Freeze optional paid work or increase the budget with human approval.');
  }
  if (summary.monthly_recurring_spend > Number(profile.recurring_budget || 0)) {
    push('critical', 'cost', 'recurring_budget_exceeded', 'Recurring budget exceeded',
      `Recurring spend is $${summary.monthly_recurring_spend.toFixed(2)} against a $${Number(profile.recurring_budget || 0).toFixed(2)} limit.`,
      'Review subscriptions and require operator approval.');
  }
  if (summary.monthly_spend > summary.monthly_revenue && summary.monthly_spend > 0) {
    push('warning', 'finance', 'negative_margin', 'Spend is ahead of revenue',
      'Current tracked expenses exceed current tracked revenue.',
      'Prefer free providers until revenue catches up.');
  }
  if (summary.monthly_revenue > 0 && summary.monthly_profit > 0) {
    push('info', 'growth', 'positive_margin', 'Revenue is covering costs',
      `Tracked profit is $${summary.monthly_profit.toFixed(2)} this month.`,
      'Stay lean and reinvest only where ROI is measurable.');
  }
  if (profile.mode === 'bootstrap' && profile.prefer_free) {
    push('info', 'policy', 'bootstrap_active', 'Bootstrap protections active',
      'L99 will prefer free services and request approval before paid work.',
      'Keep shipping with the current zero-overhead policy.');
  }
  if (Number(context.runtime_failures || 0) > 0) {
    push('warning', 'operations', 'runtime_failures', 'Runtime failures need attention',
      `${Number(context.runtime_failures)} runtime failure(s) are active.`,
      'Inspect the runtime ledger before adding infrastructure spend.');
  }
  if (Number(context.release_gate_blocked_count || 0) > 0) {
    push('warning', 'release', 'release_blocked', 'Release work is blocked',
      `${Number(context.release_gate_blocked_count)} workspace release gate(s) are blocked.`,
      'Resolve blockers before paying for more generation.');
  }
  if (Number(context.active_incidents || 0) > 0) {
    push('warning', 'system', 'active_incidents', 'System incidents are active',
      `${Number(context.active_incidents)} active incident(s) require review.`,
      'Handle current incidents before expanding capacity.');
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const OPERATOR_PROFILE_OPTIONS = Object.freeze({ modes: [...MODES] });
