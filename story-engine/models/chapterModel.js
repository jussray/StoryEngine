// models/chapterModel.js

export function list(db, workspace_id) {
  return db.prepare('SELECT * FROM chapters WHERE workspace_id = ? ORDER BY position ASC').all(workspace_id);
}

export function get(db, id) {
  return db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
}

export function create(db, workspace_id, { title, content = '', position = 0 }) {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO chapters (workspace_id, title, content, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspace_id, title, content, position, now, now);
  return result.lastInsertRowid;
}

export function update(db, id, fields = {}) {
  const current = get(db, id);
  if (!current) return false;
  const now = Date.now();
  db.prepare(`
    UPDATE chapters SET title = ?, content = ?, position = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.title ?? current.title,
    fields.content ?? current.content ?? '',
    fields.position ?? current.position ?? 0,
    now,
    id
  );
  return true;
}

export function remove(db, id) {
  db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
}
