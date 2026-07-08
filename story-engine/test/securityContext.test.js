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

test('security context caches scoped registry and resolves actor identity', () => {
  const prior = process.env.L99_API_KEYS_JSON;
  try {
    process.env.L99_API_KEYS_JSON = JSON.stringify([{ key: 'secret-a', actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'editor', workspace_ids: ['workspace_1'] }]);
    const req = { method: 'GET', headers: { 'x-api-key': 'secret-a' }, request_id: 'req_1' };
    const res = mockRes();
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.actor_id, 'actor-a');
    assert.equal(req.auth.tenant_id, 'tenant-a');
    assert.equal(securitySnapshot().scoped_key_count, 1);
  } finally {
    if (prior === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = prior;
  }
});

test('security context refreshes cached registry when env source changes', () => {
  const prior = process.env.L99_API_KEYS_JSON;
  try {
    process.env.L99_API_KEYS_JSON = JSON.stringify([{ key: 'secret-one', actor_id: 'actor-one', tenant_id: 'tenant-one', role: 'viewer', workspace_ids: ['one'] }]);
    assert.equal(securitySnapshot().scoped_key_count, 1);

    process.env.L99_API_KEYS_JSON = JSON.stringify([
      { key: 'secret-one', actor_id: 'actor-one', tenant_id: 'tenant-one', role: 'viewer', workspace_ids: ['one'] },
      { key: 'secret-two', actor_id: 'actor-two', tenant_id: 'tenant-two', role: 'editor', workspace_ids: ['two'] }
    ]);
    assert.equal(securitySnapshot().scoped_key_count, 2);
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
