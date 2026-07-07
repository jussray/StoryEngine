// models/storyModel.js
import { randomUUID } from 'node:crypto';

export function create(db, { title, genre, pitch }) {
  const workspace_id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspace_id, title, genre ?? null, pitch ?? null, now, now);
  return workspace_id;
}

export function get(db, workspace_id) {
  return db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspace_id);
}

export function list(db) {
  return db.prepare(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM chapters c WHERE c.workspace_id = s.workspace_id) AS chapter_count,
      (SELECT COUNT(*) FROM lindymode_incidents li
        WHERE li.workspace_id = s.workspace_id AND li.status = 'active') AS active_incident_count,
      (SELECT MAX(li.severity) FROM lindymode_incidents li
        WHERE li.workspace_id = s.workspace_id AND li.status = 'active') AS highest_severity,
      (SELECT MAX(e.created_at) FROM events e WHERE e.workspace_id = s.workspace_id) AS last_activity_at
    FROM stories s
    ORDER BY COALESCE(last_activity_at, s.updated_at, s.created_at) DESC
  `).all();
}

export function update(db, workspace_id, fields) {
  const now = Date.now();
  db.prepare(`
    UPDATE stories SET title = ?, genre = ?, pitch = ?, updated_at = ?
    WHERE workspace_id = ?
  `).run(fields.title, fields.genre ?? null, fields.pitch ?? null, now, workspace_id);
}
