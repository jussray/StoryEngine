import { roleAtLeast } from './securityContext.js';

export function canCreateWorkspace(identity) {
  if (!roleAtLeast(identity, 'creator')) return false;
  const allowed = Array.isArray(identity?.workspace_ids)
    ? [...new Set(identity.workspace_ids.map(String).filter(Boolean))]
    : [];

  // Empty scope means the actor relies on tenant/membership authority. A wildcard
  // is an explicit tenant-wide scope. Any named non-wildcard list is a hard
  // ceiling and cannot authorize creation of a new, not-yet-named workspace.
  return allowed.length === 0 || allowed.includes('*');
}

export function workspaceCreationDenial(identity) {
  return {
    error: 'workspace_creation_forbidden_by_scope',
    actor_role: identity?.role || null,
    reason: 'This credential is limited to existing workspace ids and cannot create a new workspace.'
  };
}
