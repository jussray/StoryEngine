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

db.exec('PRAGMA optimize;');

export default db;
