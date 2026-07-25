// routes/ooda.js

import { json } from '../lib/miniRouter.js';
import { collectActiveIncidents } from '../lib/oodaProcessor.js';
import { requireRole } from '../lib/securityContext.js';

function parsePayload(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export default function oodaRoutes(router, db) {
  router.get('/api/ooda/snapshot', (req, res) => {
    requireRole('administrator')(req, res, () => {
      json(res, 200, {
        generated_at: Date.now(),
        incidents: collectActiveIncidents(db)
      });
    });
  });

  router.get('/api/ooda/timeline/:correlation_id', (req, res) => {
    requireRole('administrator')(req, res, () => {
      const correlationId = req.params.correlation_id;

      const incidents = db.prepare(`
        SELECT *
        FROM lindymode_incidents
        WHERE correlation_id = ?
        ORDER BY created_at ASC
      `).all(correlationId).map(row => ({
        kind: 'incident',
        created_at: row.created_at,
        event_type: row.event_type,
        status: row.status,
        severity: row.severity,
        summary: row.reason,
        incident_id: row.incident_id,
        workspace_id: row.workspace_id,
        chapter_id: row.chapter_id,
        recovery_action: row.recovery_action,
        resolved_at: row.resolved_at
      }));

      const eventRows = db.prepare(`
        SELECT *
        FROM events
        WHERE payload LIKE ?
        ORDER BY created_at ASC
        LIMIT 500
      `).all(`%${correlationId}%`);

      const events = eventRows.map(row => ({
        kind: 'event',
        created_at: row.created_at,
        event_type: row.event_type,
        workspace_id: row.workspace_id,
        mode: row.mode,
        rollback: Boolean(row.rollback),
        payload: parsePayload(row.payload)
      }));

      const timeline = [...incidents, ...events].sort((a, b) => a.created_at - b.created_at);
      json(res, 200, { correlation_id: correlationId, timeline });
    });
  });
}
