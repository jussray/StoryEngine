import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertStoryFormat, listConversions } from '../lib/ipStudio.js';
import { ensureRuntimeDispatchSchema } from '../lib/runtimeDispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

test('IP Studio persists Anthropic spending exhaustion as a blocker receipt', async () => {
  const priorAnthropic = process.env.ANTHROPIC_API_KEY;
  const priorFetch = globalThis.fetch;
  const secret = 'ip-studio-spending-limit-secret';
  const db = createDb();

  try {
    process.env.ANTHROPIC_API_KEY = secret;
    globalThis.fetch = async () => new Response(JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Spending limit reached for this account. reflected=${secret}`
      }
    }), { status: 400 });

    const result = await convertStoryFormat(db, {
      workspace_id: 'workspace-ip-blocked',
      story_vision: 'A quiet lighthouse guides a lost family home.',
      source_medium: 'book',
      target_format: 'movie',
      audience: 'family'
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.error_code, 'llm_provider_http_error');
    assert.equal(result.blocker_reason, 'spending_limit');
    assert.equal(String(result.error).includes(secret), false);
    assert.equal(String(result.error).includes('reflected='), false);

    const row = db.prepare('SELECT * FROM ip_conversions WHERE conversion_id=?').get(result.conversion_id);
    assert.equal(row.status, 'blocked');
    assert.equal(row.error_code, 'llm_provider_http_error');
    assert.equal(row.blocker_reason, 'spending_limit');
    assert.equal(String(row.error).includes(secret), false);

    const [listed] = listConversions(db, 'workspace-ip-blocked');
    assert.equal(listed.status, 'blocked');
    assert.equal(listed.error_code, 'llm_provider_http_error');
    assert.equal(listed.blocker_reason, 'spending_limit');
  } finally {
    db.close();
    globalThis.fetch = priorFetch;
    if (priorAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorAnthropic;
  }
});


test('legacy blocker tables upgrade additively without destroying existing rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE runtime_dispatch_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dispatch_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        chapter_id INTEGER,
        trigger_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        run_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      INSERT INTO runtime_dispatch_queue (
        dispatch_id, workspace_id, trigger_type, fingerprint, status, created_at
      ) VALUES ('dispatch-legacy', 'workspace-legacy', 'test', 'fingerprint-legacy', 'completed', 1);

      CREATE TABLE ip_conversions (
        conversion_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source_medium TEXT,
        target_format TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        output_text TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO ip_conversions (
        conversion_id, workspace_id, source_medium, target_format, status, created_at, updated_at
      ) VALUES ('conversion-legacy', 'workspace-legacy', 'book', 'movie', 'complete', 1, 1);
    `);

    ensureRuntimeDispatchSchema(db);
    const dispatchColumns = db.prepare('PRAGMA table_info(runtime_dispatch_queue)').all().map(row => row.name);
    assert.ok(dispatchColumns.includes('error_code'));
    assert.ok(dispatchColumns.includes('blocker_reason'));
    assert.equal(db.prepare("SELECT status FROM runtime_dispatch_queue WHERE dispatch_id='dispatch-legacy'").get().status, 'completed');

    const listed = listConversions(db, 'workspace-legacy');
    const conversionColumns = db.prepare('PRAGMA table_info(ip_conversions)').all().map(row => row.name);
    assert.ok(conversionColumns.includes('error_code'));
    assert.ok(conversionColumns.includes('blocker_reason'));
    assert.equal(listed[0].conversion_id, 'conversion-legacy');
    assert.equal(listed[0].status, 'complete');
  } finally {
    db.close();
  }
});
