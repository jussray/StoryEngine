// models/lindymodeModel.js

import '../lib/sqliteTransaction.js';

export function getState(db, workspace_id) {
  const row = db.prepare('SELECT * FROM lindymode_state WHERE workspace_id = ?').get(workspace_id);
  if (!row) return null;
  return {
    ...row,
    state: JSON.parse(row.state_json || '{}')
  };
}

export function upsertState(db, workspace_id, input = {}) {
  const current = getState(db, workspace_id);
  const nextVersion = (current?.version || 0) + 1;
  const now = Date.now();
  const state = input.state || current?.state || {};

  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      summary = excluded.summary,
      pov = excluded.pov,
      arc_stage = excluded.arc_stage,
      token_budget = excluded.token_budget,
      state_json = excluded.state_json,
      version = excluded.version,
      updated_at = excluded.updated_at
  `).run(
    workspace_id,
    input.summary ?? current?.summary ?? '',
    input.pov ?? current?.pov ?? '',
    input.arc_stage ?? current?.arc_stage ?? '',
    Number(input.token_budget ?? current?.token_budget ?? 0),
    JSON.stringify(state),
    nextVersion,
    now
  );

  return getState(db, workspace_id);
}

export function createIncident(db, incident) {
  const existing = db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = ?
      AND chapter_id IS ?
      AND event_type = ?
      AND reason = ?
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(
    incident.workspace_id,
    incident.chapter_id ?? null,
    incident.event_type,
    incident.reason
  );

  if (existing) {
    db.prepare(`
      UPDATE lindymode_incidents
      SET severity = ?, drift_score = ?, details_json = ?, correlation_id = ?
      WHERE incident_id = ?
    `).run(
      incident.severity,
      incident.drift_score || 0,
      JSON.stringify(incident.details || {}),
      incident.correlation_id,
      existing.incident_id
    );
    return getIncident(db, existing.incident_id);
  }

  db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, parent_event_id, workspace_id, chapter_id,
      event_type, severity, status, reason, drift_score, details_json,
      recovery_action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.incident_id,
    incident.correlation_id,
    incident.parent_event_id ?? null,
    incident.workspace_id,
    incident.chapter_id ?? null,
    incident.event_type,
    incident.severity,
    incident.status || 'active',
    incident.reason,
    incident.drift_score || 0,
    JSON.stringify(incident.details || {}),
    incident.recovery_action ?? null,
    incident.created_at || Date.now()
  );
  return getIncident(db, incident.incident_id);
}

export function getIncident(db, incident_id) {
  const row = db.prepare('SELECT * FROM lindymode_incidents WHERE incident_id = ?').get(incident_id);
  if (!row) return null;
  return { ...row, details: JSON.parse(row.details_json || '{}') };
}

export function listIncidents(db, workspace_id, status = null, limit = 100) {
  const rows = status
    ? db.prepare(`SELECT * FROM lindymode_incidents WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`).all(workspace_id, status, limit)
    : db.prepare(`SELECT * FROM lindymode_incidents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`).all(workspace_id, limit);
  return rows.map(row => ({ ...row, details: JSON.parse(row.details_json || '{}') }));
}

export function resolveIncident(db, incident_id, recovery_action) {
  db.prepare(`
    UPDATE lindymode_incidents
    SET status = 'resolved', recovery_action = ?, resolved_at = ?
    WHERE incident_id = ?
  `).run(recovery_action, Date.now(), incident_id);
  return getIncident(db, incident_id);
}

export function reconcileChapterIncidents(db, workspace_id, chapter_id, current = null) {
  const active = db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = ? AND chapter_id IS ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(workspace_id, chapter_id ?? null);

  const stale = active.filter(incident => {
    if (!current) return true;
    return incident.event_type !== current.event_type || incident.reason !== current.reason;
  });

  if (!stale.length) return [];

  const resolvedAt = Date.now();
  const resolve = db.prepare(`
    UPDATE lindymode_incidents
    SET status = 'resolved', recovery_action = 'author_fix_validated', resolved_at = ?
    WHERE incident_id = ? AND status = 'active'
  `);

  const apply = db.transaction(items => {
    for (const incident of items) resolve.run(resolvedAt, incident.incident_id);
  });
  apply(stale);

  return stale.map(incident => ({
    ...incident,
    status: 'resolved',
    recovery_action: 'author_fix_validated',
    resolved_at: resolvedAt,
    details: JSON.parse(incident.details_json || '{}')
  }));
}
