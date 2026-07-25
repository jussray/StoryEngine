import test from 'node:test';
import assert from 'node:assert/strict';

import missionControlRoutes from '../routes/missionControl.js';
import oodaRoutes from '../routes/ooda.js';
import performanceRoutes from '../routes/performance.js';
import learningRoutes from '../routes/learning.js';
import decisionRoutes from '../routes/decision.js';
import releaseGateRoutes from '../routes/releaseGate.js';

function captureRoutes(register) {
  const handlers = new Map();
  const router = {
    get(path, handler) { handlers.set(`GET ${path}`, handler); },
    post(path, handler) { handlers.set(`POST ${path}`, handler); },
    put(path, handler) { handlers.set(`PUT ${path}`, handler); },
    delete(path, handler) { handlers.set(`DELETE ${path}`, handler); }
  };
  const db = new Proxy({}, {
    get() {
      throw new Error('database operation executed before authorization');
    }
  });
  register(router, db);
  return handlers;
}

function mockRes() {
  return {
    writableEnded: false,
    status: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(value) {
      this.writableEnded = true;
      this.body = value ? JSON.parse(value) : null;
    },
    write() {
      throw new Error('stream opened before authorization');
    }
  };
}

function assertDenied(handlers, method, path, role = 'viewer') {
  const handler = handlers.get(`${method} ${path}`);
  assert.equal(typeof handler, 'function', `missing route ${method} ${path}`);
  const req = {
    method,
    auth: {
      actor_id: `actor-${role}`,
      tenant_id: 'tenant-a',
      role,
      workspace_ids: ['workspace-a']
    },
    params: {
      workspace_id: 'workspace-a',
      correlation_id: 'correlation-a'
    },
    query: {},
    body: {},
    on() {}
  };
  const res = mockRes();

  assert.doesNotThrow(() => handler(req, res));
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
}

test('viewer cannot read cross-workspace mission, queue, OODA, or performance state', () => {
  const mission = captureRoutes(missionControlRoutes);
  assertDenied(mission, 'GET', '/api/mission-control/snapshot');
  assertDenied(mission, 'GET', '/api/runtime/dispatch-queue');

  const ooda = captureRoutes(oodaRoutes);
  assertDenied(ooda, 'GET', '/api/ooda/snapshot');
  assertDenied(ooda, 'GET', '/api/ooda/timeline/:correlation_id');

  const performance = captureRoutes(performanceRoutes);
  assertDenied(performance, 'GET', '/api/performance/overview');
  assertDenied(performance, 'GET', '/api/performance/stream');

  const learning = captureRoutes(learningRoutes);
  assertDenied(learning, 'GET', '/api/ooda/learned-recoveries');
});

test('editor and reviewer cannot execute release-manager runtime operations', () => {
  const mission = captureRoutes(missionControlRoutes);
  assertDenied(mission, 'POST', '/api/runtime/dispatch/:workspace_id', 'editor');
  assertDenied(mission, 'POST', '/api/runtime/drain', 'reviewer');
  assertDenied(mission, 'POST', '/api/runtime/scan', 'reviewer');
  assertDenied(mission, 'POST', '/api/mission-control/retention/run', 'reviewer');

  const decision = captureRoutes(decisionRoutes);
  assertDenied(decision, 'POST', '/api/ooda/release-audit/:workspace_id', 'reviewer');

  const release = captureRoutes(releaseGateRoutes);
  assertDenied(release, 'POST', '/api/release/gate/:workspace_id/audit', 'reviewer');
  assertDenied(release, 'POST', '/api/release/authorize/:workspace_id', 'reviewer');
});

test('editor cannot persist an OODA decision that requires reviewer authority', () => {
  const decision = captureRoutes(decisionRoutes);
  assertDenied(decision, 'POST', '/api/ooda/decision/:workspace_id', 'editor');
});
