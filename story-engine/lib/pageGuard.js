// lib/pageGuard.js
// Closed-world static-page allowlist.
//
// Known creator and operator HTML/JS files are public shells. They contain no
// authoritative workspace data and cannot perform protected actions by
// themselves. Every runtime read and mutation remains behind the authenticated
// /api boundary, where role and workspace checks are enforced. Unknown static
// HTML/JS paths fail closed.

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
  '/video_studio.html',
  '/l99_auth.js',
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

  next();
  return true;
}

export { CREATOR_PAGES, OPERATOR_PAGES };
