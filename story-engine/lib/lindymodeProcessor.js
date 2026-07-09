// lib/lindymodeProcessor.js
// Lindy Mode — bootstrap-first creative discipline processor.
// Now imports canon memory so cross-run facts survive between sessions.

import { canonSnapshot, evaluateCanonFit } from './canonMemory.js';

const DEFAULT_LINDY_PROFILE = Object.freeze({
  mode: 'bootstrap',
  prefer_free: true,
  approval_threshold: 0,
  principle: 'Being broke is the Lindy filter: spend only when the simpler free path no longer protects quality, reliability, or revenue.'
});

export function getLindyProfile(db) {
  try {
    const row = db.prepare("SELECT value FROM operator_config WHERE key='lindy_profile'").get();
    if (row) return { ...DEFAULT_LINDY_PROFILE, ...JSON.parse(row.value) };
  } catch { /* fall through */ }
  return { ...DEFAULT_LINDY_PROFILE };
}

export function lindyModeDecision({ action = 'stay', lindy_score = 100, monthly_cost = 0, profile = DEFAULT_LINDY_PROFILE } = {}) {
  const threshold = Number(profile.approval_threshold || 0);
  const preferFree = Boolean(profile.prefer_free);
  const reasons = [];
  let approved = true;

  if (preferFree && monthly_cost > 0) {
    reasons.push(`Bootstrap Mode prefers a free alternative until the cost proves measurable value. Monthly cost: $${monthly_cost}.`);
    approved = false;
  }
  if (monthly_cost > threshold && threshold >= 0) {
    reasons.push(`Monthly cost $${monthly_cost} exceeds operator approval threshold $${threshold}.`);
    approved = false;
  }
  if (lindy_score < 50) {
    reasons.push(`Lindy score ${lindy_score} is below the minimum confidence threshold (50).`);
    approved = false;
  }
  if (!reasons.length) reasons.push('No cost or quality pressure requires a change. Stay lean.');

  return {
    action,
    lindy_score,
    monthly_cost,
    approved,
    mode: profile.mode,
    principle: profile.principle,
    reasons
  };
}

export function lindyCreativeCheck(db, workspace_id, draft) {
  const canon = evaluateCanonFit(db, workspace_id, draft);
  const snapshot = canonSnapshot(db, workspace_id);
  return {
    canon_passed: canon.passed,
    canon_findings: canon.findings,
    canon_anchor_count: snapshot.anchor_count,
    canon_locked_count: snapshot.locked_count,
    canon_kinds: snapshot.kinds
  };
}

export function lindyCommandOptions() {
  return [
    { command: '/lindy status', description: 'Show current Lindy Mode profile and bootstrap stack health.' },
    { command: '/lindy canon', description: 'Show all canon anchors for the current workspace.' },
    { command: '/lindy check', description: 'Run a canon fit check on the latest draft unit.' },
    { command: '/lindy lock <key>', description: 'Lock a canon anchor so it cannot be overwritten by AI output.' }
  ];
}
