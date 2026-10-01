// Cloudflare front door for StoryEngine. It never hosts the runtime: the
// deployment contract requires a stateful container with durable SQLite
// (deployment/runtime-contract.json), which a Worker cannot provide.
// It proxies to STORYENGINE_RUNTIME_ORIGIN or fails closed.

function unavailable(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-storyengine-edge': 'runtime-unavailable'
    }
  });
}

export function runtimeOrigin(env) {
  const raw = String(env?.STORYENGINE_RUNTIME_ORIGIN || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    return null;
  }

  const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'http:' && localhost) return parsed.origin;
  return null;
}

export default {
  async fetch(request, env) {
    const origin = runtimeOrigin(env);
    if (!origin) {
      return unavailable(503, 'StoryEngine runtime is not configured for this deployment.');
    }

    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, origin);

    try {
      return await fetch(new Request(target, request));
    } catch {
      return unavailable(502, 'StoryEngine runtime is temporarily unavailable.');
    }
  }
};
