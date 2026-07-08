// lib/founderProfile.js
// Deprecated compatibility adapter. New code should import operatorProfile.js.

export {
  ensureOperatorSchema as ensureFounderSchema,
  getOperatorProfile as getFounderProfile,
  updateOperatorProfile as updateFounderProfile,
  recordOperatorEvent as recordFounderEvent,
  getOperatorSummary as getFounderSummary,
  evaluateOperatorConstraint as evaluateFounderConstraint,
  OPERATOR_PROFILE_OPTIONS as FOUNDER_PROFILE_OPTIONS
} from './operatorProfile.js';
