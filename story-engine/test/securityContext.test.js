import test from 'node:test';
import assert from 'node:assert/strict';

import { requireAuth, assertWorkspaceAccess, requireWorkspaceAccess, securitySnapshot } from '../lib/securityContext.js';

function mockRes() {
  return {
    writableEnded: false,
    status: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status) { this.status = status; },
    end(value) { this.writableEnded = true; this.body = value ? JSON.parse(value) : null; }
  };
}

function withRegistry(entries, callback) {
  const prior = process.env.L99_API_KEYS_JSON;
  try {
    process.env.L99_API_KEYS_JSON = JSON.stringify(entries);
    callback();
  } finally {
    if (prior === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = prior;
  }
}

test('security context resolves scoped actor identity from x-api-key', () => {
  withRegistry([
    { key: 'security-test-secret-a', actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'editor', workspace_ids: ['workspace_1'] }
  ], () => {
    const req = { method: 'GET', headers: { 'x-api-key': 'security-test-secret-a' }, request_id: 'req_1' };
    const res = mockRes();
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.actor_id, 'actor-a');
    assert.equal(req.auth.tenant_id, 'tenant-a');
    assert.ok(securitySnapshot().scoped_key_count >= 1);
    assert.equal(securitySnapshot().cookie_credentials_enabled, false);
  });
});

test('security context preserves Bearer authentication', () => {
  withRegistry([
    { key: 'security-test-bearer', actor_id: 'actor-b', tenant_id: 'tenant-b', role: 'viewer', workspace_ids: ['workspace_b'] }
  ], () => {
    const req = { method: 'GET', headers: { authorization: 'Bearer security-test-bearer' }, request_id: 'req_bearer' };
    const res = mockRes();
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.actor_id, 'actor-b');
    assert.equal(req.auth.tenant_id, 'tenant-b');
  });
});

test('security context rejects a valid key supplied only through cookies', () => {
  withRegistry([
    { key: 'cookie-secret', actor_id: 'cookie-actor', tenant_id: 'tenant-a', role: 'viewer', workspace_ids: ['workspace_1'] }
  ], () => {
    const req = {
      method: 'GET',
      headers: { cookie: `theme=dark; l99_api_key=${encodeURIComponent('cookie-secret')}; other=1` },
      request_id: 'req_cookie'
    };
    const res = mockRes();
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
  });
});

test('cookie credentials cannot override an explicit lower-privilege header identity', () => {
  withRegistry([
    { key: 'security-test-header', actor_id: 'actor-header', tenant_id: 'tenant-header', role: 'viewer', workspace_ids: ['workspace_header'] },
    { key: 'security-test-cookie-admin', actor_id: 'actor-cookie-admin', tenant_id: 'tenant-cookie', role: 'administrator', workspace_ids: ['*'] }
  ], () => {
    const req = {
      method: 'GET',
      headers: {
        'x-api-key': 'security-test-header',
        cookie: 'l99_api_key=security-test-cookie-admin'
      },
      request_id: 'req_mixed'
    };
    const res = mockRes();
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.actor_id, 'actor-header');
    assert.equal(req.auth.role, 'viewer');
  });
});

test('security context refreshes cached registry when env source changes', () => {
  const prior = process.env.L99_API_KEYS_JSON;
  try {
    process.env.L99_API_KEYS_JSON = JSON.stringify([{ key: 'security-test-secret-one', actor_id: 'actor-one', tenant_id: 'tenant-one', role: 'viewer', workspace_ids: ['one'] }]);
    const first = securitySnapshot().scoped_key_count;

    process.env.L99_API_KEYS_JSON = JSON.stringify([
      { key: 'security-test-secret-one', actor_id: 'actor-one', tenant_id: 'tenant-one', role: 'viewer', workspace_ids: ['one'] },
      { key: 'security-test-secret-two', actor_id: 'actor-two', tenant_id: 'tenant-two', role: 'editor', workspace_ids: ['two'] }
    ]);
    const second = securitySnapshot().scoped_key_count;
    assert.equal(second - first, 1);
  } finally {
    if (prior === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = prior;
  }
});

test('workspace access uses params/query helper instead of trusting unparsed body middleware', () => {
  const req = { auth: { workspace_ids: ['workspace_allowed'] }, request_id: 'req_2' };
  assert.equal(assertWorkspaceAccess(req, 'workspace_allowed'), true);
  assert.equal(assertWorkspaceAccess(req, 'workspace_denied'), false);

  const res = mockRes();
  const allowed = requireWorkspaceAccess(req, res, 'workspace_denied');
  assert.equal(allowed, false);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
});
