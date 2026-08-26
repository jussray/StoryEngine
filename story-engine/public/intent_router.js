(() => {
  const ROUTES = Object.freeze({
    WRITE: '/chapters.html',
    RUN: '/story_engine.html',
    CANON: '/story_universe.html',
    ADAPT: '/video_studio.html',
    RELEASE: '/release_gate.html',
    OPERATE: '/control_room.html'
  });

  const INTENTS = Object.freeze({
    WRITE: { label: 'Write manuscript', description: 'Draft and revise in the Writing Room.' },
    RUN: { label: 'Control current AI run', description: 'Inspect and control the active Story Engine run.' },
    CANON: { label: 'Manage characters, world, and canon', description: 'Work with characters, relationships, lore, and continuity.' },
    ADAPT: { label: 'Adapt to video', description: 'Move the story into the Video Studio.' },
    RELEASE: { label: 'Inspect releases', description: 'Review release readiness and blockers.' },
    OPERATE: { label: 'Operate system', description: 'Open runtime, incidents, and system operations.' }
  });

  function resolve(intent) {
    const key = String(intent || '').trim().toUpperCase();
    const destination = ROUTES[key];
    if (!destination) return null;
    return { intent: key, destination, ...INTENTS[key] };
  }

  function preserveContext(destination, source = window.location.href) {
    const sourceUrl = new URL(source, window.location.origin);
    const targetUrl = new URL(destination, window.location.origin);
    for (const key of ['workspace_id', 'run_id', 'story_id']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) targetUrl.searchParams.set(key, value);
    }
    return `${targetUrl.pathname}${targetUrl.search}`;
  }

  function route(intent) {
    const resolved = resolve(intent);
    if (!resolved) return false;
    window.location.assign(preserveContext(resolved.destination));
    return true;
  }

  window.L99IntentRouter = Object.freeze({ ROUTES, INTENTS, resolve, preserveContext, route });
})();
