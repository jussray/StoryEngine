import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('production startup migrates a legacy stories table before tenant indexes are created', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'storyengine-legacy-db-'));
  const dbPath = join(tempDir, 'l99.db');

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
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
      INSERT INTO stories (
        workspace_id, title, genre, pitch, mode, schema_version, created_at, updated_at
      ) VALUES (
        'legacy-workspace', 'Legacy Story', 'Drama', 'Preserve me', 'human-led', '1.0.0', 1, 1
      );
    `);
    legacyDb.close();

    const dbModuleUrl = pathToFileURL(join(process.cwd(), 'config', 'db.js')).href;
    const startup = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `const mod = await import(${JSON.stringify(dbModuleUrl)}); mod.default.close();`],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          L99_DB_PATH: dbPath,
        },
        encoding: 'utf8',
      },
    );

    assert.equal(
      startup.status,
      0,
      `legacy startup failed\nstdout:\n${startup.stdout}\nstderr:\n${startup.stderr}`,
    );

    const migratedDb = new DatabaseSync(dbPath);
    const storyColumns = migratedDb.prepare('PRAGMA table_info(stories)').all().map(row => row.name);
    assert.ok(storyColumns.includes('tenant_id'));
    assert.ok(storyColumns.includes('created_by_actor_id'));

    const tenantIndex = migratedDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_stories_tenant'",
    ).get();
    assert.equal(tenantIndex?.name, 'idx_stories_tenant');

    const preserved = migratedDb.prepare(
      'SELECT workspace_id, title, pitch FROM stories WHERE workspace_id = ?',
    ).get('legacy-workspace');
    assert.deepEqual(preserved, {
      workspace_id: 'legacy-workspace',
      title: 'Legacy Story',
      pitch: 'Preserve me',
    });
    migratedDb.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
