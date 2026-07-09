// lib/pageGuard.js
// Enforces the front/back stage split for static HTML pages.
// Creator-facing pages are public (after auth). Operator pages require administrator role.
// Any page not in either list is denied by default (closed-world policy).

import { requireAuth, requireRole } from './securityContext.js';
import { json } from './miniRouter.js';

// Pages any authenticated user (creator or above) can access.
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

// Pages only the operator (administrator role) can access.
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

// JS companion files inherit the same access level as their HTML counterpart.
function canonicalPage(pathname) {
  if (pathname.endsWith('.js')) {
    const htmlVersion = pathname.replace(/\.js$/, '.html');
    if (CREATOR_PAGES.has(htmlVersion) || OPERATOR_PAGES.has(htmlVersion)) return htmlVersion;
  }
  return pathname;
}

/**
 * Middleware that enforces page-level access control.
 * Call this before serveStatic for HTML/JS requests.
 *
 * Returns true if the request may proceed.
 * Returns false and has already written a response if access is denied.
 */
export function enforcePageAccess(pathname, req, res, next) {
  const page = canonicalPage(pathname);

  // Static assets that aren't gated pages pass through.
  if (!CREATOR_PAGES.has(page) && !OPERATOR_PAGES.has(page)) {
    // Closed-world: deny unknown pages.
    res.writeHead(404);
    res.end('Not found');
    return false;
  }

  if (CREATOR_PAGES.has(page)) {
    // Any authenticated user may access creator pages.
    requireAuth(req, res, next);
    return true;
  }

  if (OPERATOR_PAGES.has(page)) {
    // Only administrators may access operator pages.
    requireAuth(req, res, () => requireRole('administrator')(req, res, next));
    return true;
  }

  json(res, 403, { error: 'forbidden' });
  return false;
}

export { CREATOR_PAGES, OPERATOR_PAGES };
