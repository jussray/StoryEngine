import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_PAGES, OPERATOR_PAGES, PUBLIC_BOOTSTRAP_PAGES, enforcePageAccess } from '../lib/pageGuard.js';
import { issueSession, revokeSession, sessionCookie } from '../lib/securityContext.js';

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

function cookieFor(role, actor = role) {
  const session = issueSession({
    actor_id: `actor-${actor}`,
    tenant_id: `tenant-${actor}`,
    role,
    workspace_ids: role === 'administrator' ? ['*'] : ['workspace-1']
  });
  return {
    token: session.token,
    cookie: sessionCookie(session.token, session.max_age_seconds)
  };
}

test('creator pages include the core story flow and shared browser clients', () => {
  assert.ok(CREATOR_PAGES.has('/front_door.html'));
  assert.ok(CREATOR_PAGES.has('/story_engine.html'));
  assert.ok(CREATOR_PAGES.has('/story_universe.html'));
  assert.ok(CREATOR_PAGES.has('/chapters.html'));
  assert.ok(CREATOR_PAGES.has('/studio.html'));
  assert.ok(CREATOR_PAGES.has('/ip_studio.html'));
  assert.ok(CREATOR_PAGES.has('/video_studio.html'));
  assert.ok(CREATOR_PAGES.has('/l99_auth.js'));
  assert.ok(CREATOR_PAGES.has('/video_control_room.js'));
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

test('only the first-run entry and auth client are public bootstrap assets', () => {
  assert.deepEqual([...PUBLIC_BOOTSTRAP_PAGES].sort(), ['/front_door.html', '/l99_auth.js']);
});

test('no page appears in both creator and operator sets', () => {
  for (const page of CREATOR_PAGES) {
    assert.ok(!OPERATOR_PAGES.has(page), `${page} is in both sets`);
  }
});

test('public bootstrap pages remain reachable without auth deadlock', () => {
  for (const pathname of ['/front_door.html', '/l99_auth.js']) {
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    let called = false;
    const result = enforcePageAccess(pathname, req, res, () => { called = true; });
    assert.equal(result, true);
    assert.equal(called, true);
    assert.equal(res.writableEnded, false);
  }
});

test('creator session can access creator pages but not operator pages', () => {
  const session = cookieFor('creator');
  try {
    const creatorReq = { method: 'GET', headers: { cookie: session.cookie } };
    const creatorRes = mockRes();
    let creatorCalled = false;
    assert.equal(enforcePageAccess('/story_engine.html', creatorReq, creatorRes, () => { creatorCalled = true; }), true);
    assert.equal(creatorCalled, true);

    const operatorReq = { method: 'GET', headers: { cookie: session.cookie } };
    const operatorRes = mockRes();
    let operatorCalled = false;
    assert.equal(enforcePageAccess('/control_room.html', operatorReq, operatorRes, () => { operatorCalled = true; }), false);
    assert.equal(operatorCalled, false);
    assert.equal(operatorRes.statusCode, 403);
  } finally {
    revokeSession(session.token);
  }
});

test('administrator session can access creator and operator pages', () => {
  const session = cookieFor('administrator');
  try {
    for (const pathname of ['/story_engine.html', '/control_room.html', '/control_room.js', '/mission_control.html']) {
      const req = { method: 'GET', headers: { cookie: session.cookie } };
      const res = mockRes();
      let called = false;
      const result = enforcePageAccess(pathname, req, res, () => { called = true; });
      assert.equal(result, true, pathname);
      assert.equal(called, true, pathname);
      assert.equal(res.writableEnded, false, pathname);
    }
  } finally {
    revokeSession(session.token);
  }
});

test('raw API key cannot bypass the static page session boundary', () => {
  const prior = process.env.API_KEY;
  process.env.API_KEY = 'page-key';
  try {
    const req = { method: 'GET', headers: { 'x-api-key': 'page-key' } };
    const res = mockRes();
    let called = false;
    const result = enforcePageAccess('/story_engine.html', req, res, () => { called = true; });
    assert.equal(result, false);
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  } finally {
    if (prior === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = prior;
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
