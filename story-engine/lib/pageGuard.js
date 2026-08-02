// lib/pageGuard.js
// Enforces the public creator shell and protected operator backstage split.
// Creator HTML/JS may load without credentials. Every data API remains behind
// the server's /api authentication boundary. Operator pages require an
// authenticated administrator. Unknown pages fail closed.

import { requireAuth, requireRole } from './securityContext.js';
import { json } from './miniRouter.js';

const CREATOR_PAGES = new Set([
  '/front_door.html',
  '/story_engine.html',
  '/story_home.html',
  '/story_architect.html',
  '/chapter_builder.html',
  '/chapters.html',
  '/creative_profile.html',
  '/studio.html',
  '/ip_studio.html',
  '/l99_auth.js'
]);

const OPERATOR_PAGES = new Set([
  '/control_room.html',
  '/mission_control.html',
  '/ooda_dashboard.html',
  '/decision_dashboard.html',
  '/lindymode_dashboard.html',
  '/performance_dashboard.html',
  '/runtime_dashboard.html',
  '/recovery_dashboard.html',
  '/release_gate.html',
  '/learning_dashboard.html',
  '/events_view.html',
  '/campaign_studio.html'
]);

function canonicalPage(pathname) {
  if (pathname.endsWith('.js')) {
    const htmlVersion = pathname.replace(/\.js$/, '.html');
    if (CREATOR_PAGES.has(htmlVersion) || OPERATOR_PAGES.has(htmlVersion)) return htmlVersion;
  }
  return pathname;
}

export function enforcePageAccess(pathname, req, res, next) {
  const page = canonicalPage(pathname);

  if (!CREATOR_PAGES.has(page) && !OPERATOR_PAGES.has(page)) {
    res.writeHead(404);
    res.end('Not found');
    return false;
  }

  if (CREATOR_PAGES.has(page)) {
    next();
    return true;
  }

  if (OPERATOR_PAGES.has(page)) {
    requireAuth(req, res, () => requireRole('administrator')(req, res, next));
    return true;
  }

  json(res, 403, { error: 'forbidden' });
  return false;
}

export { CREATOR_PAGES, OPERATOR_PAGES };
