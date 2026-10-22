import test from 'node:test';
import assert from 'node:assert/strict';
import movieRoutes from '../routes/movie.js';

function setup() {
  const routes = new Map();
  const router = {
    get(path, ...handlers) { routes.set('GET ' + path, handlers); },
    post(path, ...handlers) { routes.set('POST ' + path, handlers); },
    put(path, ...handlers) { routes.set('PUT ' + path, handlers); }
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
  const handlers = routes.get(method + ' ' + path);
  assert.ok(handlers?.length, 'Expected a registered route');
  const req = {
    params: { workspace_id: 'foreign-workspace' }, body: {},
    request_id: 'movie-authorization-test',
    auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['allowed-workspace'] }
  };
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    if (handler) handler(req, res, next);
  };
  next();
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
