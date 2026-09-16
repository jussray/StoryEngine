// config/db.js — node:sqlite connection with WAL + performance PRAGMAs
// Requires Node 22.5+

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../lib/sqliteTransaction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configuredDbPath = String(process.env.L99_DB_PATH || '').trim();

if (process.env.NODE_ENV === 'production' && !configuredDbPath) {
  throw new Error('Production requires L99_DB_PATH bound to a persistent mounted path.');
}

export const dbPath = configuredDbPath
  ? resolve(configuredDbPath)
  : join(__dirname, '../db/l99.db');

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA cache_size = -10000;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');

const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
const schemaIndexMarker = '\nCREATE INDEX IF NOT EXISTS ';
const firstIndexOffset = schema.indexOf(schemaIndexMarker);

if (firstIndexOffset < 0) {
  throw new Error('Schema migration boundary missing: expected CREATE INDEX section.');
}

// Existing production databases can predate additive columns referenced by
// current indexes. CREATE TABLE IF NOT EXISTS does not change an old table's
// shape, so execute table DDL first, apply additive migrations, then indexes.
// This keeps upgrades in place and never requires replacing persistent data.
const schemaTables = schema.slice(0, firstIndexOffset);
const schemaIndexes = schema.slice(firstIndexOffset);
db.exec(schemaTables);

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
ensureColumn('stories', 'tenant_id', 'TEXT');
ensureColumn('stories', 'created_by_actor_id', 'TEXT');

db.exec(schemaIndexes);

db.exec(`
  DELETE FROM memory_diffs
  WHERE field = 'content_hash'
    AND id NOT IN (
      SELECT MIN(id)
      FROM memory_diffs
      WHERE field = 'content_hash'
      GROUP BY workspace_id, chapter_id, field, new_value
    );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_diffs_diff_id
    ON memory_diffs(diff_id)
    WHERE diff_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_content_hash_once
    ON memory_diffs(workspace_id, chapter_id, field, new_value)
    WHERE field = 'content_hash';
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'creator',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, tenant_id, actor_id)
  );
  CREATE INDEX IF NOT EXISTS idx_workspace_memberships_actor
    ON workspace_memberships(tenant_id, actor_id, workspace_id);
  CREATE INDEX IF NOT EXISTS idx_stories_tenant
    ON stories(tenant_id, updated_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS business_metric_observations (
    observation_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    audience_segment TEXT NOT NULL,
    source TEXT NOT NULL,
    account_id TEXT NOT NULL,
    page_id TEXT,
    content_id TEXT,
    metric_name TEXT NOT NULL,
    metric_value REAL,
    value_state TEXT NOT NULL CHECK(value_state IN ('observed','missing')),
    unit TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    imported_at INTEGER NOT NULL,
    historical INTEGER NOT NULL DEFAULT 0,
    provenance_json TEXT NOT NULL DEFAULT '{}',
    raw_row_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_business_metrics_workspace_time
    ON business_metric_observations(workspace_id, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_business_metrics_source
    ON business_metric_observations(source, account_id, page_id, observed_at DESC);
`);

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
