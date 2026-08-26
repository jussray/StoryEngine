import { json } from '../lib/miniRouter.js';
import {
  authSnapshot,
  clearSessionCookie,
  issueSession,
  requestSessionToken,
  revokeSession,
  sessionCookie
} from '../lib/securityContext.js';

export default function authSessionRoutes(router) {
  router.post('/api/auth/session', (req, res) => {
    if (req.auth?.type === 'session') {
      return json(res, 200, { authenticated: true, session: authSnapshot(req) });
    }

    const session = issueSession(req.auth);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.max_age_seconds));
    return json(res, 201, {
      authenticated: true,
      session: {
        actor_id: session.actor_id,
        tenant_id: session.tenant_id,
        role: session.role,
        session_id: session.session_id,
        expires_at: session.expires_at
      }
    });
  });

  router.get('/api/auth/me', (req, res) => {
    return json(res, 200, { authenticated: true, session: authSnapshot(req) });
  });

  router.post('/api/auth/logout', (req, res) => {
    const token = requestSessionToken(req);
    if (token) revokeSession(token);
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { authenticated: false, revoked: Boolean(token) });
  });
}
