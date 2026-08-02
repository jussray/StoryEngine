import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_PAGES, OPERATOR_PAGES, enforcePageAccess } from '../lib/pageGuard.js';

function mockRes() {
  return {
    writableEnded: false,
    statusCode: null,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(value = '') { this.body = String(value); this.writableEnded = true; },
    setHeader() {},
  };
}

test('creator pages include the core story flow', () => {
  assert.ok(CREATOR_PAGES.has('/front_door.html'));
  assert.ok(CREATOR_PAGES.has('/story_engine.html'));
  assert.ok(CREATOR_PAGES.has('/chapters.html'));
  assert.ok(CREATOR_PAGES.has('/studio.html'));
  assert.ok(CREATOR_PAGES.has('/ip_studio.html'));
});

test('operator pages include all backstage dashboards', () => {
  assert.ok(OPERATOR_PAGES.has('/control_room.html'));
  assert.ok(OPERATOR_PAGES.has('/ooda_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/lindymode_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/decision_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/performance_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/runtime_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/release_gate.html'));
});

test('no page appears in both sets', () => {
  for (const page of CREATOR_PAGES) {
    assert.ok(!OPERATOR_PAGES.has(page), `${page} is in both sets`);
  }
});

test('creator pages and their companion scripts are public shells', () => {
  for (const pathname of ['/story_engine.html', '/front_door.html', '/l99_auth.js']) {
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    let called = false;

    const result = enforcePageAccess(pathname, req, res, () => { called = true; });

    assert.equal(result, true);
    assert.equal(called, true);
    assert.equal(res.writableEnded, false);
  }
});

test('operator pages reject anonymous access', () => {
  const req = { method: 'GET', headers: {}, request_id: 'page-anon' };
  const res = mockRes();
  let called = false;

  enforcePageAccess('/control_room.html', req, res, () => { called = true; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'unauthorized');
});

test('operator pages allow an authenticated administrator', () => {
  const prior = process.env.L99_API_KEYS_JSON;
  try {
    process.env.L99_API_KEYS_JSON = JSON.stringify([
      { key: 'operator-secret', actor_id: 'founder', tenant_id: 'founder', role: 'administrator', workspace_ids: ['*'] }
    ]);
    const req = { method: 'GET', headers: { 'x-api-key': 'operator-secret' }, request_id: 'page-admin' };
    const res = mockRes();
    let called = false;

    enforcePageAccess('/control_room.html', req, res, () => { called = true; });

    assert.equal(called, true);
    assert.equal(res.writableEnded, false);
  } finally {
    if (prior === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = prior;
  }
});

test('unknown HTML and JavaScript paths fail closed', () => {
  for (const pathname of ['/unknown.html', '/unknown.js']) {
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    let called = false;

    const result = enforcePageAccess(pathname, req, res, () => { called = true; });

    assert.equal(result, false);
    assert.equal(called, false);
    assert.equal(res.statusCode, 404);
  }
});
