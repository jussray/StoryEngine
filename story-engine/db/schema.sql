-- L99 Story Engine schema
-- Stories, outlines, chapters, movie beats, and events

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  genre       TEXT,
  pitch       TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS outlines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  content      TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (workspace_id) REFERENCES stories(workspace_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  title        TEXT NOT NULL,
  content      TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (workspace_id) REFERENCES stories(workspace_id)
);

CREATE TABLE IF NOT EXISTS movie_beats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chapter_id   INTEGER NOT NULL,
  act          TEXT NOT NULL CHECK(act IN ('I','II','III')),
  beat         TEXT,
  logline      TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (workspace_id) REFERENCES stories(workspace_id),
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  mode         TEXT,
  event_type   TEXT NOT NULL,
  payload      TEXT,
  duration_ms  INTEGER,
  rollback     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_chapters_workspace ON chapters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_beats_workspace    ON movie_beats(workspace_id);
