// lib/securityContext.js

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { json } from './miniRouter.js';

const ROLE_ORDER = Object.freeze({ viewer: 10, creator: 20, editor: 30, reviewer: 40, release_manager: 50, administrator: 60 });
const SESSION_COOKIE_NAME = 'l99_session';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let registryCache = null;
let registryCacheSource = null;
const sessions = new Map();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseKeyRegistry(raw = String(process.env.L99_API_KEYS_JSON || '').trim()) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('L99_API_KEYS_JSON must be a JSON array.');
    return parsed.map(item => ({
      key: String(item.key || '').trim(),
      actor_id: String(item.actor_id || item.user_id || '').trim(),
      tenant_id: String(item.tenant_id || '').trim(),
      role: String(item.role || 'viewer').trim(),
      workspace_ids: Array.isArray(item.workspace_ids) ? item.workspace_ids.map(String) : ['*']
    })).filter(item => item.key && item.actor_id && item.tenant_id && ROLE_ORDER[item.role]);
  } catch (error) {
    throw new Error(`Invalid L99_API_KEYS_JSON: ${error.message}`);
  }
}

function keyRegistry() {
  const raw = String(process.env.L99_API_KEYS_JSON || '').trim();
  if (registryCache && registryCacheSource === raw) return registryCache;
  registryCache = parseKeyRegistry(raw);
  registryCacheSource = raw;
  return registryCache;
}

function explicitCredential(req) {
  const direct = req.headers?.['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function parseCookies(raw = '') {
  const cookies = {};
  for (const part of String(raw || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
  }
  return cookies;
}

export function requestSessionToken(req) {
  return parseCookies(req.headers?.cookie || '')[SESSION_COOKIE_NAME] || '';
}

function legacyIdentity(key) {
  const configured = String(process.env.API_KEY || '').trim();
  const allowLegacy = process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_API_KEY === 'true';
  if (!allowLegacy || !configured || !safeEqual(key, configured)) return null;
  return {
    type: 'legacy_api_key',
    actor_id: 'legacy-founder',
    tenant_id: 'founder',
    role: 'administrator',
    workspace_ids: ['*']
  };
}

function resolveExplicitIdentity(key) {
  const registry = keyRegistry();
  for (const item of registry) {
    if (safeEqual(key, item.key)) return { type: 'scoped_api_key', ...item, key: undefined };
  }
  return legacyIdentity(key);
}

function sessionTtlMs() {
  const configured = Number(process.env.L99_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS);
  if (!Number.isFinite(configured) || configured < 60_000) return DEFAULT_SESSION_TTL_MS;
  return Math.min(Math.floor(configured), MAX_SESSION_TTL_MS);
}

function resolveSessionIdentity(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return {
    type: 'session',
    actor_id: session.actor_id,
    tenant_id: session.tenant_id,
    role: session.role,
    workspace_ids: [...session.workspace_ids],
    session_id: session.session_id,
    expires_at: session.expires_at
  };
}

export function resolveRequestIdentity(req) {
  const explicit = explicitCredential(req);
  if (explicit) return resolveExplicitIdentity(explicit);
  return resolveSessionIdentity(requestSessionToken(req));
}

export function roleAtLeast(identity, role) {
  return (ROLE_ORDER[identity?.role] || 0) >= (ROLE_ORDER[role] || Infinity);
}

export function issueSession(identity) {
  if (!identity?.actor_id || !identity?.tenant_id || !ROLE_ORDER[identity?.role]) {
    throw new Error('Cannot issue a session without a valid authenticated identity.');
  }
  const token = randomBytes(32).toString('base64url');
  const ttlMs = sessionTtlMs();
  const record = {
    session_id: `session_${randomUUID()}`,
    actor_id: String(identity.actor_id),
    tenant_id: String(identity.tenant_id),
    role: String(identity.role),
    workspace_ids: Array.isArray(identity.workspace_ids) ? identity.workspace_ids.map(String) : [],
    created_at: Date.now(),
    expires_at: Date.now() + ttlMs
  };
  sessions.set(token, record);
  return { token, ...record, max_age_seconds: Math.floor(ttlMs / 1000) };
}

export function revokeSession(token) {
  if (!token) return false;
  return sessions.delete(token);
}

export function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function requestContext(req, res, next) {
  const requestId = String(req.headers?.['x-request-id'] || randomUUID());
  req.request_id = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src 'self' https://fonts.gstatic.com https://cdn.fontshare.com; script-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:; connect-src 'self'");
  return next();
}

export function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  let identity;
  try {
    identity = resolveRequestIdentity(req);
  } catch (error) {
    return json(res, 503, { error: 'auth_registry_invalid', message: error.message, request_id: req.request_id });
  }
  if (!identity) return json(res, 401, { error: 'unauthorized', request_id: req.request_id });

  req.auth = identity;
  return next();
}

export function requireRole(...allowedRoles) {
  const minimum = Math.min(...allowedRoles.map(role => ROLE_ORDER[role] || Infinity));
  return (req, res, next) => {
    const score = ROLE_ORDER[req.auth?.role] || 0;
    if (score < minimum) {
      return json(res, 403, { error: 'forbidden', required_roles: allowedRoles, actor_role: req.auth?.role || null, request_id: req.request_id });
    }
    return next();
  };
}

export function assertWorkspaceAccess(req, workspaceId) {
  const normalized = String(workspaceId || '').trim();
  if (!normalized) return true;
  const allowed = req.auth?.workspace_ids || [];
  return allowed.includes('*') || allowed.includes(normalized);
}

export function requireWorkspaceAccess(req, res, workspaceId) {
  const normalized = String(workspaceId || '').trim();
  if (!normalized) return true;
  if (assertWorkspaceAccess(req, normalized)) return true;
  json(res, 403, { error: 'workspace_forbidden', workspace_id: normalized, request_id: req.request_id });
  return false;
}

export function enforceWorkspaceAccess(req, res, next) {
  const workspaceId = req.params?.workspace_id || req.query?.workspace_id || null;
  if (!workspaceId) return next();
  if (requireWorkspaceAccess(req, res, workspaceId)) return next();
}

export function authSnapshot(req) {
  return {
    actor_id: req.auth?.actor_id || null,
    tenant_id: req.auth?.tenant_id || null,
    role: req.auth?.role || null,
    auth_type: req.auth?.type || null,
    session_id: req.auth?.session_id || null,
    expires_at: req.auth?.expires_at || null,
    request_id: req.request_id || null
  };
}

export function securitySnapshot() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires_at <= now) sessions.delete(token);
  }
  return {
    scoped_key_count: keyRegistry().length,
    legacy_api_key_enabled: Boolean(process.env.API_KEY) && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_API_KEY === 'true'),
    registry_cached: Boolean(registryCache),
    registry_loaded_at_runtime: true,
    cookie_credentials_enabled: true,
    cookie_name: SESSION_COOKIE_NAME,
    active_session_count: sessions.size,
    session_store: 'process_memory',
    session_recovery_supported: false
  };
}
