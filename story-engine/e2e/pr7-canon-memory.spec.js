/**
 * PR #7 AFTER — Canon Memory + Cross-Run Continuity
 * Run this spec against the goal/canon-memory-continuity branch.
 * ALL tests must pass before PR #7 merges to main.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const WORKSPACE = 'pw-workspace-001';

test.describe('PR #7 — Canon Memory', () => {
  let anchorId;

  test('POST /api/canon-anchors creates a new anchor and returns id', async ({ request }) => {
    const r = await request.post('/api/canon-anchors', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { kind: 'character', key: 'protagonist', value: 'Zara — determined, quiet fury', workspace_id: WORKSPACE }
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeDefined();
    anchorId = body.id;
  });

  test('POST /api/canon-anchors/lock locks the anchor', async ({ request }) => {
    test.skip(!anchorId, 'depends on create test passing first');
    const r = await request.post(`/api/canon-anchors/${anchorId}/lock`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.locked).toBe(true);
  });

  test('AI-source write to locked anchor is rejected with 409', async ({ request }) => {
    test.skip(!anchorId, 'depends on lock test passing first');
    const r = await request.patch(`/api/canon-anchors/${anchorId}`, {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { value: 'Zara — timid and unsure', source: 'ai' }
    });
    expect(r.status()).toBe(409);
  });

  test('human-source write to locked anchor succeeds', async ({ request }) => {
    test.skip(!anchorId, 'depends on lock test passing first');
    const r = await request.patch(`/api/canon-anchors/${anchorId}`, {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { value: 'Zara — determined, quiet fury, now scarred', source: 'human' }
    });
    expect(r.ok()).toBe(true);
  });

  test('GET /api/canon-anchors/snapshot returns anchors grouped by kind', async ({ request }) => {
    const r = await request.get(`/api/canon-anchors/snapshot?workspace_id=${WORKSPACE}`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    // Must be an object grouped by kind keys
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    // At least our character kind must be present
    expect(body.character).toBeDefined();
    expect(Array.isArray(body.character)).toBe(true);
  });

  test('world_rule contradiction is detected by redteam canon gate', async ({ request }) => {
    // First set a world rule
    await request.post('/api/canon-anchors', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { kind: 'world_rule', key: 'magic_rule', value: 'Magic does not exist in this world', workspace_id: WORKSPACE }
    });

    // Now check a draft that contradicts it
    const r = await request.post('/api/redteam/canon-check', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: {
        draft: 'She cast a spell and the door flew open. Magic had always been real here.',
        workspace_id: WORKSPACE
      }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    const violations = body.violations ?? body.warnings ?? [];
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v =>
      (v.kind === 'world_rule' || v.type === 'world_rule') &&
      v.key === 'magic_rule'
    )).toBe(true);
  });

  test('/lindy canon command returns canon snapshot', async ({ request }) => {
    const r = await request.post('/api/lindymode/command', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { command: '/lindy canon', workspace_id: WORKSPACE }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.snapshot ?? body.canon ?? body.result).toBeDefined();
  });

  test('/lindy check command runs canon gate', async ({ request }) => {
    const r = await request.post('/api/lindymode/command', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: {
        command: '/lindy check',
        workspace_id: WORKSPACE,
        draft: 'She cast a powerful spell that shook the earth.'
      }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    // Must return a structured report, not a raw string
    expect(typeof body).toBe('object');
    expect(body.status ?? body.result ?? body.violations).toBeDefined();
  });
});
