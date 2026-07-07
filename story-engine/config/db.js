// config/db.js — node:sqlite connection with WAL + performance PRAGMAs
// Requires Node 22.5+

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(join(__dirname, '../db'), { recursive: true });

const db = new DatabaseSync(join(__dirname, '../db/l99.db'));

// WAL mode: readers don't block writers
db.exec('PRAGMA journal_mode = WAL;');

// Reduced fsync strictness — safe for most workloads
db.exec('PRAGMA synchronous = NORMAL;');

// 10MB page cache
db.exec('PRAGMA cache_size = -10000;');

// Temp tables in memory
db.exec('PRAGMA temp_store = MEMORY;');

// Load and run schema
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
db.exec(schema);

export default db;
