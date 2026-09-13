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

function runtimeOrigin() {
  const raw = String(process.env.STORYENGINE_RUNTIME_ORIGIN || '').trim();
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
  if (process.env.VERCEL_ENV === 'production' && parsed.protocol !== 'https:' && !localhost) {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.origin;
}

export default async function middleware(request) {
  const origin = runtimeOrigin();
  if (!origin) {
    return unavailable(503, 'StoryEngine runtime is not configured for this deployment.');
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);

  try {
    const upstream = new Request(target, request);
    return await fetch(upstream);
  } catch {
    return unavailable(502, 'StoryEngine runtime is temporarily unavailable.');
  }
}

export const config = {
  matcher: '/:path*'
};
