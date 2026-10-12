import test from 'node:test';
import assert from 'node:assert/strict';
import learningRoutes from '../routes/learning.js';
import ipStudioRoutes from '../routes/ipStudio.js';

function registerRoutes(install) {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set('GET ' + path, handler); },
    post(path, handler) { routes.set('POST ' + path, handler); }
  };
  install(router, {
    prepare() { throw new Error('DENIED REQUEST MUST NOT ACCESS DATABASE'); }
  });
  return routes;
}

function response() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    setHeader() {},
    end(body) { this.body = body ? JSON.parse(body) : null; this.writableEnded = true; }
  };
}

const learning = registerRoutes(learningRoutes);
const ipStudio = registerRoutes(ipStudioRoutes);

const cases = [
  [learning, 'GET /api/ooda/episodes/:workspace_id'],
  [learning, 'POST /api/ooda/predict/:workspace_id'],
  [learning, 'GET /api/ooda/risk-history/:workspace_id'],
  [ipStudio, 'GET /api/ip-studio/:workspace_id/production-packs'],
  [ipStudio, 'POST /api/ip-studio/:workspace_id/production-pack']
];

for (const [routes, endpoint] of cases) {
  test(endpoint + ' rejects cross-workspace credentials before data access', () => {
    const handler = routes.get(endpoint);
    assert.equal(typeof handler, 'function');
    const req = {
      params: { workspace_id: 'workspace_other' },
      query: {},
      body: {},
      request_id: 'tenant-guard-test',
      auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['workspace_allowed'] }
    };
    const res = response();
    handler(req, res);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'workspace_forbidden');
  });
}

for (const [routes, endpoint] of [
  [learning, 'GET /api/ooda/learned-recoveries'],
  [ipStudio, 'GET /api/ip-studio/overview']
]) {
  test(endpoint + ' rejects non-admin callers', () => {
    const handler = routes.get(endpoint);
    assert.equal(typeof handler, 'function');
    const res = response();
    handler({ auth: { role: 'creator' }, query: {}, request_id: 'role-guard-test' }, res);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  });
}
