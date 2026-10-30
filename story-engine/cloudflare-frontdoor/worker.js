// Cloudflare front door for StoryEngine. It never hosts the runtime: the
// deployment contract requires a stateful container with durable SQLite
// (deployment/runtime-contract.json), which a Worker cannot provide.
// It proxies to STORYENGINE_RUNTIME_ORIGIN or fails closed.

const API_PREFIX = '/api/';
const SESSION_COOKIE = 'l99_session';
const RATE_LIMIT_BINDING = 'STORYENGINE_API_RATE_LIMITER';

function unavailable(status, message, edge = 'runtime-unavailable') {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-storyengine-edge': edge
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

function sessionToken(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE && rest.length) return rest.join('=').trim();
  }
  return '';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function rateLimitKey(request) {
  const authorization = String(request.headers.get('authorization') || '').trim();
  const session = sessionToken(request);
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim();
  const material = authorization
    ? `authorization:${authorization}`
    : session
      ? `session:${session}`
      : `ip:${ip || 'anonymous'}`;
  return sha256(material);
}

async function enforceApiRateLimit(request, env) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api' && !pathname.startsWith(API_PREFIX)) return null;

  const limiter = env?.[RATE_LIMIT_BINDING];
  if (!limiter || typeof limiter.limit !== 'function') {
    return unavailable(503, 'StoryEngine API rate limiter is not configured for this deployment.', 'rate-limit-unavailable');
  }

  const key = await rateLimitKey(request);
  const { success } = await limiter.limit({ key });
  if (success) return null;

  const response = unavailable(429, 'StoryEngine API rate limit exceeded.', 'rate-limited');
  response.headers.set('retry-after', '60');
  return response;
}

export default {
  async fetch(request, env) {
    const origin = runtimeOrigin(env);
    if (!origin) {
      return unavailable(503, 'StoryEngine runtime is not configured for this deployment.');
    }

    const limited = await enforceApiRateLimit(request, env);
    if (limited) return limited;

    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, origin);

    try {
      return await fetch(new Request(target, request));
    } catch {
      return unavailable(502, 'StoryEngine runtime is temporarily unavailable.');
    }
  }
};
