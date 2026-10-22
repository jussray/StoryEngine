import test from 'node:test';
import { enforceOperatorApiBoundary } from '../lib/securityContext.js';
import assert from 'node:assert/strict';
import learningRoutes from '../routes/learning.js';
import ipStudioRoutes from '../routes/ipStudio.js';
import missionControlRoutes from '../routes/missionControl.js';
import eventRetentionRoutes from '../routes/eventRetention.js';
import oodaRoutes, { requireOodaIncidentStreamAdmin } from '../routes/ooda.js';
import movieRoutes from '../routes/movie.js';
import bootstrapEngineRoutes from '../routes/bootstrapEngine.js';
import auditRoutes from '../routes/audit.js';
import campaignStudioRoutes from '../routes/campaignStudio.js';
import ipGrowthRoutes from '../routes/ipGrowth.js';
import ipSeedRoutes from '../routes/ipSeed.js';

function registerRoutes(install) {
  const routes = new Map();
  const chain = handlers => (req, res) => {
    let index = 0;
    const next = () => handlers[index++]?.(req, res, next);
    return next();
  };
  const router = {
    get(path, ...handlers) { routes.set('GET ' + path, chain(handlers)); },
    post(path, ...handlers) { routes.set('POST ' + path, chain(handlers)); },
    put(path, ...handlers) { routes.set('PUT ' + path, chain(handlers)); },
    delete(path, ...handlers) { routes.set('DELETE ' + path, chain(handlers)); }
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
const continuityAudit = registerRoutes(auditRoutes);
const campaignStudio = registerRoutes(campaignStudioRoutes);
const ipGrowth = registerRoutes(ipGrowthRoutes);
const ipSeeds = registerRoutes(ipSeedRoutes);

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
  [bootstrapEngine, 'GET /api/bootstrap-engine/overview'],
  [campaignStudio, 'GET /api/campaign-studio/overview'],
  [ipGrowth, 'GET /api/ip-growth/overview'],
  [ipSeeds, 'GET /api/ip-seeds/overview'],
  [ipSeeds, 'GET /api/ip-seeds']
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
  [bootstrapEngine, 'PUT /api/bootstrap-engine/providers/:category'],
  [bootstrapEngine, 'GET /api/bootstrap-engine/overview'],
  [campaignStudio, 'GET /api/campaign-studio/overview'],
  [ipGrowth, 'GET /api/ip-growth/overview'],
  [ipSeeds, 'GET /api/ip-seeds/overview'],
  [ipSeeds, 'GET /api/ip-seeds']
]) {
  test(endpoint + ' rejects a workspace-limited administrator before data access', () => {
    const handler = routes.get(endpoint);
    assert.equal(typeof handler, 'function');
    const res = response();
    handler({
      auth: { role: 'administrator', workspace_ids: ['workspace-a'] },
      query: {}, body: {}, params: {}, request_id: 'scoped-admin-deny'
    }, res);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'global_workspace_forbidden');
  });
}

test('global control-room operator boundary denies a scoped administrator', () => {
  const res = response();
  let allowed = false;
  enforceOperatorApiBoundary({
    url: '/api/control-room/operator',
    method: 'GET',
    auth: { role: 'administrator', workspace_ids: ['workspace-a'] }
  }, res, () => { allowed = true; });
  assert.equal(allowed, false);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'global_workspace_forbidden');
});

test('live OODA incident stream denies a scoped administrator before opening SSE', () => {
  const res = response();
  let opened = false;
  requireOodaIncidentStreamAdmin(
    { auth: { role: 'administrator', workspace_ids: ['workspace-a'] }, request_id: 'ooda-stream-guard' },
    res, () => { opened = true; }
  );
  assert.equal(opened, false);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'global_workspace_forbidden');
});

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
    { auth: { role: 'administrator', workspace_ids: ['*'] }, request_id: 'ooda-stream-guard' },
    res,
    () => { opened = true; }
  );
  assert.equal(opened, true);
  assert.equal(res.status, null);
});

test('series continuity audit rejects foreign body workspace before writes', () => {
  const handler = continuityAudit.get('POST /api/audit/series-continuity');
  assert.equal(typeof handler, 'function');
  const res = response();
  handler({
    params: {}, query: {}, body: { workspace_id: 'workspace_other', manuscript: 'private input' },
    request_id: 'audit-tenant-guard',
    auth: { actor_id: 'actor-a', tenant_id: 'tenant-a', role: 'creator', workspace_ids: ['workspace_allowed'] }
  }, res);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
});

test('series continuity audit rejects missing body workspace without writes', () => {
  const handler = continuityAudit.get('POST /api/audit/series-continuity');
  const res = response();
  handler({ params: {}, query: {}, body: { manuscript: 'text' }, auth: { role: 'creator' } }, res);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'workspace_id is required.');
});
