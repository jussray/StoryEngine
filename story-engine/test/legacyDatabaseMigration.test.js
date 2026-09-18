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

    CREATE TABLE business_metric_observations (
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

    INSERT INTO business_metric_observations (
      observation_id, workspace_id, audience_segment, source, account_id, page_id, content_id,
      metric_name, metric_value, value_state, unit, observed_at, imported_at, historical,
      provenance_json, raw_row_hash
    ) VALUES (
      'metric_legacy', 'legacy-workspace', 'founders', 'metricool:facebook', 'brand-legacy',
      'page-legacy', 'post-legacy', 'impressions', 11, 'observed', 'count',
      1789473600000, 1789477200000, 1, '{"connector":"metricool"}', 'legacy-row-hash'
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

    const metricColumns = db.prepare('PRAGMA table_info(business_metric_observations)').all().map(row => row.name);
    for (const column of ['condition', 'published_at', 'measurement_window_hours']) {
      assert.ok(metricColumns.includes(column), `expected migrated business_metric_observations.${column}`);
    }

    const metric = db.prepare(`
      SELECT observation_id, audience_segment, source, account_id, page_id, content_id,
             metric_name, metric_value, condition, published_at, measurement_window_hours
      FROM business_metric_observations
      WHERE observation_id = 'metric_legacy'
    `).get();
    assert.equal(metric?.audience_segment, 'founders');
    assert.equal(metric?.source, 'metricool:facebook');
    assert.equal(metric?.account_id, 'brand-legacy');
    assert.equal(metric?.page_id, 'page-legacy');
    assert.equal(metric?.content_id, 'post-legacy');
    assert.equal(metric?.metric_name, 'impressions');
    assert.equal(metric?.metric_value, 11);
    assert.equal(metric?.condition, 'context');
    assert.equal(metric?.published_at, null);
    assert.equal(metric?.measurement_window_hours, null);

    db.close();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousDbPath === undefined) delete process.env.L99_DB_PATH;
    else process.env.L99_DB_PATH = previousDbPath;

    rmSync(dir, { recursive: true, force: true });
  }
});
