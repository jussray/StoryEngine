import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('startup upgrades a legacy persistent database before creating new indexes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l99-legacy-db-'));
  const dbPath = join(dir, 'l99.db');
  const legacy = new DatabaseSync(dbPath);

  legacy.exec(`
    CREATE TABLE stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      genre TEXT,
      pitch TEXT,
      mode TEXT,
      schema_version TEXT NOT NULL DEFAULT '1.0.0',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE memory_diffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      chapter_id INTEGER,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      conflict INTEGER NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    INSERT INTO stories (
      workspace_id, title, genre, pitch, mode, schema_version, created_at, updated_at
    ) VALUES (
      'legacy-workspace', 'Preserve Me', 'fiction', 'existing production row', 'book', '1.0.0', 1000, 2000
    );

    INSERT INTO memory_diffs (
      workspace_id, chapter_id, entity_type, entity_id, field, old_value, new_value, conflict, resolved, created_at
    ) VALUES (
      'legacy-workspace', 1, 'character', 'char-1', 'name', 'Old', 'New', 0, 0, 1500
    );
  `);
  legacy.close();

  const previousNodeEnv = process.env.NODE_ENV;
  const previousDbPath = process.env.L99_DB_PATH;

  try {
    process.env.NODE_ENV = 'production';
    process.env.L99_DB_PATH = dbPath;

    const { default: db } = await import(`../config/db.js?legacy-upgrade=${Date.now()}`);

    const storyColumns = db.prepare('PRAGMA table_info(stories)').all().map(row => row.name);
    assert.ok(storyColumns.includes('tenant_id'));
    assert.ok(storyColumns.includes('created_by_actor_id'));

    const diffColumns = db.prepare('PRAGMA table_info(memory_diffs)').all().map(row => row.name);
    for (const column of ['diff_id', 'resolution', 'source', 'resolved_at']) {
      assert.ok(diffColumns.includes(column), `expected migrated memory_diffs.${column}`);
    }

    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_stories_tenant'").get(),
      'expected tenant index after additive migration'
    );

    const story = db.prepare("SELECT workspace_id, title, pitch FROM stories WHERE workspace_id = 'legacy-workspace'").get();
    assert.equal(story?.title, 'Preserve Me');
    assert.equal(story?.pitch, 'existing production row');

    const diff = db.prepare("SELECT old_value, new_value, source FROM memory_diffs WHERE workspace_id = 'legacy-workspace'").get();
    assert.equal(diff?.old_value, 'Old');
    assert.equal(diff?.new_value, 'New');
    assert.equal(diff?.source, 'system');

    db.close();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousDbPath === undefined) delete process.env.L99_DB_PATH;
    else process.env.L99_DB_PATH = previousDbPath;

    rmSync(dir, { recursive: true, force: true });
  }
});
