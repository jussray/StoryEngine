import { json } from './miniRouter.js';
import { roleAtLeast } from './securityContext.js';

const CALLER_CONTROL_FIELDS = Object.freeze([
  'mode',
  'mode_id',
  'workflow',
  'workflow_id',
  'command',
  'skill',
  'lens',
]);

export const FOUNDER_CONTROL_ROOM_TENANT_ID = 'founder-control-room';

export function hasCallerSelectedControlMode(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return CALLER_CONTROL_FIELDS.some(field => Object.prototype.hasOwnProperty.call(body, field));
}

export function isInternalController(identity) {
  return identity?.type === 'scoped_api_key' && roleAtLeast(identity, 'administrator');
}

export function isFounderControlRoomController(identity) {
  return isInternalController(identity)
    && identity?.tenant_id === FOUNDER_CONTROL_ROOM_TENANT_ID;
}

export function requireInternalController(req, res) {
  if (isInternalController(req.auth)) return true;
  json(res, 403, {
    error: 'internal_controller_required',
    message: 'System-owned modes cannot be invoked directly from user or browser-session authority.',
    request_id: req.request_id,
  });
  return false;
}

export function requireFounderControlRoomController(req, res) {
  if (isFounderControlRoomController(req.auth)) return true;
  json(res, 403, {
    error: 'founder_control_room_controller_required',
    message: 'Product Control Room execution requires the authenticated Founder Control Room service tenant.',
    request_id: req.request_id,
  });
  return false;
}

export function rejectCallerSelectedControlMode(req, res) {
  if (!hasCallerSelectedControlMode(req.body)) return false;
  json(res, 400, {
    error: 'control_mode_not_user_selectable',
    message: 'Request the outcome only. Internal mode and workflow selection is system-controlled.',
    request_id: req.request_id,
  });
  return true;
}
