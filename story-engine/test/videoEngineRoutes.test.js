import test from 'node:test';
import assert from 'node:assert/strict';

import { createRouter } from '../lib/miniRouter.js';
import videoEngineRoutes from '../routes/videoEngine.js';

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writableEnded: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = String(body);
      this.writableEnded = true;
    }
  };
}

test('workspace video-job route denies out-of-scope access without global middleware', () => {
  let databaseReads = 0;
  const db = {
    prepare() {
      databaseReads += 1;
      throw new Error('database must not be touched for denied workspace access');
    }
  };

  const router = createRouter();
  videoEngineRoutes(router, db);

  const req = {
    method: 'GET',
    url: '/api/workspaces/workspace-denied/video-jobs',
    headers: {},
    auth: {
      actor_id: 'scoped-test-actor',
      tenant_id: 'test-tenant',
      role: 'creator',
      workspace_ids: ['workspace-allowed']
    },
    request_id: 'route-local-guard-test'
  };
  const res = createResponse();

  router.handle(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(databaseReads, 0);
  assert.deepEqual(JSON.parse(res.body), {
    error: 'workspace_forbidden',
    workspace_id: 'workspace-denied',
    request_id: 'route-local-guard-test'
  });
});
