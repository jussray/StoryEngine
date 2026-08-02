// models/eventModel.js

import '../lib/sqliteTransaction.js';

function payloadText(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function log(db, event) {
  if (!event?.workspace_id) throw new Error('workspace_id required');
  if (!event?.event_type) throw new Error('event_type required');

  const createdAt = event.created_at ?? Date.now();
  const result = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.workspace_id,
    event.mode ?? null,
    event.event_type,
    payloadText(event.payload),
    event.duration_ms ?? null,
    event.rollback ? 1 : 0,
    createdAt
  );

  return { id: Number(result.lastInsertRowid), created_at: createdAt };
}

export function batchLog(db, events) {
  if (!Array.isArray(events)) throw new Error('events must be an array');
  if (!events.length) return { changes: 0, created_at: null };

  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items, batchTime) => {
    let changes = 0;
    for (const event of items) {
      if (!event?.workspace_id) throw new Error('workspace_id required');
      if (!event?.event_type) throw new Error('event_type required');
      const result = insert.run(
        event.workspace_id,
        event.mode ?? null,
        event.event_type,
        payloadText(event.payload),
        event.duration_ms ?? null,
        event.rollback ? 1 : 0,
        event.created_at ?? batchTime
      );
      changes += Number(result.changes || 0);
    }
    return changes;
  });

  const createdAt = Date.now();
  return { changes: insertMany(events, createdAt), created_at: createdAt };
}

export function list(db, workspace_id, limit = 200) {
  return db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspace_id, limit);
}
