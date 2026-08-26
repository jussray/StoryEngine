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
    WRITE: {
      label: 'Write manuscript',
      description: 'Draft and revise in the Writing Room.',
      required_context: 'workspace_id'
    },
    RUN: {
      label: 'Control current AI run',
      description: 'Inspect and control the active Story Engine run.',
      required_context: 'run_id'
    },
    CANON: {
      label: 'Manage characters, world, and canon',
      description: 'Work with characters, relationships, lore, and continuity.',
      required_context: 'workspace_id'
    },
    ADAPT: {
      label: 'Adapt to video',
      description: 'Move the story into the Video Studio.',
      required_context: 'workspace_id'
    },
    RELEASE: {
      label: 'Inspect releases',
      description: 'Review release readiness and blockers.',
      required_context: 'workspace_id'
    },
    OPERATE: {
      label: 'Operate system',
      description: 'Open runtime, incidents, and system operations.',
      required_context: null
    }
  });

  function resolve(intent) {
    const key = String(intent || '').trim().toUpperCase();
    const destination = ROUTES[key];
    const metadata = INTENTS[key];
    if (!destination || !metadata) return null;
    return { intent: key, destination, ...metadata };
  }

  function sourceUrl(source = window.location.href) {
    return new URL(source, window.location.origin);
  }

  function isAvailable(intent, source = window.location.href) {
    const resolved = resolve(intent);
    if (!resolved) return false;
    if (!resolved.required_context) return true;
    return Boolean(sourceUrl(source).searchParams.get(resolved.required_context));
  }

  function preserveContext(destination, source = window.location.href) {
    const sourcePage = sourceUrl(source);
    const targetUrl = new URL(destination, window.location.origin);
    for (const key of ['workspace_id', 'run_id', 'story_id']) {
      const value = sourcePage.searchParams.get(key);
      if (value) targetUrl.searchParams.set(key, value);
    }
    return `${targetUrl.pathname}${targetUrl.search}`;
  }

  function route(intent, source = window.location.href) {
    const resolved = resolve(intent);
    if (!resolved || !isAvailable(intent, source)) return false;
    window.location.assign(preserveContext(resolved.destination, source));
    return true;
  }

  window.L99IntentRouter = Object.freeze({
    ROUTES,
    INTENTS,
    resolve,
    isAvailable,
    preserveContext,
    route
  });
})();
