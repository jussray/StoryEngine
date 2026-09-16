// lib/securityContext.js

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { json } from './miniRouter.js';

const ROLE_ORDER = Object.freeze({ viewer: 10, creator: 20, editor: 30, reviewer: 40, release_manager: 50, administrator: 60 });
const PRINCIPAL_TYPES = new Set(['human', 'agent', 'service', 'system', 'unknown']);
const SESSION_COOKIE_NAME = 'l99_session';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_CONTROL_ROOM_ENDPOINTS = new Set([
  'GET /api/control-room/operator',
  'GET /api/control-room/operator/options',
  'POST /api/control-room/operator/evaluate-cost',
  'GET /api/control-room/operator/alerts',
  'GET /api/control-room/founder',
  'GET /api/control-room/founder/options',
  'POST /api/control-room/founder/evaluate-cost',
  'GET /api/control-room/founder/alerts'
]);

let registryCache = null;
let registryCacheSource = null;
const sessions = new Map();
const canonAuthorityGrants = new WeakSet();
const canonAuthorityGrantSessions = new WeakMap();
const consumedCanonAuthorityGrants = new WeakSet();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function credentialFingerprint(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizePrincipalType(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return PRINCIPAL_TYPES.has(normalized) ? normalized : 'unknown';
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
      principal_type: normalizePrincipalType(item.principal_type),
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
    principal_type: 'unknown',
    workspace_ids: ['*']
  };
}

function resolveExplicitIdentity(key) {
  const registry = keyRegistry();
  for (const item of registry) {
    if (safeEqual(key, item.key)) {
      return {
        type: 'scoped_api_key',
        ...item,
        key: undefined,
        credential_fingerprint: credentialFingerprint(key)
      };
    }
  }
  return legacyIdentity(key);
}

function sessionTtlMs() {
  const configured = Number(process.env.L99_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS);
  if (!Number.isFinite(configured) || configured < 60_000) return DEFAULT_SESSION_TTL_MS;
  return Math.min(Math.floor(configured), MAX_SESSION_TTL_MS);
}

function sameWorkspaceSet(left = [], right = []) {
  const a = [...left].map(String).sort();
  const b = [...right].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function scopedCredentialStillAuthorizes(session) {
  if (session.credential_type !== 'scoped_api_key') return true;
  if (!session.credential_fingerprint) return false;

  const current = keyRegistry().find(item => credentialFingerprint(item.key) === session.credential_fingerprint);
  if (!current) return false;
  return current.actor_id === session.actor_id
    && current.tenant_id === session.tenant_id
    && current.role === session.role
    && current.principal_type === session.principal_type
    && sameWorkspaceSet(current.workspace_ids, session.workspace_ids);
}

function resolveSessionIdentity(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires_at <= Date.now() || !scopedCredentialStillAuthorizes(session)) {
    sessions.delete(token);
    return null;
  }
  return {
    type: 'session',
    actor_id: session.actor_id,
    tenant_id: session.tenant_id,
    role: session.role,
    principal_type: session.principal_type,
    workspace_ids: [...session.workspace_ids],
    session_id: session.session_id,
    expires_at: session.expires_at,
    credential_type: session.credential_type
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
    principal_type: normalizePrincipalType(identity.principal_type),
    workspace_ids: Array.isArray(identity.workspace_ids) ? identity.workspace_ids.map(String) : [],
    credential_type: String(identity.type || 'unknown'),
    credential_fingerprint: identity.credential_fingerprint ? String(identity.credential_fingerprint) : null,
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

export function requireHumanAuthority(req, res) {
  const humanSession = req.auth?.type === 'session' && req.auth?.principal_type === 'human';
  if (humanSession) return true;
  json(res, 403, {
    error: 'human_authority_required',
    auth_type: req.auth?.type || null,
    principal_type: req.auth?.principal_type || 'unknown',
    request_id: req.request_id || null
  });
  return false;
}

export function issueCanonAuthorityGrant(req, workspaceId) {
  const normalizedWorkspace = String(workspaceId || '').trim();
  if (!normalizedWorkspace) throw new Error('workspace_id is required for canon authority.');

  const token = requestSessionToken(req);
  const identity = resolveSessionIdentity(token);
  if (!identity || identity.type !== 'session' || identity.principal_type !== 'human') {
    throw new Error('Canon authority requires a live authenticated human session.');
  }
  if (identity.credential_type !== 'scoped_api_key') {
    throw new Error('Canon authority requires a session backed by a live scoped credential.');
  }
  if (req.auth?.session_id !== identity.session_id || req.auth?.actor_id !== identity.actor_id) {
    throw new Error('Canon authority session does not match the authenticated request.');
  }
  if (!roleAtLeast(identity, 'creator')) {
    throw new Error('Canon authority requires creator-or-higher role.');
  }
  const allowed = identity.workspace_ids || [];
  if (!allowed.includes('*') && !allowed.includes(normalizedWorkspace)) {
    throw new Error('Canon authority session does not allow this workspace.');
  }

  const grant = Object.freeze({
    grant_id: `canon_grant_${randomUUID()}`,
    workspace_id: normalizedWorkspace,
    actor_id: identity.actor_id,
    session_id: identity.session_id,
    request_id: String(req.request_id || '')
  });
  canonAuthorityGrants.add(grant);
  canonAuthorityGrantSessions.set(grant, { token, session_id: identity.session_id });
  return grant;
}

export function assertCanonAuthorityGrant(grant, workspaceId) {
  const normalizedWorkspace = String(workspaceId || '').trim();
  if (!grant || typeof grant !== 'object' || !canonAuthorityGrants.has(grant)) {
    throw new Error('Canon mutation requires independently verified human session authority.');
  }
  if (consumedCanonAuthorityGrants.has(grant)) {
    throw new Error('Canon authority grant has already been consumed.');
  }
  if (grant.workspace_id !== normalizedWorkspace) {
    throw new Error('Canon authority grant workspace does not match the mutation.');
  }

  const origin = canonAuthorityGrantSessions.get(grant);
  const identity = resolveSessionIdentity(origin?.token || '');
  if (!origin || !identity || identity.type !== 'session' || identity.principal_type !== 'human') {
    throw new Error('Canon authority grant is no longer backed by a live authenticated human session.');
  }
  if (identity.credential_type !== 'scoped_api_key') {
    throw new Error('Canon authority grant is no longer backed by a live scoped credential.');
  }
  if (identity.session_id !== origin.session_id || identity.session_id !== grant.session_id || identity.actor_id !== grant.actor_id) {
    throw new Error('Canon authority grant no longer matches its originating session and actor.');
  }
  if (!roleAtLeast(identity, 'creator')) {
    throw new Error('Canon authority grant no longer has creator-or-higher role.');
  }
  const allowed = identity.workspace_ids || [];
  if (!allowed.includes('*') && !allowed.includes(normalizedWorkspace)) {
    throw new Error('Canon authority grant no longer allows this workspace.');
  }

  consumedCanonAuthorityGrants.add(grant);
  return grant;
}

export function enforceOperatorApiBoundary(req, res, next) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const key = `${String(req.method || 'GET').toUpperCase()} ${pathname}`;
  if (!ADMIN_CONTROL_ROOM_ENDPOINTS.has(key)) return next();
  return requireRole('administrator')(req, res, next);
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
    principal_type: req.auth?.principal_type || 'unknown',
    auth_type: req.auth?.type || null,
    session_id: req.auth?.session_id || null,
    expires_at: req.auth?.expires_at || null,
    request_id: req.request_id || null
  };
}

export function securitySnapshot() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires_at <= now || !scopedCredentialStillAuthorizes(session)) sessions.delete(token);
  }
  return {
    scoped_key_count: keyRegistry().length,
    legacy_api_key_enabled: Boolean(process.env.API_KEY) && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_API_KEY === 'true'),
    registry_cached: Boolean(registryCache),
    registry_loaded_at_runtime: true,
    principal_classification_required_for_human_authority: true,
    cookie_credentials_enabled: true,
    cookie_name: SESSION_COOKIE_NAME,
    active_session_count: sessions.size,
    session_store: 'process_memory',
    session_recovery_supported: false
  };
}
