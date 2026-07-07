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

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA cache_size = -10000;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');

const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
db.exec(schema);
db.exec('PRAGMA optimize;');

export default db;
