-- L99 Story Engine schema

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  genre TEXT,
  pitch TEXT,
  mode TEXT,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  content TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chapter_id TEXT,
  title TEXT NOT NULL,
  content TEXT,
  text TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Drafted',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS movie_beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  act TEXT NOT NULL DEFAULT 'I',
  beat TEXT,
  title TEXT,
  logline TEXT,
  sources TEXT DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  mode TEXT,
  schema_version TEXT DEFAULT '1.0.0',
  client_tier TEXT DEFAULT 'small',
  event_type TEXT NOT NULL,
  payload TEXT,
  duration_ms INTEGER,
  rollback INTEGER NOT NULL DEFAULT 0,
  snapshot_trust_status TEXT DEFAULT 'snapshot_plus_delta',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_mode_created ON events(mode, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_chapters_workspace ON chapters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_beats_workspace ON movie_beats(workspace_id);
