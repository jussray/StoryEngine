import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../lib/sqliteTransaction.js';
import * as Story from '../models/storyModel.js';
import { assertWorkspaceAccess } from '../lib/securityContext.js';
import { canCreateWorkspace, canCreateDerivedWorkspace } from '../lib/workspaceCreationAuthority.js';
import { importBusinessMetricsCsv, listBusinessMetrics, businessMetricsSummary } from '../lib/businessMetrics.js';

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

test('derived workspace creation preserves source ownership without creating inaccessible targets', () => {
  const source = {
    tenant_id: 'tenant-a',
    created_by_actor_id: 'actor-a'
  };
  assert.equal(canCreateDerivedWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: []
  }, source), true);
  assert.equal(canCreateDerivedWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-b', role: 'creator', workspace_ids: []
  }, source), false);
  assert.equal(canCreateDerivedWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-b', role: 'creator', workspace_ids: ['*']
  }, source), true);
  assert.equal(canCreateDerivedWorkspace({
    tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['workspace-source']
  }, source), false);
  assert.equal(canCreateDerivedWorkspace({
    tenant_id: 'tenant-b', actor_id: 'actor-a', role: 'administrator', workspace_ids: ['*']
  }, source), false);
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


test('business metric context imports preserve unknown audience instead of inventing a segment', () => {
  const db = createDb();
  try {
    const csv = [
      'observed_at,metric_name,metric_value,unit,content_id,condition',
      '2026-09-15T12:00:00Z,impressions,11,count,post-1,context'
    ].join('\n');
    const result = importBusinessMetricsCsv(db, csv, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a',
      page_id: 'page-a'
    });
    assert.equal(result.written, 1);
    const [row] = listBusinessMetrics(db, 'workspace-a');
    assert.equal(row.audience_segment, null);
    assert.equal(row.condition, 'context');
  } finally {
    db.close();
  }
});

test('business metrics reject naive timestamps and malformed metric identities atomically', () => {
  const db = createDb();
  try {
    const naive = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-15T12:00:00,impressions,1,count'
    ].join('\n');
    assert.throws(() => importBusinessMetricsCsv(db, naive, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a'
    }), /explicit timezone/i);

    const malformed = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-15T12:00:00Z,Reach Total,1,count'
    ].join('\n');
    assert.throws(() => importBusinessMetricsCsv(db, malformed, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a'
    }), /lowercase snake_case/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_metric_observations').get().count, 0);
  } finally {
    db.close();
  }
});

test('controlled business evidence requires comparable publication semantics', () => {
  const db = createDb();
  try {
    const incomplete = [
      'observed_at,metric_name,metric_value,unit,content_id,condition',
      '2026-09-15T12:00:00Z,shares,4,count,post-test,test'
    ].join('\n');
    assert.throws(() => importBusinessMetricsCsv(db, incomplete, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a',
      audience_segment: 'followers'
    }), /requires published_at/i);

    const mismatchedWindow = [
      'observed_at,published_at,measurement_window_hours,metric_name,metric_value,unit,content_id,condition',
      '2026-09-15T12:00:00Z,2026-09-14T12:00:00Z,168,shares,4,count,post-test,test'
    ].join('\n');
    assert.throws(() => importBusinessMetricsCsv(db, mismatchedWindow, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a',
      audience_segment: 'followers'
    }), /does not match/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_metric_observations').get().count, 0);
  } finally {
    db.close();
  }
});

test('business metric summaries do not mix context, test, comparison, or measurement windows', () => {
  const db = createDb();
  try {
    const csv = [
      'observed_at,published_at,measurement_window_hours,metric_name,metric_value,unit,content_id,condition,audience_segment',
      '2026-09-15T12:00:00Z,2026-09-14T12:00:00Z,24,shares,4,count,post-context,context,',
      '2026-09-15T12:00:00Z,2026-09-14T12:00:00Z,24,shares,8,count,post-control,comparison,followers',
      '2026-09-15T12:00:00Z,2026-09-14T12:00:00Z,24,shares,12,count,post-test,test,followers'
    ].join('\n');
    const receipt = importBusinessMetricsCsv(db, csv, {
      workspace_id: 'workspace-a',
      source: 'metricool:facebook',
      account_id: 'brand-a',
      page_id: 'page-a'
    });
    assert.equal(receipt.written, 3);
    const summary = businessMetricsSummary(db, 'workspace-a');
    assert.equal(summary.metrics.length, 3);
    assert.deepEqual(new Set(summary.metrics.map(item => item.condition)), new Set(['context', 'comparison', 'test']));
    assert.equal(summary.metrics.find(item => item.condition === 'context').audience_segment, null);
  } finally {
    db.close();
  }
});
