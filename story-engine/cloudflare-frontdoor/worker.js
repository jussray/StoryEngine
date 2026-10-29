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

// Every API request counts against its client IP. Session and bearer values are
// client-supplied, so a client could otherwise mint a fresh bucket per request
// by rotating them. The session or bearer bucket applies on top when present.
export async function clientIpKey(request) {
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim();
  return sha256(`ip:${ip || 'anonymous'}`);
}

async function enforceApiRateLimit(request, env) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api' && !pathname.startsWith(API_PREFIX)) return null;

  const limiter = env?.[RATE_LIMIT_BINDING];
  if (!limiter || typeof limiter.limit !== 'function') {
    return unavailable(503, 'StoryEngine API rate limiter is not configured for this deployment.', 'rate-limit-unavailable');
  }

  const ipKey = await clientIpKey(request);
  const subjectKey = await rateLimitKey(request);
  const keys = subjectKey === ipKey ? [ipKey] : [ipKey, subjectKey];

  try {
    for (const key of keys) {
      const { success } = await limiter.limit({ key });
      if (!success) {
        const response = unavailable(429, 'StoryEngine API rate limit exceeded.', 'rate-limited');
        response.headers.set('retry-after', '60');
        return response;
      }
    }
  } catch {
    return unavailable(503, 'StoryEngine API rate limiter is temporarily unavailable.', 'rate-limit-unavailable');
  }
  return null;
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
    // Set the path on the origin URL rather than concatenating strings. A path
    // starting with "//" would otherwise parse as a protocol-relative URL and send
    // the request, cookies and authorization included, to another host.
    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    if (target.origin !== origin) {
      return unavailable(400, 'StoryEngine request path is not valid.', 'invalid-path');
    }

    try {
      return await fetch(new Request(target, request));
    } catch {
      return unavailable(502, 'StoryEngine runtime is temporarily unavailable.');
    }
  }
};
