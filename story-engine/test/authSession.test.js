import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRouter } from '../lib/miniRouter.js';
import { requestContext, requireAuth } from '../lib/securityContext.js';
import authSessionRoutes from '../routes/authSession.js';

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(chunk = '') {
      this.body += String(chunk);
      this.writableEnded = true;
    }
  };
}

function request(method, url, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.resume = () => {};
  return req;
}

function dispatch(router, method, url, headers = {}, body = null) {
  const req = request(method, url, headers);
  const res = responseRecorder();
  router.handle(req, res);
  if (method === 'POST' || method === 'PUT') {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  }
  return { req, res };
}

test('session route mints opaque cookie, authenticates it, and logout revokes it', () => {
  const prior = process.env.L99_API_KEYS_JSON;
  process.env.L99_API_KEYS_JSON = JSON.stringify([{
    key: 'session-bootstrap-secret',
    actor_id: 'creator-a',
    tenant_id: 'tenant-a',
    role: 'creator',
    workspace_ids: ['workspace-a']
  }]);

  try {
    const router = createRouter({ maxBodyBytes: 4096 });
    router.use('/api', requestContext);
    router.use('/api', requireAuth);
    authSessionRoutes(router);

    const minted = dispatch(
      router,
      'POST',
      '/api/auth/session',
      { 'x-api-key': 'session-bootstrap-secret', 'content-type': 'application/json' },
      {}
    ).res;

    assert.equal(minted.statusCode, 201);
    const cookie = minted.headers['set-cookie'];
    assert.match(cookie, /^l99_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(!cookie.includes('session-bootstrap-secret'));
    const mintBody = JSON.parse(minted.body);
    assert.equal(mintBody.session.actor_id, 'creator-a');
    assert.equal(mintBody.session.role, 'creator');

    const me = dispatch(router, 'GET', '/api/auth/me', { cookie }).res;
    assert.equal(me.statusCode, 200);
    const meBody = JSON.parse(me.body);
    assert.equal(meBody.session.auth_type, 'session');
    assert.equal(meBody.session.actor_id, 'creator-a');

    const logout = dispatch(
      router,
      'POST',
      '/api/auth/logout',
      { cookie, 'content-type': 'application/json' },
      {}
    ).res;
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers['set-cookie'], /Max-Age=0/);

    const after = dispatch(router, 'GET', '/api/auth/me', { cookie }).res;
    assert.equal(after.statusCode, 401);
    assert.equal(JSON.parse(after.body).error, 'unauthorized');
  } finally {
    if (prior === undefined) delete process.env.L99_API_KEYS_JSON;
    else process.env.L99_API_KEYS_JSON = prior;
  }
});
