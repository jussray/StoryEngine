// routes/controlRoom.js

import { randomUUID } from 'node:crypto';
import { json } from '../lib/miniRouter.js';
import { getMissionControlSnapshot } from '../lib/missionControl.js';
import { storyEngineBrainSnapshot } from '../lib/storyEngineOrchestrator.js';
import { getRunSummary, listRunSummaries } from '../lib/runSummary.js';
import { ipGrowthOverview } from '../lib/ipGrowthEngine.js';
import {
  OPERATOR_PROFILE_OPTIONS,
  getOperatorSummary,
  updateOperatorProfile,
  recordOperatorEvent,
  evaluateOperatorConstraint,
  getOperatorAlerts
} from '../lib/operatorProfile.js';
import { log } from '../models/eventModel.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function safeJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function tableExists(db, tableName) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).get(tableName));
}

function storyMemorySignals(db) {
  if (!tableExists(db, 'memory_diffs')) return { story_drift_count: 0, story_conflicts: [] };
  const count = db.prepare(`SELECT COUNT(*) AS count FROM memory_diffs WHERE conflict=1 AND resolved=0`).get();
  const conflicts = db.prepare(`
    SELECT id, workspace_id, chapter_id, entity_type, entity_id, field,
           old_value, new_value, created_at
    FROM memory_diffs
    WHERE conflict=1 AND resolved=0
    ORDER BY created_at DESC LIMIT 25
  `).all();
  return { story_drift_count: Number(count?.count || 0), story_conflicts: conflicts };
}

function engineMemorySignals(db, now = Date.now()) {
  if (!tableExists(db, 'engine_memory_episodes')) {
    return { engine_drift_count: 0, lessons_today: 0, repeated_mistake_count: 0, recent_lessons: [], confidence_trend: [] };
  }
  const since = now - DAY_MS;
  const drift = db.prepare(`SELECT COUNT(*) AS count FROM engine_memory_episodes WHERE repeated_mistake=1 AND created_at>=?`).get(since);
  const rows = db.prepare(`
    SELECT episode_id, workspace_id, chapter_id, lessons_json,
           repeated_mistake, confidence_before, confidence_after,
           gate_result, user_accepted, created_at
    FROM engine_memory_episodes
    WHERE created_at>=?
    ORDER BY created_at DESC LIMIT 25
  `).all(since);
  const recentLessons = rows.map(row => ({ ...row, lessons: safeJson(row.lessons_json, []) })).filter(row => row.lessons.length > 0);
  const trend = db.prepare(`
    SELECT episode_id, workspace_id, chapter_id, confidence_before,
           confidence_after, gate_result, user_accepted, created_at
    FROM engine_memory_episodes
    WHERE confidence_before IS NOT NULL OR confidence_after IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `).all().reverse();
  return {
    engine_drift_count: Number(drift?.count || 0),
    lessons_today: recentLessons.reduce((total, row) => total + row.lessons.length, 0),
    repeated_mistake_count: Number(drift?.count || 0),
    recent_lessons: recentLessons,
    confidence_trend: trend
  };
}

function pipelineHealth(snapshot, memory, brain, growth) {
  const running = Number(snapshot.overview?.running_dispatches || 0);
  const failed = Number(snapshot.overview?.runtime_failures || 0);
  const gateBlocked = Number(snapshot.overview?.release_gate_blocked_count || 0);
  return [
    { key: 'story_engine', label: 'Story Engine', status: brain.active_count ? 'running' : 'ok' },
    { key: 'ghost', label: 'Ghost', status: brain.current?.current_stage === 'ghost' ? 'running' : 'ok' },
    { key: 'lindymode', label: 'Lindymode', status: snapshot.incidents?.length ? 'watch' : 'ok' },
    { key: 'ooda', label: 'OODA Loop', status: 'running' },
    { key: 'redteam', label: 'Redteam', status: brain.current?.current_stage?.startsWith('redteam') ? 'running' : 'ok' },
    { key: 'runtime', label: 'Runtime', status: failed ? 'error' : running ? 'running' : 'ok' },
    { key: 'release_gate', label: 'Release Gate', status: gateBlocked ? 'blocked' : 'ok' },
    { key: 'control_room', label: 'Control Room', status: brain.current?.current_stage === 'control_room' ? 'running' : 'ok' },
    { key: 'story_memory', label: 'Story Memory', status: memory.story_drift_count ? 'watch' : 'ok' },
    { key: 'engine_memory', label: 'Engine Memory', status: memory.engine_drift_count ? 'watch' : 'ok' },
    { key: 'ip_growth', label: 'IP Growth Engine', status: growth.blocked_count ? 'watch' : growth.ready_count ? 'ready' : 'ok' }
  ];
}

export function buildControlRoomOverview(db, now = Date.now()) {
  const snapshot = getMissionControlSnapshot(db);
  const memory = { ...storyMemorySignals(db), ...engineMemorySignals(db, now) };
  const operator = getOperatorSummary(db, now);
  const operatorAlerts = getOperatorAlerts(db, snapshot.overview || {});
  const brain = storyEngineBrainSnapshot(db);
  const runSummaries = listRunSummaries(db, 10);
  const ipGrowth = ipGrowthOverview(db);
  return {
    ...snapshot,
    control_room_generated_at: now,
    memory,
    operator,
    operator_alerts: operatorAlerts,
    story_engine_brain: brain,
    ip_growth: ipGrowth,
    recent_run_summaries: runSummaries,
    pipeline_health: pipelineHealth(snapshot, memory, brain, ipGrowth)
  };
}

export function resolveControlRoomIncident(db, input = {}) {
  const { incident_id: incidentId, diff_id: diffId } = input;
  const resolution = String(input.resolution || '').trim();
  if (!incidentId && !diffId) throw new Error('incident_id or diff_id is required.');
  if (!resolution) throw new Error('resolution is required.');
  const now = Date.now();
  let diffChanges = 0;
  let incidentChanges = 0;
  let workspaceId = input.workspace_id || 'control-room';
  db.transaction(() => {
    if (diffId) {
      if (!tableExists(db, 'memory_diffs')) throw new Error('Memory Engine is not available.');
      const diff = db.prepare('SELECT workspace_id FROM memory_diffs WHERE id=?').get(diffId);
      if (!diff) throw new Error('Memory diff not found.');
      workspaceId = diff.workspace_id;
      diffChanges = Number(db.prepare(`UPDATE memory_diffs SET resolved=1, resolution=?, resolved_at=? WHERE id=? AND resolved=0`).run(resolution, now, diffId).changes || 0);
    }
    if (incidentId) {
      const incident = db.prepare('SELECT workspace_id FROM lindymode_incidents WHERE incident_id=?').get(incidentId);
      if (!incident) throw new Error('Lindymode incident not found.');
      workspaceId = incident.workspace_id;
      incidentChanges = Number(db.prepare(`
        UPDATE lindymode_incidents SET status='resolved', recovery_action=?, resolved_at=?
        WHERE incident_id=? AND status='active'
      `).run(`operator:${resolution}`, now, incidentId).changes || 0);
    }
  })();
  log(db, { workspace_id: workspaceId, mode: 'control_room', event_type: 'control_room.incident_resolved', payload: { incident_id: incidentId || null, diff_id: diffId || null, resolution } });
  return { ok: true, incident_id: incidentId || null, diff_id: diffId || null, resolved: diffChanges + incidentChanges, resolution, resolved_at: now };
}

export function forceControlRoomGatePass(db, input = {}) {
  const workspaceId = String(input.workspace_id || '').trim();
  const operatorNote = String(input.operator_note || '').trim();
  if (!workspaceId) throw new Error('workspace_id is required.');
  if (!operatorNote) throw new Error('operator_note is required for an override.');
  if (!db.prepare('SELECT workspace_id FROM stories WHERE workspace_id=?').get(workspaceId)) throw new Error('Workspace not found.');
  const auditId = `override_${randomUUID()}`;
  const now = Date.now();
  const checks = [{ check: 'operator_override', passed: true, chapter_id: input.chapter_id ?? null, note: operatorNote }];
  db.prepare(`
    INSERT INTO release_audits (audit_id, workspace_id, result, confidence_score, checks_json, blockers_json, created_at)
    VALUES (?, ?, 'OPERATOR_OVERRIDE', 100, ?, '[]', ?)
  `).run(auditId, workspaceId, JSON.stringify(checks), now);
  log(db, { workspace_id: workspaceId, mode: 'control_room', event_type: 'control_room.gate_overridden', payload: { audit_id: auditId, chapter_id: input.chapter_id ?? null, operator_note: operatorNote } });
  return { ok: true, audit_id: auditId, workspace_id: workspaceId, chapter_id: input.chapter_id ?? null, result: 'OPERATOR_OVERRIDE', created_at: now };
}

function registerOperatorRoutes(router, db, basePath) {
  router.get(`${basePath}/options`, (req, res) => json(res, 200, OPERATOR_PROFILE_OPTIONS));
  router.get(basePath, (req, res) => { try { json(res, 200, getOperatorSummary(db)); } catch (error) { json(res, 500, { error: error.message }); } });
  router.put(basePath, (req, res) => { try { const profile = updateOperatorProfile(db, req.body || {}); json(res, 200, { profile, summary: getOperatorSummary(db) }); } catch (error) { json(res, 400, { error: error.message }); } });
  router.post(`${basePath}/event`, (req, res) => { try { const event = recordOperatorEvent(db, req.body || {}); json(res, 201, { event, summary: getOperatorSummary(db) }); } catch (error) { json(res, 400, { error: error.message }); } });
  router.post(`${basePath}/evaluate-cost`, (req, res) => { try { json(res, 200, evaluateOperatorConstraint(db, req.body || {})); } catch (error) { json(res, 400, { error: error.message }); } });
  router.get(`${basePath}/alerts`, (req, res) => { try { const snapshot = getMissionControlSnapshot(db); json(res, 200, getOperatorAlerts(db, snapshot.overview || {})); } catch (error) { json(res, 500, { error: error.message }); } });
}

export default function controlRoomRoutes(router, db) {
  router.get('/api/control-room/overview', (req, res) => { try { json(res, 200, buildControlRoomOverview(db)); } catch (error) { json(res, 500, { error: error.message }); } });
  router.get('/api/control-room/run-summaries', (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      json(res, 200, listRunSummaries(db, Number(url.searchParams.get('limit') || 25)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
  router.get('/api/control-room/run-summaries/:run_id', (req, res) => {
    try {
      const summary = getRunSummary(db, req.params.run_id);
      if (!summary) return json(res, 404, { error: 'Run summary not found.' });
      json(res, 200, summary);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
  registerOperatorRoutes(router, db, '/api/control-room/operator');
  registerOperatorRoutes(router, db, '/api/control-room/founder');
  router.get('/api/control-room/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = () => {
      try { res.write('event: snapshot\n'); res.write(`data: ${JSON.stringify(buildControlRoomOverview(db))}\n\n`); }
      catch (error) { res.write('event: error\n'); res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`); }
    };
    send();
    const interval = setInterval(send, 30_000);
    req.on('close', () => clearInterval(interval));
  });
  router.post('/api/control-room/resolve-incident', (req, res) => { try { json(res, 200, resolveControlRoomIncident(db, req.body)); } catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); } });
  router.post('/api/control-room/force-gate-pass', (req, res) => { try { json(res, 201, forceControlRoomGatePass(db, req.body)); } catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); } });
}
