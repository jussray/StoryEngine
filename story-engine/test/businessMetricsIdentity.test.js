import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../lib/sqliteTransaction.js';
import { importBusinessMetricsCsv, businessMetricsSummary } from '../lib/businessMetrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('business metrics summary keeps different content ids as separate evidence subjects', () => {
  const db = createDb();
  try {
    const csv = [
      'observed_at,metric_name,metric_value,unit,content_id',
      '2026-09-01T12:00:00Z,impressions,10,count,post-a',
      '2026-09-02T12:00:00Z,impressions,12,count,post-a',
      '2026-09-02T12:00:00Z,impressions,99,count,post-b'
    ].join('\n');

    const receipt = importBusinessMetricsCsv(db, csv, {
      workspace_id: 'workspace-a',
      audience_segment: 'founders',
      source: 'metricool:facebook',
      account_id: 'brand-123',
      page_id: 'page-456'
    });
    assert.equal(receipt.written, 3);

    const metrics = businessMetricsSummary(db, 'workspace-a').metrics;
    assert.equal(metrics.length, 2);

    const postA = metrics.find(item => item.content_id === 'post-a');
    const postB = metrics.find(item => item.content_id === 'post-b');
    assert.ok(postA);
    assert.ok(postB);
    assert.equal(postA.observations, 2);
    assert.equal(postA.latest_value, 12);
    assert.equal(postA.max_observed_value, 12);
    assert.equal(postB.observations, 1);
    assert.equal(postB.latest_value, 99);
    assert.equal(postB.max_observed_value, 99);
  } finally {
    db.close();
  }
});
