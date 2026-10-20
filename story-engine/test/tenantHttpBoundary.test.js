import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRouter } from '../lib/miniRouter.js';
import { requestContext, requireAuth, enforceWorkspaceAccess } from '../lib/securityContext.js';
import auditRoutes from '../routes/audit.js';
import bootstrapEngineRoutes from '../routes/bootstrapEngine.js';
import campaignStudioRoutes from '../routes/campaignStudio.js';
import ipGrowthRoutes from '../routes/ipGrowth.js';
import ipSeedRoutes from '../routes/ipSeed.js';
import movieRoutes from '../routes/movie.js';
import missionControlRoutes from '../routes/missionControl.js';
import oodaRoutes from '../routes/ooda.js';
import ipStudioRoutes from '../routes/ipStudio.js';
import learningRoutes from '../routes/learning.js';

function recordResponse() {
  return {
    writableEnded: false, statusCode: null, body: '', headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(data = '') {
      this.body += String(data);
      this.writableEnded = true;
    }
  };
}

function request(router, method, path, key, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = path;
  req.headers = key ? { 'x-api-key': key, 'content-type': 'application/json' } : {};
  req.resume = () => {};
  const res = recordResponse();
  router.handle(req, res);
  if (method === 'POST' || method === 'PUT') {
    if (body != null) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  }
  return res;
}

test('real HTTP middleware rejects cross-tenant writes and global metadata reads before database access', async () => {
  const original = process.env.L99_API_KEYS_JSON;
  process.env.L99_API_KEYS_JSON = JSON.stringify([{
    key: 'tenant-http-creator-a',
    actor_id: 'actor-a',
    tenant_id: 'tenant-a',
    role: 'creator',
    workspace_ids: ['workspace-a']
  }, {
    key: 'tenant-http-viewer-a',
    actor_id: 'viewer-a',
    tenant_id: 'tenant-a',
    role: 'viewer',
    workspace_ids: ['workspace-a']
  }]);
  try {
    const db = {
      prepare(sql) {
        // Allow only the authorization lookups needed to prove a viewer
        // with legitimate workspace membership still cannot enqueue work.
        if (sql.includes('FROM workspace_memberships')) {
          return {
            get(workspaceId, tenantId, actorId) {
              return workspaceId === 'workspace-a' && tenantId === 'tenant-a' && actorId === 'viewer-a'
                ? { allowed: 1 }
                : undefined;
            }
          };
        }
        if (sql.includes('SELECT tenant_id FROM stories')) {
          return {
            get(workspaceId) {
              return workspaceId === 'workspace-a' ? { tenant_id: 'tenant-a' } : undefined;
            }
          };
        }
        throw Error('DENIED REQUEST REACHED APPLICATION DATA');
      }
    };
    const router = createRouter();
    router.use('/api', requestContext);
    router.use('/api', (req, res, next) => { req.db = db; next(); });
    router.use('/api', requireAuth);
    router.use('/api', enforceWorkspaceAccess);
    auditRoutes(router, db);
    bootstrapEngineRoutes(router, db);
    campaignStudioRoutes(router, db);
    ipGrowthRoutes(router, db);
    ipSeedRoutes(router, db);
    movieRoutes(router, db);
    missionControlRoutes(router, db);
    oodaRoutes(router, db);
    ipStudioRoutes(router, db);
    learningRoutes(router, db);

    const denials = [
      ['GET', '/api/bootstrap-engine/providers'],
      ['GET', '/api/bootstrap-engine/overview'],
      ['GET', '/api/campaign-studio/overview'],
      ['GET', '/api/ip-growth/overview'],
      ['GET', '/api/ip-seeds'],
      ['GET', '/api/ip-seeds/overview'],
      ['GET', '/api/ooda/snapshot'],
      ['GET', '/api/ooda/timeline/other-tenant-correlation'],
      ['GET', '/api/movie/beats/workspace-b']
    ];
    for (const [method, path] of denials) {
      const res = request(router, method, path, 'tenant-http-creator-a');
      assert.equal(res.statusCode, 403, path);
      assert.equal(JSON.parse(res.body).error === 'forbidden' || JSON.parse(res.body).error === 'workspace_forbidden', true, path);
    }

    const blockedViewerDispatch = request(router, 'POST', '/api/runtime/dispatch/workspace-a', 'tenant-http-viewer-a', {
      trigger_type: 'manual_dispatch'
    });
    assert.equal(blockedViewerDispatch.statusCode, 403, 'viewer must not enqueue runtime work');
    assert.equal(JSON.parse(blockedViewerDispatch.body).error, 'forbidden');

    for (const [path, body] of [
      ['/api/audit/series-continuity', { workspace_id: 'workspace-a', manuscript: 'Viewer must not overwrite chapters.' }],
      ['/api/movie/beats/generate/workspace-a', {}],
      ['/api/ip-studio/workspace-a/production-pack', {}],
      ['/api/ooda/predict/workspace-a', {}]
    ]) {
      const denied = request(router, 'POST', path, 'tenant-http-viewer-a', body);
      await Promise.resolve();
      assert.equal(denied.statusCode, 403, path + ': viewer must not mutate an authorized workspace');
      assert.equal(JSON.parse(denied.body).error, 'forbidden', path);
    }

    const blockedAudit = request(router, 'POST', '/api/audit/series-continuity', 'tenant-http-creator-a', {
      workspace_id: 'workspace-b', manuscript: 'Foreign manuscript must never be written.'
    });
    assert.equal(blockedAudit.statusCode, 403);
    assert.equal(JSON.parse(blockedAudit.body).error, 'workspace_forbidden');

    const missingScope = request(router, 'POST', '/api/audit/series-continuity', 'tenant-http-creator-a', {
      manuscript: 'Missing workspace.'
    });
    assert.equal(missingScope.statusCode, 400);

    const catalog = request(router, 'GET', '/api/campaign-studio/options', 'tenant-http-creator-a');
    assert.equal(catalog.statusCode, 200);
    assert.ok(JSON.parse(catalog.body).platforms);

    const unauthenticated = request(router, 'GET', '/api/ip-seeds', null);
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    if (original === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = original;
  }
});
