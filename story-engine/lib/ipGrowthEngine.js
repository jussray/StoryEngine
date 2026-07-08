// lib/ipGrowthEngine.js

import { randomUUID } from 'node:crypto';
import { buildStoryBlueprint, getStoryBlueprint, getBlueprintContinuationOptions, convertBlueprint, listBlueprintConversions } from './storyBlueprint.js';
import { log } from '../models/eventModel.js';

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_growth_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      status TEXT NOT NULL,
      growth_score INTEGER NOT NULL DEFAULT 0,
      readiness_score INTEGER NOT NULL DEFAULT 0,
      recommendations_json TEXT NOT NULL DEFAULT '[]',
      blockers_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_growth_workspace ON ip_growth_snapshots(workspace_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ip_growth_actions (
      action_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      target_medium TEXT NOT NULL,
      recommendation_score INTEGER NOT NULL,
      status TEXT NOT NULL,
      conversion_id TEXT,
      target_workspace_id TEXT,
      rationale_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_growth_actions_workspace ON ip_growth_actions(workspace_id, created_at DESC);
  `);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function hydrateSnapshot(row) {
  if (!row) return null;
  return { ...row, recommendations: parseJson(row.recommendations_json, []), blockers: parseJson(row.blockers_json, []) };
}

function mediumValue(target) {
  const values = {
    youtube_short: { speed: 100, revenue: 62, defensibility: 45 },
    short_clip: { speed: 96, revenue: 58, defensibility: 42 },
    picture_book: { speed: 78, revenue: 68, defensibility: 70 },
    comic: { speed: 72, revenue: 72, defensibility: 74 },
    song: { speed: 80, revenue: 60, defensibility: 55 },
    podcast: { speed: 76, revenue: 64, defensibility: 58 },
    ip_deck: { speed: 70, revenue: 88, defensibility: 82 },
    movie: { speed: 35, revenue: 94, defensibility: 90 },
    tv: { speed: 30, revenue: 96, defensibility: 92 },
    game: { speed: 25, revenue: 90, defensibility: 94 }
  };
  return values[target] || { speed: 50, revenue: 50, defensibility: 50 };
}

function scoreRecommendation(option, blueprint, existingTargets) {
  const value = mediumValue(option.target_medium);
  const child = Boolean(blueprint.developmental_profile);
  const alreadyBuilt = existingTargets.has(option.target_medium);
  let fit = Number(option.score || 50);

  if (child && ['youtube_short', 'short_clip', 'picture_book', 'comic', 'song'].includes(option.target_medium)) fit += 6;
  if (child && ['movie', 'tv', 'game'].includes(option.target_medium)) fit -= 12;
  if ((blueprint.beats?.length || 0) < 3 && ['movie', 'tv', 'game'].includes(option.target_medium)) fit -= 18;
  if (alreadyBuilt) fit -= 40;

  const total = Math.max(0, Math.min(100, Math.round(
    fit * 0.45 + value.speed * 0.2 + value.revenue * 0.2 + value.defensibility * 0.15
  )));

  return {
    target_medium: option.target_medium,
    score: total,
    source_fit_score: Math.max(0, Math.min(100, fit)),
    speed_to_test: value.speed,
    revenue_potential: value.revenue,
    defensibility: value.defensibility,
    already_built: alreadyBuilt,
    recommendation: total >= 82 ? 'build_next' : total >= 68 ? 'strong_option' : total >= 52 ? 'later' : 'not_recommended_yet',
    reason: alreadyBuilt
      ? `A ${option.target_medium} continuation already exists; improve or extend it before duplicating.`
      : option.reason,
    preserve: blueprint.conversion_rules?.preserve || [],
    requires_seed_gate: true
  };
}

export function evaluateIpGrowth(db, workspaceId) {
  ensureSchema(db);
  const row = getStoryBlueprint(db, workspaceId) || buildStoryBlueprint(db, workspaceId);
  const blueprint = row.blueprint;
  const blockers = [];

  if (!row.validation?.passed) blockers.push('validation_seed_not_passed');
  if (!blueprint.seed_gate?.conversion_ready) blockers.push('seed_gate_not_conversion_ready');

  const existing = listBlueprintConversions(db, row.blueprint_id);
  const existingTargets = new Set(existing.map(item => item.target_medium));
  const optionSet = getBlueprintContinuationOptions(db, workspaceId).options || [];
  const recommendations = optionSet
    .map(option => scoreRecommendation(option, blueprint, existingTargets))
    .sort((a, b) => b.score - a.score);

  const readiness = blockers.length ? 0 : Math.round(
    (Number(blueprint.proof?.audience_fit_score || 80) * 0.35) +
    (Math.min(100, (blueprint.beats?.length || 0) * 12) * 0.25) +
    (blueprint.seed_gate?.ooda_decision?.confidence_score || 75) * 0.25 +
    (blueprint.seed_gate?.redteam_seed_check?.passed ? 100 : 0) * 0.15
  );
  const topScore = recommendations[0]?.score || 0;
  const growthScore = blockers.length ? 0 : Math.round(readiness * 0.55 + topScore * 0.45);
  const status = blockers.length ? 'blocked' : recommendations.length ? 'ready' : 'no_options';
  const now = Date.now();
  const snapshotId = `growth_${randomUUID()}`;

  db.prepare(`
    INSERT INTO ip_growth_snapshots (
      snapshot_id, workspace_id, blueprint_id, status, growth_score,
      readiness_score, recommendations_json, blockers_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(snapshotId, workspaceId, row.blueprint_id, status, growthScore, readiness, JSON.stringify(recommendations), JSON.stringify(blockers), now, now);

  log(db, {
    workspace_id: workspaceId,
    mode: 'ip_growth',
    event_type: 'ip_growth.evaluated',
    payload: { snapshot_id: snapshotId, blueprint_id: row.blueprint_id, status, growth_score: growthScore, top_recommendation: recommendations[0]?.target_medium || null }
  });

  return {
    snapshot_id: snapshotId,
    workspace_id: workspaceId,
    blueprint_id: row.blueprint_id,
    status,
    growth_score: growthScore,
    readiness_score: readiness,
    seed_gate: blueprint.seed_gate,
    recommended_next: recommendations[0] || null,
    recommendations,
    blockers,
    existing_conversions: existing,
    principle: 'Grow the validated IP from its seed; do not generate disconnected adaptations.'
  };
}

export function getLatestIpGrowth(db, workspaceId) {
  ensureSchema(db);
  return hydrateSnapshot(db.prepare(`
    SELECT * FROM ip_growth_snapshots WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 1
  `).get(workspaceId));
}

export function listIpGrowthActions(db, workspaceId) {
  ensureSchema(db);
  return db.prepare(`SELECT * FROM ip_growth_actions WHERE workspace_id=? ORDER BY created_at DESC`).all(workspaceId)
    .map(row => ({ ...row, rationale: parseJson(row.rationale_json, {}) }));
}

export function startIpExpansion(db, workspaceId, targetMedium) {
  ensureSchema(db);
  const evaluation = evaluateIpGrowth(db, workspaceId);
  if (evaluation.status !== 'ready') throw new Error(`IP growth is blocked: ${evaluation.blockers.join(', ') || 'no unlocked continuation options'}.`);

  const target = String(targetMedium || evaluation.recommended_next?.target_medium || '').trim().toLowerCase();
  const recommendation = evaluation.recommendations.find(item => item.target_medium === target);
  if (!recommendation) throw new Error(`Target ${target} is not recommended or unlocked for this validated seed.`);
  if (recommendation.already_built) throw new Error(`A ${target} continuation already exists for this seed.`);

  const actionId = `ip_action_${randomUUID()}`;
  const now = Date.now();
  const conversion = convertBlueprint(db, workspaceId, target);

  db.prepare(`
    INSERT INTO ip_growth_actions (
      action_id, workspace_id, blueprint_id, target_medium, recommendation_score,
      status, conversion_id, target_workspace_id, rationale_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)
  `).run(
    actionId,
    workspaceId,
    evaluation.blueprint_id,
    target,
    recommendation.score,
    conversion.conversion_id,
    conversion.target_workspace_id,
    JSON.stringify({ recommendation, seed_gate: evaluation.seed_gate }),
    now,
    now
  );

  log(db, {
    workspace_id: workspaceId,
    mode: 'ip_growth',
    event_type: 'ip_growth.expansion_started',
    payload: { action_id: actionId, target_medium: target, conversion_id: conversion.conversion_id, target_workspace_id: conversion.target_workspace_id }
  });

  return { action_id: actionId, evaluation, recommendation, conversion };
}

export function ipGrowthOverview(db) {
  ensureSchema(db);
  const latest = db.prepare(`
    SELECT s.* FROM ip_growth_snapshots s
    INNER JOIN (
      SELECT workspace_id, MAX(updated_at) AS max_updated FROM ip_growth_snapshots GROUP BY workspace_id
    ) latest ON latest.workspace_id=s.workspace_id AND latest.max_updated=s.updated_at
    ORDER BY s.growth_score DESC LIMIT 20
  `).all().map(hydrateSnapshot);
  const ready = latest.filter(item => item.status === 'ready');
  return {
    workspace_count: latest.length,
    ready_count: ready.length,
    blocked_count: latest.filter(item => item.status === 'blocked').length,
    highest_growth_score: ready[0]?.growth_score || 0,
    workspaces: latest
  };
}
