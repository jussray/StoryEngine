import { roleAtLeast } from './securityContext.js';

function workspaceScope(identity) {
  return Array.isArray(identity?.workspace_ids)
    ? [...new Set(identity.workspace_ids.map(String).filter(Boolean))]
    : [];
}

export function canCreateWorkspace(identity) {
  if (!roleAtLeast(identity, 'creator')) return false;
  const allowed = workspaceScope(identity);

  // Empty scope means the actor relies on tenant/membership authority. A wildcard
  // is an explicit tenant-wide scope. Any named non-wildcard list is a hard
  // ceiling and cannot authorize creation of a new, not-yet-named workspace.
  return allowed.length === 0 || allowed.includes('*');
}

export function canCreateDerivedWorkspace(identity, sourceStory) {
  if (!canCreateWorkspace(identity)) return false;
  if (!sourceStory?.tenant_id || sourceStory.tenant_id !== identity?.tenant_id) return false;

  const allowed = workspaceScope(identity);
  if (allowed.includes('*')) return true;

  // Membership-only creators may derive a new workspace only from work they own.
  // The conversion layer preserves that source owner on the new workspace, so
  // requiring the same actor prevents creating a target the caller cannot reopen.
  return allowed.length === 0 && sourceStory.created_by_actor_id === identity?.actor_id;
}

export function workspaceCreationDenial(identity) {
  return {
    error: 'workspace_creation_forbidden_by_scope',
    actor_role: identity?.role || null,
    reason: 'This credential is limited to existing workspace ids and cannot create a new workspace.'
  };
}

export function derivedWorkspaceCreationDenial(identity) {
  return {
    error: 'derived_workspace_creation_forbidden',
    actor_role: identity?.role || null,
    reason: 'This identity cannot create a derived workspace from the selected source without widening or changing source ownership.'
  };
}
