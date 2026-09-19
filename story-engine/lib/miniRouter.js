// lib/miniRouter.js — lightweight express-like router
// Supports middleware, route handler chains, GET/POST/PUT/DELETE, :params, JSON/CSV parsing, and body limits.

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

function normalizeLimit(value) {
  const parsed = Number(value ?? DEFAULT_MAX_BODY_BYTES);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_BODY_BYTES;
  return Math.floor(parsed);
}

function matchesPrefix(pathname, prefix) {
  if (prefix === '/') return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function createRouter(options = {}) {
  const routes = [];
  const middleware = [];
  const maxBodyBytes = normalizeLimit(options.maxBodyBytes);

  function addRoute(method, path, ...handlers) {
    if (!handlers.length || handlers.some(handler => typeof handler !== 'function')) {
      throw new TypeError('route handlers must be functions.');
    }
    const pattern = path.replace(/:([a-zA-Z_]+)/g, '(?<$1>[^/]+)');
    routes.push({ method, regex: new RegExp(`^${pattern}$`), handlers });
  }

  function use(prefix, handler) {
    if (typeof prefix === 'function') {
      middleware.push({ prefix: '/', handler: prefix });
      return;
    }
    if (typeof prefix !== 'string' || typeof handler !== 'function') {
      throw new TypeError('router.use(prefix, middleware) requires a path and function.');
    }
    middleware.push({ prefix, handler });
  }

  function runStack(stack, req, res, done) {
    let index = -1;
    const next = error => {
      if (error) {
        if (!res.writableEnded) json(res, 500, { error: 'middleware_error', message: error.message });
        return;
      }
      index += 1;
      const handler = stack[index];
      if (!handler) return done?.();
      try {
        const result = handler(req, res, next);
        if (result && typeof result.then === 'function') result.catch(next);
      } catch (caught) {
        next(caught);
      }
    };
    next();
  }

  function runMiddleware(req, res, pathname, done) {
    const stack = middleware
      .filter(item => matchesPrefix(pathname, item.prefix))
      .map(item => item.handler);
    runStack(stack, req, res, done);
  }

  function runRoute(req, res, route) {
    runStack(route.handlers, req, res);
  }

  function parseBody(req, res, route) {
    const declaredLength = Number(req.headers?.['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      json(res, 413, { error: 'body_too_large', max_bytes: maxBodyBytes });
      req.resume?.();
      return;
    }

    const chunks = [];
    let received = 0;
    let finished = false;

    const failTooLarge = () => {
      if (finished) return;
      finished = true;
      json(res, 413, { error: 'body_too_large', max_bytes: maxBodyBytes });
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.resume?.();
    };

    const onData = chunk => {
      if (finished) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBodyBytes) return failTooLarge();
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      const rawBuffer = Buffer.concat(chunks);
      const raw = rawBuffer.toString('utf8');
      req.rawBody = rawBuffer;
      const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();

      if (!raw.trim()) {
        req.body = {};
      } else if (contentType === 'text/csv' || contentType === 'text/plain') {
        req.body = raw;
      } else {
        try {
          req.body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: 'invalid_json' });
        }
      }
      runRoute(req, res, route);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', error => {
      if (!finished && !res.writableEnded) {
        finished = true;
        json(res, 400, { error: 'request_stream_error', message: error.message });
      }
    });
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    const route = routes.find(candidate => candidate.method === method && pathname.match(candidate.regex));
    if (!route) return json(res, 404, { error: 'Not found' });

    const match = pathname.match(route.regex);
    req.params = match?.groups || {};
    req.query = Object.fromEntries(url.searchParams.entries());

    runMiddleware(req, res, pathname, () => {
      if (res.writableEnded) return;
      if (method === 'POST' || method === 'PUT') parseBody(req, res, route);
      else runRoute(req, res, route);
    });
  }

  return {
    use,
    get: (path, ...handlers) => addRoute('GET', path, ...handlers),
    post: (path, ...handlers) => addRoute('POST', path, ...handlers),
    put: (path, ...handlers) => addRoute('PUT', path, ...handlers),
    delete: (path, ...handlers) => addRoute('DELETE', path, ...handlers),
    handle
  };
}

export function json(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
