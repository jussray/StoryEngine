import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSessionCookie,
  enforceOperatorApiBoundary,
  issueSession,
  requireAuth,
  assertWorkspaceAccess,
  requireWorkspaceAccess,
  requestSessionToken,
  resolveRequestIdentity,
  revokeSession,
  securitySnapshot,
  sessionCookie
} from '../lib/securityContext.js';

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
    assert.equal(securitySnapshot().cookie_credentials_enabled, true);
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

test('security context rejects a valid API key supplied only through a legacy cookie name', () => {
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

test('opaque server session authenticates without putting claims or API keys in the cookie', () => {
  const identity = {
    type: 'scoped_api_key',
    actor_id: 'actor-session',
    tenant_id: 'tenant-session',
    role: 'creator',
    workspace_ids: ['workspace_session']
  };
  const session = issueSession(identity);
  const cookie = sessionCookie(session.token, session.max_age_seconds);

  assert.match(cookie, /^l99_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!cookie.includes(identity.actor_id));
  assert.ok(!cookie.includes(identity.tenant_id));
  assert.ok(!cookie.includes('security-test-secret'));

  const req = { method: 'GET', headers: { cookie }, request_id: 'req_session' };
  const resolved = resolveRequestIdentity(req);
  assert.equal(resolved.type, 'session');
  assert.equal(resolved.actor_id, identity.actor_id);
  assert.equal(resolved.role, 'creator');
  assert.deepEqual(resolved.workspace_ids, ['workspace_session']);

  assert.equal(requestSessionToken(req), session.token);
  assert.equal(revokeSession(session.token), true);
  assert.equal(resolveRequestIdentity(req), null);
});

test('explicit header identity wins over a higher-privilege session cookie', () => {
  withRegistry([
    { key: 'security-test-header', actor_id: 'actor-header', tenant_id: 'tenant-header', role: 'viewer', workspace_ids: ['workspace_header'] }
  ], () => {
    const session = issueSession({
      actor_id: 'actor-session-admin',
      tenant_id: 'tenant-session-admin',
      role: 'administrator',
      workspace_ids: ['*']
    });
    const req = {
      method: 'GET',
      headers: {
        'x-api-key': 'security-test-header',
        cookie: sessionCookie(session.token, session.max_age_seconds)
      },
      request_id: 'req_mixed'
    };

    const identity = resolveRequestIdentity(req);
    assert.equal(identity.actor_id, 'actor-header');
    assert.equal(identity.role, 'viewer');
    revokeSession(session.token);
  });
});

test('session cookie clear contract expires the opaque identifier', () => {
  const cookie = clearSessionCookie();
  assert.match(cookie, /^l99_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=0/);
});

test('operator API membrane blocks creator access without blocking assist-default reads', () => {
  const restricted = [
    ['GET', '/api/control-room/operator'],
    ['GET', '/api/control-room/operator/options'],
    ['POST', '/api/control-room/operator/evaluate-cost'],
    ['GET', '/api/control-room/operator/alerts'],
    ['GET', '/api/control-room/founder'],
    ['GET', '/api/control-room/founder/options']
  ];

  for (const [method, url] of restricted) {
    const req = { method, url, auth: { role: 'creator' }, request_id: 'req_operator_boundary' };
    const res = mockRes();
    let nextCalled = false;
    enforceOperatorApiBoundary(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, `${method} ${url}`);
    assert.equal(res.status, 403, `${method} ${url}`);
  }

  const assistReq = {
    method: 'GET',
    url: '/api/control-room/operator/assist-default',
    auth: { role: 'creator' },
    request_id: 'req_assist_default'
  };
  const assistRes = mockRes();
  let assistNext = false;
  enforceOperatorApiBoundary(assistReq, assistRes, () => { assistNext = true; });
  assert.equal(assistNext, true);
  assert.equal(assistRes.writableEnded, false);

  const adminReq = {
    method: 'GET',
    url: '/api/control-room/operator',
    auth: { role: 'administrator' },
    request_id: 'req_operator_admin'
  };
  const adminRes = mockRes();
  let adminNext = false;
  enforceOperatorApiBoundary(adminReq, adminRes, () => { adminNext = true; });
  assert.equal(adminNext, true);
  assert.equal(adminRes.writableEnded, false);
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
