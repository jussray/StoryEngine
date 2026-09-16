import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../lib/sqliteTransaction.js';
import * as Story from '../models/storyModel.js';
import { assertWorkspaceAccess } from '../lib/securityContext.js';
import { canCreateWorkspace } from '../lib/workspaceCreationAuthority.js';
import { importBusinessMetricsCsv, businessMetricsSummary } from '../lib/businessMetrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('explicit workspace scope cannot be widened by durable membership', () => {
  const db = createDb();
  try {
    const first = Story.create(db, {
      title: 'First', tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator'
    });
    const second = Story.create(db, {
      title: 'Second', tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator'
    });

    const scopedIdentity = {
      tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: [first]
    };
    assert.deepEqual(Story.list(db, scopedIdentity).map(item => item.workspace_id), [first]);
    assert.equal(assertWorkspaceAccess({ db, auth: scopedIdentity }, first), true);
    assert.equal(assertWorkspaceAccess({ db, auth: scopedIdentity }, second), false);

    const membershipIdentity = {
      tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: []
    };
    assert.deepEqual(
      new Set(Story.list(db, membershipIdentity).map(item => item.workspace_id)),
      new Set([first, second])
    );
    assert.equal(assertWorkspaceAccess({ db, auth: membershipIdentity }, second), true);
  } finally {
    db.close();
  }
});

test('workspace creation authority rejects named hard scopes and viewer roles', () => {
  assert.equal(canCreateWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['workspace-a']
  }), false);
  assert.equal(canCreateWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: []
  }), true);
  assert.equal(canCreateWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['*']
  }), true);
  assert.equal(canCreateWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'viewer', workspace_ids: []
  }), false);
});

test('business metric summaries never collapse distinct account/page/audience identity', () => {
  const db = createDb();
  try {
    const csvA = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-14T12:00:00Z,impressions,100,count'
    ].join('\n');
    const csvB = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-15T12:00:00Z,impressions,900,count'
    ].join('\n');

    importBusinessMetricsCsv(db, csvA, {
      workspace_id: 'workspace-a',
      audience_segment: 'founders',
      source: 'metricool:facebook',
      account_id: 'brand-a',
      page_id: 'page-a'
    });
    importBusinessMetricsCsv(db, csvB, {
      workspace_id: 'workspace-a',
      audience_segment: 'parents',
      source: 'metricool:facebook',
      account_id: 'brand-b',
      page_id: 'page-b'
    });

    const summary = businessMetricsSummary(db, 'workspace-a');
    assert.equal(summary.metrics.length, 2);
    const brandA = summary.metrics.find(item => item.account_id === 'brand-a');
    const brandB = summary.metrics.find(item => item.account_id === 'brand-b');
    assert.equal(brandA.latest_value, 100);
    assert.equal(brandA.max_observed_value, 100);
    assert.equal(brandA.page_id, 'page-a');
    assert.equal(brandA.audience_segment, 'founders');
    assert.equal(brandB.latest_value, 900);
    assert.equal(brandB.max_observed_value, 900);
    assert.equal(brandB.page_id, 'page-b');
    assert.equal(brandB.audience_segment, 'parents');
  } finally {
    db.close();
  }
});
