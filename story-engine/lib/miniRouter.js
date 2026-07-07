// lib/miniRouter.js — ~90-line express-like router
// Supports: get/post/put, :params, JSON body parsing

export function createRouter() {
  const routes = [];

  function addRoute(method, path, handler) {
    // Convert :param to named capture groups
    const pattern = path.replace(/:([a-zA-Z_]+)/g, '(?<$1>[^/]+)');
    routes.push({ method, regex: new RegExp(`^${pattern}$`), handler });
  }

  function handle(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      req.params = match.groups || {};
      req.query = Object.fromEntries(url.searchParams.entries());

      if (method === 'POST' || method === 'PUT') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          try { req.body = JSON.parse(body); } catch { req.body = {}; }
          route.handler(req, res);
        });
      } else {
        route.handler(req, res);
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  }

  return {
    get:    (p, h) => addRoute('GET', p, h),
    post:   (p, h) => addRoute('POST', p, h),
    put:    (p, h) => addRoute('PUT', p, h),
    delete: (p, h) => addRoute('DELETE', p, h),
    handle,
  };
}

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
