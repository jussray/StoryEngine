import test from 'node:test';
import assert from 'node:assert/strict';
import releaseAttemptRoutes from '../routes/releaseAttempts.js';

function captureRoutes() {
  const post = new Map();
  const router = {
    post(path, handler) { post.set(path, handler); },
    get() {},
  };
  const db = new Proxy({}, {
    get() { throw new Error('database must not be touched before release reconcile authority passes'); }
  });
  releaseAttemptRoutes(router, db);
  return post;
}

function response() {
  return {
    writableEnded: false,
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) {
      this.writableEnded = true;
      this.body = JSON.parse(payload);
    },
  };
}

test('global release reconciliation rejects non-administrator wildcard callers before database access', () => {
  const handler = captureRoutes().get('/api/release/attempts/reconcile');
  const res = response();
  handler({
    auth: { role: 'release_manager', workspace_ids: ['*'] },
    request_id: 'req-role',
    body: {},
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('global release reconciliation rejects workspace-limited administrators before database access', () => {
  const handler = captureRoutes().get('/api/release/attempts/reconcile');
  const res = response();
  handler({
    auth: { role: 'administrator', workspace_ids: ['workspace-a'] },
    request_id: 'req-scope',
    body: {},
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'global_workspace_forbidden');
  assert.equal(res.body.required_workspace_scope, '*');
});

test('workspace release reconciliation rejects low-privilege workspace members before database access', () => {
  const handler = captureRoutes().get('/api/release/attempts/reconcile/:workspace_id');
  const res = response();
  handler({
    auth: { role: 'viewer', workspace_ids: ['workspace-a'] },
    params: { workspace_id: 'workspace-a' },
    request_id: 'req-workspace-role',
    body: { stale_after_ms: 60_000 },
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.deepEqual(res.body.required_roles, ['release_manager']);
});

test('workspace release reconciliation rejects release managers outside the target workspace before database access', () => {
  const handler = captureRoutes().get('/api/release/attempts/reconcile/:workspace_id');
  const res = response();
  handler({
    auth: { role: 'release_manager', workspace_ids: ['workspace-b'] },
    params: { workspace_id: 'workspace-a' },
    request_id: 'req-workspace-scope',
    body: { stale_after_ms: 60_000 },
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
  assert.equal(res.body.workspace_id, 'workspace-a');
});

test('workspace-scoped reconciliation remains available at an explicit workspace route', () => {
  const routes = captureRoutes();
  assert.equal(typeof routes.get('/api/release/attempts/reconcile/:workspace_id'), 'function');
});
