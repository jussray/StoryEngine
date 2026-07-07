// models/eventModel.js

export function log(db, { workspace_id, mode = null, event_type, payload = null, duration_ms = null, rollback = 0 }) {
  db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspace_id,
    mode,
    event_type,
    payload ? JSON.stringify(payload) : null,
    duration_ms,
    rollback ? 1 : 0,
    Date.now()
  );
}

export function batchLog(db, events) {
  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((evts) => {
    for (const e of evts) {
      insert.run(
        e.workspace_id,
        e.mode ?? null,
        e.event_type,
        e.payload ? JSON.stringify(e.payload) : null,
        e.duration_ms ?? null,
        e.rollback ? 1 : 0,
        Date.now()
      );
    }
  });
  insertMany(events);
}

export function list(db, workspace_id, limit = 200) {
  return db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspace_id, limit);
}
