// lib/miniRouter.js — lightweight express-like router
// Supports middleware, GET/POST/PUT/DELETE, :params, JSON parsing, and body limits.

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

  function addRoute(method, path, handler) {
    const pattern = path.replace(/:([a-zA-Z_]+)/g, '(?<$1>[^/]+)');
    routes.push({ method, regex: new RegExp(`^${pattern}$`), handler });
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

  function runMiddleware(req, res, pathname, done) {
    const stack = middleware.filter(item => matchesPrefix(pathname, item.prefix));
    let index = -1;

    const next = error => {
      if (error) {
        if (!res.writableEnded) json(res, 500, { error: 'middleware_error', message: error.message });
        return;
      }
      index += 1;
      const item = stack[index];
      if (!item) return done();
      try {
        const result = item.handler(req, res, next);
        if (result && typeof result.then === 'function') {
          result.catch(next);
        }
      } catch (caught) {
        next(caught);
      }
    };

    next();
  }

  function parseBody(req, res, route) {
    const declaredLength = Number(req.headers?.['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      json(res, 413, {
        error: 'body_too_large',
        max_bytes: maxBodyBytes
      });
      req.resume?.();
      return;
    }

    const chunks = [];
    let received = 0;
    let finished = false;

    const failTooLarge = () => {
      if (finished) return;
      finished = true;
      json(res, 413, {
        error: 'body_too_large',
        max_bytes: maxBodyBytes
      });
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
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        req.body = {};
      } else {
        try {
          req.body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: 'invalid_json' });
        }
      }
      route.handler(req, res);
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

    const route = routes.find(candidate => {
      if (candidate.method !== method) return false;
      return pathname.match(candidate.regex);
    });

    if (!route) return json(res, 404, { error: 'Not found' });

    const match = pathname.match(route.regex);
    req.params = match?.groups || {};
    req.query = Object.fromEntries(url.searchParams.entries());

    runMiddleware(req, res, pathname, () => {
      if (res.writableEnded) return;
      if (method === 'POST' || method === 'PUT') {
        parseBody(req, res, route);
      } else {
        route.handler(req, res);
      }
    });
  }

  return {
    use,
    get: (path, handler) => addRoute('GET', path, handler),
    post: (path, handler) => addRoute('POST', path, handler),
    put: (path, handler) => addRoute('PUT', path, handler),
    delete: (path, handler) => addRoute('DELETE', path, handler),
    handle
  };
}

export function json(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
