// models/storyModel.js
import { randomUUID } from 'node:crypto';

export function create(db, { title, genre, pitch, tenant_id, actor_id, role = 'creator' }) {
  if (!tenant_id || !actor_id) throw new Error('Authenticated tenant and actor are required to create a story.');
  const workspace_id = randomUUID();
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO stories (workspace_id, title, genre, pitch, tenant_id, created_by_actor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspace_id, title, genre ?? null, pitch ?? null, tenant_id, actor_id, now, now);
    db.prepare(`
      INSERT OR IGNORE INTO workspace_memberships (workspace_id, tenant_id, actor_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspace_id, tenant_id, actor_id, role, now);
  })();
  return workspace_id;
}

export function get(db, workspace_id) {
  return db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspace_id);
}

function selectList(db, whereSql = '', params = []) {
  return db.prepare(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM chapters c WHERE c.workspace_id = s.workspace_id) AS chapter_count,
      (SELECT COUNT(*) FROM lindymode_incidents li
        WHERE li.workspace_id = s.workspace_id AND li.status = 'active') AS active_incident_count,
      (SELECT MAX(li.severity) FROM lindymode_incidents li
        WHERE li.workspace_id = s.workspace_id AND li.status = 'active') AS highest_severity,
      (SELECT MAX(e.created_at) FROM events e WHERE e.workspace_id = s.workspace_id) AS last_activity_at
    FROM stories s
    ${whereSql}
    ORDER BY COALESCE(last_activity_at, s.updated_at, s.created_at) DESC
  `).all(...params);
}

export function list(db, identity = {}) {
  const tenantId = String(identity.tenant_id || '').trim();
  const actorId = String(identity.actor_id || '').trim();
  if (!tenantId || !actorId) return [];

  const configured = Array.isArray(identity.workspace_ids)
    ? [...new Set(identity.workspace_ids.map(String).filter(Boolean))]
    : [];

  if (configured.includes('*')) {
    return selectList(db, 'WHERE s.tenant_id = ?', [tenantId]);
  }

  // A non-wildcard configured scope is an authority ceiling. Durable membership
  // may prove access inside that scope, but must never silently widen the credential.
  const memberships = db.prepare(`
    SELECT workspace_id FROM workspace_memberships
    WHERE tenant_id = ? AND actor_id = ?
  `).all(tenantId, actorId).map(row => row.workspace_id);
  const membershipSet = new Set(memberships);
  const allowed = configured.length ? configured : memberships;
  if (!allowed.length) return [];

  const placeholders = allowed.map(() => '?').join(',');
  return selectList(
    db,
    `WHERE s.workspace_id IN (${placeholders})
       AND (
         s.tenant_id = ?
         OR (
           s.tenant_id IS NULL
           AND EXISTS (
             SELECT 1 FROM workspace_memberships wm
             WHERE wm.workspace_id = s.workspace_id
               AND wm.tenant_id = ?
               AND wm.actor_id = ?
           )
         )
       )`,
    [...allowed, tenantId, tenantId, actorId]
  ).filter(story => story.tenant_id !== null || membershipSet.has(story.workspace_id));
}

export function update(db, workspace_id, fields) {
  const now = Date.now();
  db.prepare(`
    UPDATE stories SET title = ?, genre = ?, pitch = ?, updated_at = ?
    WHERE workspace_id = ?
  `).run(fields.title, fields.genre ?? null, fields.pitch ?? null, now, workspace_id);
}
