// models/movieModel.js

export function listBeats(db, workspace_id) {
  return db.prepare(`
    SELECT mb.*, c.title as chapter_title
    FROM movie_beats mb
    JOIN chapters c ON c.id = mb.chapter_id
    WHERE mb.workspace_id = ?
    ORDER BY mb.position ASC
  `).all(workspace_id);
}

export function generateBeats(db, workspace_id) {
  const chapters = db.prepare(
    'SELECT * FROM chapters WHERE workspace_id = ? ORDER BY position ASC'
  ).all(workspace_id);

  if (!chapters.length) return [];

  // Delete existing beats for this workspace
  db.prepare('DELETE FROM movie_beats WHERE workspace_id = ?').run(workspace_id);

  const total = chapters.length;
  const now = Date.now();

  const insertBeat = db.prepare(`
    INSERT INTO movie_beats (workspace_id, chapter_id, act, beat, logline, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((chs) => {
    chs.forEach((ch, i) => {
      const act = i < total * 0.25 ? 'I' : i < total * 0.75 ? 'II' : 'III';
      const beat = `Beat ${i + 1}: ${ch.title}`;
      const logline = `Chapter ${i + 1} beat — ${act === 'I' ? 'Setup' : act === 'II' ? 'Confrontation' : 'Resolution'}`;
      insertBeat.run(workspace_id, ch.id, act, beat, logline, i, now, now);
    });
  });

  insertAll(chapters);
  return listBeats(db, workspace_id);
}

export function updateBeat(db, id, { logline }) {
  db.prepare('UPDATE movie_beats SET logline = ?, updated_at = ? WHERE id = ?')
    .run(logline, Date.now(), id);
}
