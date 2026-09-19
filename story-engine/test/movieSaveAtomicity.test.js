import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import movieRoutes from '../routes/movie.js';
import { generateBeats } from '../models/movieModel.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO chapters (workspace_id, chapter_id, title) VALUES ('save-proof', 'one', 'Opening')");
  const [beat] = generateBeats(db, 'save-proof');
  let save;
  movieRoutes({ get() {}, post() {}, put(path, handler) {
    if (path === '/api/movie/beats/:id') save = handler;
  } }, db);
  const req = { params: { id: beat.id }, body: { logline: 'Revised' },
    auth: { role: 'creator', workspace_ids: ['save-proof'] } };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  return { db, beat, req, res, save };
}

test('Save Beat commits both the edit and its subject-bound event', () => {
  const { db, beat, req, res, save } = fixture();
  try {
    save(req, res);
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT logline FROM movie_beats WHERE id=?').get(beat.id).logline, 'Revised');
    const event = db.prepare("SELECT * FROM events WHERE event_type='beat_updated'").get();
    assert.equal(JSON.parse(event.payload).beat_id, beat.id);
  } finally { db.close(); }
});

test('Save Beat rolls back the edit when its event cannot be written', () => {
  const { db, beat, req, res, save } = fixture();
  try {
    db.exec("CREATE TRIGGER reject_beat_event BEFORE INSERT ON events WHEN NEW.event_type='beat_updated' BEGIN SELECT RAISE(ABORT, 'injected event failure'); END");
    assert.throws(() => save(req, res), /injected event failure/);
    assert.equal(db.prepare('SELECT logline FROM movie_beats WHERE id=?').get(beat.id).logline, beat.logline);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    assert.equal(res.status, undefined);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test('failed regeneration preserves the existing edited beats', () => {
  const { db, beat } = fixture();
  try {
    db.exec("CREATE TRIGGER reject_new_beat BEFORE INSERT ON movie_beats BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END");
    assert.throws(() => generateBeats(db, 'save-proof'), /injected insert failure/);
    assert.deepEqual({ ...db.prepare('SELECT * FROM movie_beats WHERE id=?').get(beat.id) },
      Object.fromEntries(Object.entries(beat).filter(([key]) => key !== 'chapter_title')));
  } finally { db.close(); }
});

test('Save Beat rejects non-text input without mutating stored content', () => {
  const { db, beat, req, res, save } = fixture();
  try {
    req.body.logline = { invalid: true };
    save(req, res);
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT logline FROM movie_beats WHERE id=?').get(beat.id).logline, beat.logline);
  } finally { db.close(); }
});
