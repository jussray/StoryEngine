// models/outlineModel.js

export function get(db, workspace_id) {
  return db.prepare('SELECT * FROM outlines WHERE workspace_id = ?').get(workspace_id);
}

export function upsert(db, workspace_id, content) {
  const now = Date.now();
  const existing = get(db, workspace_id);
  if (existing) {
    db.prepare('UPDATE outlines SET content = ?, updated_at = ? WHERE workspace_id = ?')
      .run(content, now, workspace_id);
  } else {
    db.prepare('INSERT INTO outlines (workspace_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(workspace_id, content, now, now);
  }
}
