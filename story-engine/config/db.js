// config/db.js — node:sqlite connection with WAL + performance PRAGMAs
// Requires Node 22.5+

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(join(__dirname, '../db'), { recursive: true });

const db = new DatabaseSync(join(__dirname, '../db/l99.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA cache_size = -10000;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');

const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
db.exec(schema);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('memory_diffs', 'diff_id', 'TEXT');
ensureColumn('memory_diffs', 'resolution', 'TEXT');
ensureColumn('memory_diffs', 'source', "TEXT NOT NULL DEFAULT 'system'");
ensureColumn('memory_diffs', 'resolved_at', 'INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_diffs_diff_id ON memory_diffs(diff_id) WHERE diff_id IS NOT NULL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS studio_ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT,
    niche TEXT NOT NULL,
    audience TEXT,
    title TEXT NOT NULL,
    premise TEXT NOT NULL,
    target_audience TEXT NOT NULL,
    problem_solved TEXT NOT NULL,
    why_it_sells TEXT NOT NULL,
    market_score INTEGER NOT NULL,
    originality_score INTEGER NOT NULL,
    series_potential INTEGER NOT NULL,
    movie_potential INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    selected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_studio_ideas_workspace ON studio_ideas(workspace_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_studio_ideas_niche ON studio_ideas(niche, market_score);
  CREATE INDEX IF NOT EXISTS idx_studio_ideas_selected ON studio_ideas(selected, created_at);
`);

db.exec('PRAGMA optimize;');

export default db;
