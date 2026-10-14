import test from 'node:test';
import assert from 'node:assert/strict';
import learningRoutes from '../routes/learning.js';
import ipStudioRoutes from '../routes/ipStudio.js';
import missionControlRoutes from '../routes/missionControl.js';
import eventRetentionRoutes from '../routes/eventRetention.js';
import oodaRoutes, { requireOodaIncidentStreamAdmin } from '../routes/ooda.js';
import movieRoutes from '../routes/movie.js';
import bootstrapEngineRoutes from '../routes/bootstrapEngine.js';

function registerRoutes(install) {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set('GET ' + path, handler); },
    post(path, handler) { routes.set('POST ' + path, handler); },
    put(path, handler) { routes.set('PUT ' + path, handler); },
    delete(path, handler) { routes.set('DELETE ' + path, handler); }
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
const missionControl = registerRoutes(missionControlRoutes);
const eventRetention = registerRoutes(eventRetentionRoutes);
const ooda = registerRoutes(oodaRoutes);
const movie = registerRoutes(movieRoutes);
const bootstrapEngine = registerRoutes(bootstrapEngineRoutes);

const cases = [
  [learning, 'GET /api/ooda/episodes/:workspace_id'],
  [learning, 'POST /api/ooda/predict/:workspace_id'],
  [learning, 'GET /api/ooda/risk-history/:workspace_id'],
  [ipStudio, 'GET /api/ip-studio/:workspace_id/production-packs'],
  [ipStudio, 'POST /api/ip-studio/:workspace_id/production-pack'],
  [movie, 'GET /api/movie/beats/:workspace_id'],
  [movie, 'POST /api/movie/beats/generate/:workspace_id']
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
  [ipStudio, 'GET /api/ip-studio/overview'],
  [missionControl, 'GET /api/mission-control/snapshot'],
  [missionControl, 'GET /api/runtime/dispatch-queue'],
  [missionControl, 'POST /api/runtime/drain'],
  [missionControl, 'POST /api/runtime/scan'],
  [missionControl, 'POST /api/mission-control/retention/run'],
  [eventRetention, 'GET /api/events/retention/status'],
  [eventRetention, 'POST /api/events/retention/run'],
  [ooda, 'GET /api/ooda/snapshot'],
  [ooda, 'GET /api/ooda/timeline/:correlation_id'],
  [bootstrapEngine, 'GET /api/bootstrap-engine/providers'],
  [bootstrapEngine, 'GET /api/bootstrap-engine/overview']
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

test('live OODA incident stream denies creator before opening SSE', () => {
  const res = response();
  let opened = false;
  requireOodaIncidentStreamAdmin(
    { auth: { role: 'creator' }, request_id: 'ooda-stream-guard' },
    res,
    () => { opened = true; }
  );
  assert.equal(opened, false);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('live OODA incident stream allows an administrator to open SSE', () => {
  const res = response();
  let opened = false;
  requireOodaIncidentStreamAdmin(
    { auth: { role: 'administrator' }, request_id: 'ooda-stream-guard' },
    res,
    () => { opened = true; }
  );
  assert.equal(opened, true);
  assert.equal(res.status, null);
});
