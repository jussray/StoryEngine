import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertStoryFormat, listConversions } from '../lib/ipStudio.js';

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
