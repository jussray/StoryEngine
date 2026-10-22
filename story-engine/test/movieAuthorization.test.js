import test from 'node:test';
import assert from 'node:assert/strict';
import movieRoutes from '../routes/movie.js';

function setup() {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set('GET ' + path, handler); },
    post(path, handler) { routes.set('POST ' + path, handler); },
    put(path, handler) { routes.set('PUT ' + path, handler); }
  };
  const db = {
    prepare() { throw new Error('Unauthorized request reached database'); },
    transaction() { throw new Error('Unauthorized request reached transaction'); }
  };
  movieRoutes(router, db);
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
function invoke(routes, method, path) {
  const res = response();
  routes.get(method + ' ' + path)({
    params: { workspace_id: 'foreign-workspace' }, body: {},
    request_id: 'movie-authorization-test',
    auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['allowed-workspace'] }
  }, res);
  return res;
}
test('movie beat listing denies foreign workspace before database read', () => {
  const res = invoke(setup(), 'GET', '/api/movie/beats/:workspace_id');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
});
test('movie beat generation denies foreign workspace before release side effects', () => {
  const res = invoke(setup(), 'POST', '/api/movie/beats/generate/:workspace_id');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
});
