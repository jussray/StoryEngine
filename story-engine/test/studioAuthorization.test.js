import test from 'node:test';
import assert from 'node:assert/strict';
import studioRoutes from '../routes/studio.js';

function setup() {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set('GET ' + path, handler); },
    post(path, handler) { routes.set('POST ' + path, handler); }
  };
  const db = {
    prepare(sql) {
      if (sql.includes('FROM stories WHERE workspace_id')) return { get: () => ({ tenant_id: 'tenant-a' }) };
      if (sql.includes('FROM workspace_memberships')) return { get: () => null };
      if (sql.includes('FROM studio_ideas WHERE idea_id')) return { get: () => ({
        idea_id: 'foreign-idea', workspace_id: 'workspace-b', title: 'Other tenant idea'
      }) };
      throw new Error('Unexpected query: ' + sql);
    }
  };
  studioRoutes(router, db);
  return routes;
}
function response() {
  return {
    status: null, body: null, writableEnded: false,
    setHeader() {},
    writeHead(status) { this.status = status; },
    end(body) { this.writableEnded = true; this.body = JSON.parse(body); }
  };
}
function invoke(routes, method, path, { params = {}, query = {}, body = {} } = {}) {
  const res = response();
  routes.get(method + ' ' + path)({
    params, query, body, request_id: 'studio-security-test',
    auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['workspace-a'] }
  }, res);
  return res;
}
test('Studio idea list requires explicit workspace scope', () => {
  const res = invoke(setup(), 'GET', '/api/studio/ideas');
  assert.equal(res.status, 400);
});
test('Studio idea list rejects a workspace outside credential scope', () => {
  const res = invoke(setup(), 'GET', '/api/studio/ideas', { query: { workspace_id: 'workspace-b' } });
  assert.equal(res.status, 403);
});
test('Studio idea read rejects cross-workspace idea IDs', () => {
  const res = invoke(setup(), 'GET', '/api/studio/ideas/:idea_id', { params: { idea_id: 'foreign-idea' } });
  assert.equal(res.status, 403);
});
test('Studio idea selection rejects cross-workspace ID before mutation', () => {
  const res = invoke(setup(), 'POST', '/api/studio/ideas/:idea_id/select', { params: { idea_id: 'foreign-idea' } });
  assert.equal(res.status, 403);
});
test('Studio generation rejects unauthorized body workspace', () => {
  const res = invoke(setup(), 'POST', '/api/studio/ideas/generate', { body: { workspace_id: 'workspace-b' } });
  assert.equal(res.status, 403);
});
test('Studio architecture generation rejects a foreign idea reference', () => {
  const res = invoke(setup(), 'POST', '/api/studio/architect/generate', {
    body: { workspace_id: 'workspace-a', idea_id: 'foreign-idea' }
  });
  assert.equal(res.status, 403);
});
test('Studio chapter generation rejects unauthorized body workspace', () => {
  const res = invoke(setup(), 'POST', '/api/studio/chapters/build', { body: { workspace_id: 'workspace-b' } });
  assert.equal(res.status, 403);
});
test('Studio bulk chapter generation rejects unauthorized body workspace', () => {
  const res = invoke(setup(), 'POST', '/api/studio/chapters/build-all', { body: { workspace_id: 'workspace-b' } });
  assert.equal(res.status, 403);
});
