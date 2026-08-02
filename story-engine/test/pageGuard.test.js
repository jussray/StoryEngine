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

test('creator pages include the core story flow and shared browser clients', () => {
  assert.ok(CREATOR_PAGES.has('/front_door.html'));
  assert.ok(CREATOR_PAGES.has('/story_engine.html'));
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

test('no page appears in both sets', () => {
  for (const page of CREATOR_PAGES) {
    assert.ok(!OPERATOR_PAGES.has(page), `${page} is in both sets`);
  }
});

test('known creator and operator assets are public static shells', () => {
  for (const pathname of [
    '/story_engine.html',
    '/front_door.html',
    '/l99_auth.js',
    '/control_room.html',
    '/control_room.js',
    '/video_control_room.js',
    '/video_studio.html',
    '/video_studio.js',
    '/mission_control.html',
  ]) {
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    let called = false;

    const result = enforcePageAccess(pathname, req, res, () => { called = true; });

    assert.equal(result, true);
    assert.equal(called, true);
    assert.equal(res.writableEnded, false);
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
