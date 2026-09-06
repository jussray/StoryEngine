// lib/pageGuard.js
// Closed-world creator/operator asset allowlist.
//
// Presentation clients are never product authority. Unknown HTML/JS paths fail
// closed. Creator/operator pages require an authenticated server-issued session;
// the first-run entry point and auth bootstrap clients remain reachable so a
// session can be established without an authentication deadlock.

import { resolveRequestIdentity, roleAtLeast } from './securityContext.js';

const CREATOR_PAGES = new Set([
  '/front_door.html',
  '/story_engine.html',
  '/story_home.html',
  '/story_universe.html',
  '/story_architect.html',
  '/chapter_builder.html',
  '/chapters.html',
  '/movie.html',
  '/creative_profile.html',
  '/studio.html',
  '/ip_studio.html',
  '/video_studio.html',
  '/l99_auth.js',
  '/intent_router.js',
  '/video_control_room.js'
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

const PUBLIC_BOOTSTRAP_PAGES = new Set([
  '/front_door.html',
  '/l99_auth.js',
  '/intent_router.js'
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

  if (PUBLIC_BOOTSTRAP_PAGES.has(pathname)) {
    next();
    return true;
  }

  let identity;
  try {
    identity = resolveRequestIdentity(req);
  } catch {
    res.writeHead(503);
    res.end('Authentication unavailable');
    return false;
  }

  if (!identity || identity.type !== 'session') {
    res.writeHead(401);
    res.end('Authentication required');
    return false;
  }

  if (OPERATOR_PAGES.has(page) && !roleAtLeast(identity, 'administrator')) {
    res.writeHead(403);
    res.end('Operator access required');
    return false;
  }

  if (CREATOR_PAGES.has(page) && !roleAtLeast(identity, 'creator')) {
    res.writeHead(403);
    res.end('Creator access required');
    return false;
  }

  next();
  return true;
}

export { CREATOR_PAGES, OPERATOR_PAGES, PUBLIC_BOOTSTRAP_PAGES };
