import { makevideoFingerprint, MAKEVIDEO_PROTOCOL_VERSION } from './makevideoProtocol.js';

export const MEDIA_ROUTER_DOMAIN_PROTOCOL_VERSION = 'media-router-domain/v1';

export const APPROVAL_LEVELS = Object.freeze([
  'none',
  'draft',
  'internal_review',
  'release_approved'
]);

export const INTENDED_USES = Object.freeze([
  'internal_draft',
  'storyboard',
  'proof_of_concept',
  'production_asset',
  'release_candidate',
  'published_release'
]);

export const ATTACK_FLOW_IDS = Object.freeze([
  'production_council',
  'founder_value_garyvee',
  'lindy',
  'redteam_pre',
  'l99',
  'redteam_post',
  'ooda',
  'attack10',
  'attack20',
  'truthmode',
  'confess',
  'proof'
]);

const GRANTING_ACTIONS = new Set([
  'mark_commercially_allowed',
  'mark_cross_project_reusable',
  'mark_release_permitted'
]);

function requiredString(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required.`);
  return text;
}

function isoTimestamp(value, name) {
  const date = new Date(value ?? new Date().toISOString());
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${name} must be a valid datetime.`);
  return date.toISOString();
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw new TypeError(`Unsupported ${name}: ${value}`);
}

export function createMakevideoAuthorityGrant(input = {}) {
  const approvalLevel = String(input.approvalLevel || '').trim();
  assertEnum(approvalLevel, APPROVAL_LEVELS, 'approvalLevel');
  if (approvalLevel === 'none') {
    throw new TypeError('A MAKEVIDEO authority grant cannot use approvalLevel=none.');
  }

  const authority = {
    sourceProtocol: 'MAKEVIDEO',
    sourceRecordId: requiredString(input.sourceRecordId, 'sourceRecordId'),
    assertedAt: isoTimestamp(input.assertedAt, 'assertedAt'),
    approvalLevel
  };

  const grant = {
    protocol_version: MEDIA_ROUTER_DOMAIN_PROTOCOL_VERSION,
    makevideo_protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    ...authority,
    authorityGranted: true,
    authority_granted: true,
    scope: input.scope ?? null,
    reason: input.reason ? String(input.reason).trim() : null
  };

  return Object.freeze({
    ...grant,
    fingerprint: makevideoFingerprint('media-router-authority-grant', grant)
  });
}

export function toDomainApprovalReference(grant) {
  if (!grant || grant.authorityGranted !== true || grant.authority_granted !== true) {
    throw new TypeError('Expected a granted MAKEVIDEO authority record.');
  }
  return Object.freeze({
    sourceProtocol: 'MAKEVIDEO',
    sourceRecordId: requiredString(grant.sourceRecordId, 'sourceRecordId'),
    assertedAt: isoTimestamp(grant.assertedAt, 'assertedAt'),
    approvalLevel: grant.approvalLevel
  });
}

export function assertAuthoritySourceResolvable(authority, sourceRecordExists) {
  if (typeof sourceRecordExists !== 'function') {
    throw new TypeError('sourceRecordExists resolver is required.');
  }
  if (!sourceRecordExists(authority.sourceRecordId)) {
    throw new TypeError(`Domain authority source record not found: ${authority.sourceRecordId}`);
  }
  return true;
}

export function createDomainMediaContextV1(input = {}) {
  const intendedUse = String(input.intendedUse || '').trim();
  assertEnum(intendedUse, INTENDED_USES, 'intendedUse');

  const releaseContext = {
    ...(input.releaseContext || {}),
    approvalRequiredBeforePublication:
      input.releaseContext?.approvalRequiredBeforePublication !== false
  };

  if (intendedUse === 'published_release' && !releaseContext.releaseReceiptId) {
    throw new TypeError('published_release requires releaseContext.releaseReceiptId.');
  }

  const context = {
    projectId: requiredString(input.projectId, 'projectId'),
    workspaceId: requiredString(input.workspaceId, 'workspaceId'),
    ...(input.creativeBriefId ? { creativeBriefId: String(input.creativeBriefId) } : {}),
    ...(input.creativeCanonId ? { creativeCanonId: String(input.creativeCanonId) } : {}),
    intendedUse,
    releaseContext,
    claimContext: Array.isArray(input.claimContext) ? input.claimContext.map((claim) => ({ ...claim })) : [],
    assetInputs: Array.isArray(input.assetInputs) ? input.assetInputs.map((asset) => ({ ...asset })) : []
  };

  return Object.freeze({
    ...context,
    fingerprint: makevideoFingerprint('media-router-domain-context', context)
  });
}

export function createMediaAttackFlowBundle(input = {}) {
  const records = Array.isArray(input.records) ? input.records : [];

  for (const flow of ATTACK_FLOW_IDS) {
    const matching = records.filter((record) => record.flow === flow);
    if (matching.length !== 1) {
      throw new TypeError(`Attack flow ${flow} must appear exactly once.`);
    }
  }

  for (const record of records) {
    assertEnum(record.flow, ATTACK_FLOW_IDS, 'attack flow');
    if (!['pass', 'block'].includes(record.verdict)) {
      throw new TypeError(`Unsupported attack-flow verdict: ${record.verdict}`);
    }
    if (!Array.isArray(record.sourceRecordIds) || record.sourceRecordIds.length === 0) {
      throw new TypeError(`Attack flow ${record.flow} requires sourceRecordIds.`);
    }
    requiredString(record.rationale, `${record.flow}.rationale`);
    isoTimestamp(record.assertedAt, `${record.flow}.assertedAt`);
  }

  const bundle = {
    version: 'media-attack-flow-v1',
    records: records.map((record) => ({
      flow: record.flow,
      verdict: record.verdict,
      sourceRecordIds: [...record.sourceRecordIds],
      assertedAt: isoTimestamp(record.assertedAt, `${record.flow}.assertedAt`),
      rationale: String(record.rationale).trim()
    }))
  };

  const blocked = bundle.records.filter((record) => record.verdict === 'block');
  return Object.freeze({
    ...bundle,
    passed: blocked.length === 0,
    blockedFlows: Object.freeze(blocked.map((record) => record.flow)),
    fingerprint: makevideoFingerprint('media-router-attack-flow-bundle', bundle)
  });
}

export function createAssetAuthorityUpdateV1(input = {}) {
  const action = String(input.action || '').trim();
  const allowedActions = [
    'mark_commercially_allowed',
    'mark_cross_project_reusable',
    'mark_release_permitted',
    'quarantine',
    'revoke'
  ];
  assertEnum(action, allowedActions, 'authority action');

  const grant = input.grant;
  const authority = toDomainApprovalReference(grant);
  if (GRANTING_ACTIONS.has(action) && authority.approvalLevel === 'none') {
    throw new TypeError('Granting authority updates require a non-none approval level.');
  }

  const scope = {
    ...(input.scope || {}),
    allowedUse: input.scope?.allowedUse || 'internal_only'
  };

  if (action === 'mark_release_permitted') {
    if (authority.approvalLevel !== 'release_approved') {
      throw new TypeError('Release permission requires release_approved authority.');
    }
    if (scope.allowedUse !== 'specific_release' || !scope.releaseReceiptId) {
      throw new TypeError('Release permission requires specific_release and releaseReceiptId.');
    }
  }

  const update = {
    assetId: requiredString(input.assetId, 'assetId'),
    action,
    authority,
    authorityGranted: true,
    authority_granted: true,
    scope,
    ...(input.reason ? { reason: String(input.reason).trim() } : {})
  };

  return Object.freeze({
    ...update,
    fingerprint: makevideoFingerprint('media-router-asset-authority-update', update)
  });
}

export function createMediaRouterHandoff(input = {}) {
  if (!input.request || !input.context || !input.attackFlow) {
    throw new TypeError('request, context, and attackFlow are required.');
  }
  if (input.attackFlow.passed !== true) {
    throw new TypeError('Media Router handoff blocked by attack-flow verdict.');
  }
  if (input.request.projectId !== input.context.projectId || input.request.workspaceId !== input.context.workspaceId) {
    throw new TypeError('request/domain context identity mismatch.');
  }

  const handoff = {
    protocolVersion: MEDIA_ROUTER_DOMAIN_PROTOCOL_VERSION,
    request: input.request,
    context: input.context,
    attackFlow: input.attackFlow,
    domainAuthorityGranted: Boolean(input.domainAuthorityGrant),
    domainAuthority: input.domainAuthorityGrant
      ? toDomainApprovalReference(input.domainAuthorityGrant)
      : null
  };

  return Object.freeze({
    ...handoff,
    fingerprint: makevideoFingerprint('media-router-handoff', handoff)
  });
}
