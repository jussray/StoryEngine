import test from 'node:test';
import assert from 'node:assert/strict';
import releaseAttemptRoutes from '../routes/releaseAttempts.js';
import ipStudioRoutes from '../routes/ipStudio.js';

function setup(register) {
  const routes = new Map();
  const router = {
    get(path, ...handlers) { routes.set('GET ' + path, handlers); },
    post(path, ...handlers) { routes.set('POST ' + path, handlers); }
  };
  const db = { prepare() { throw new Error('Unauthorized request reached database'); } };
  register(router, db);
  return routes;
}
function invoke(routes, method, path) {
  const res = {
    status: null, body: null, writableEnded: false,
    setHeader() {},
    writeHead(status) { this.status = status; },
    end(body) { this.writableEnded = true; this.body = JSON.parse(body); }
  };
  const handlers = routes.get(method + ' ' + path);
  assert.ok(handlers, 'Expected route registered');
  handlers[handlers.length - 1]({
    params: { workspace_id: 'foreign-workspace' }, body: {}, query: {},
    request_id: 'workspace-denial-test',
    auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['allowed-workspace'] }
  }, res);
  return res;
}
for (const [register, method, path] of [
  [releaseAttemptRoutes, 'POST', '/api/release/attempt/:workspace_id'],
  [releaseAttemptRoutes, 'GET', '/api/release/attempts/:workspace_id'],
  [ipStudioRoutes, 'GET', '/api/ip-studio/:workspace_id/production-packs'],
  [ipStudioRoutes, 'POST', '/api/ip-studio/:workspace_id/production-pack']
]) {
  test(method + ' ' + path + ' denies foreign workspace before database operations', () => {
    const res = invoke(setup(register), method, path);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'workspace_forbidden');
  });
}
