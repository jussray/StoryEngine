import { createHash } from 'node:crypto';
import { log } from '../models/eventModel.js';

export const PRODUCT_BUILD_DIRECTIVE_CONTRACT = 'juss-v10/product-build-directive@v1';
export const PRODUCT_BUILD_RECEIPT_CONTRACT = 'juss-v10/product-build-receipt@v1';
export const STORYENGINE_PRODUCT_CONTROL_ROOM_ID = 'storyengine-control-room';
export const STORYENGINE_PROJECT_ID = 'l99';
export const STORYENGINE_REPOSITORY = 'jussray/StoryEngine';

const SHA256 = /^[0-9a-f]{64}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const FIRST_ACTUATOR_SCOPE = 'control-room:event-log';
const FEDERATION_CAPABILITY = 'founder-control-room-federation';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(text).filter(Boolean))].sort();
}

function normalizedProposal(input = {}) {
  return {
    proposalId: text(input.proposalId),
    proposalHash: text(input.proposalHash).toLowerCase(),
    projectSlug: text(input.projectSlug),
    actionType: text(input.actionType),
    expectedHeadSha: text(input.expectedHeadSha).toLowerCase() || null,
    capabilityPlanHash: text(input.capabilityPlanHash).toLowerCase() || null,
  };
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedDirective(input = {}) {
  return {
    contract: input.contract,
    directiveId: text(input.directiveId),
    proposal: normalizedProposal(input.proposal),
    founderDecisionHash: text(input.founderDecisionHash).toLowerCase(),
    productControlRoomId: text(input.productControlRoomId),
    repository: text(input.repository),
    objective: text(input.objective),
    allowedCapabilities: normalizedList(input.allowedCapabilities),
    allowedMutationScope: normalizedList(input.allowedMutationScope),
    authorityCeiling: input.authorityCeiling,
    requiredProof: normalizedList(input.requiredProof),
    stopConditions: normalizedList(input.stopConditions),
    rollback: text(input.rollback),
    chiefCapabilityPlanRequired: input.chiefCapabilityPlanRequired,
    executionAuthorized: input.executionAuthorized,
    receiptRequired: input.receiptRequired,
    mergeAuthorized: input.mergeAuthorized,
    deployAuthorized: input.deployAuthorized,
    providerMutationAuthorized: input.providerMutationAuthorized,
  };
}

export function productBuildDirectiveHash(input) {
  const value = normalizedDirective(input);
  return digest([
    PRODUCT_BUILD_DIRECTIVE_CONTRACT,
    value.directiveId,
    value.proposal,
    value.founderDecisionHash,
    value.productControlRoomId,
    value.repository,
    value.objective,
    value.allowedCapabilities,
    value.allowedMutationScope,
    value.authorityCeiling,
    value.requiredProof,
    value.stopConditions,
    value.rollback,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
}

export function validateProductBuildDirective(input, options = {}) {
  const value = normalizedDirective(input);
  const errors = [];
  const expectedHeadSha = text(options.expectedHeadSha || process.env.EXPECTED_HEAD_SHA).toLowerCase();

  if (value.contract !== PRODUCT_BUILD_DIRECTIVE_CONTRACT) errors.push('product build directive contract is unsupported');
  if (!value.directiveId) errors.push('directiveId is required');
  if (!SHA256.test(value.proposal.proposalHash)) errors.push('proposalHash must be a SHA-256 hash');
  if (value.proposal.projectSlug !== STORYENGINE_PROJECT_ID) errors.push('product build directive project does not target StoryEngine');
  if (!FULL_SHA.test(value.proposal.expectedHeadSha || '')) errors.push('product build directive requires an exact expectedHeadSha');
  if (expectedHeadSha && value.proposal.expectedHeadSha !== expectedHeadSha) errors.push('product build directive expectedHeadSha does not match this exact runtime head');
  if (!SHA256.test(value.proposal.capabilityPlanHash || '')) errors.push('product build directive requires a Chief capabilityPlanHash');
  if (!SHA256.test(value.founderDecisionHash)) errors.push('product build directive requires an exact founderDecisionHash');
  if (value.productControlRoomId !== STORYENGINE_PRODUCT_CONTROL_ROOM_ID) errors.push('product build directive control room identity mismatch');
  if (value.repository !== STORYENGINE_REPOSITORY) errors.push('product build directive repository mismatch');
  if (!value.objective) errors.push('product build directive objective is required');
  if (!value.allowedCapabilities.includes(FEDERATION_CAPABILITY)) errors.push('product build directive lacks the StoryEngine federation capability');
  if (value.allowedMutationScope.length !== 1 || value.allowedMutationScope[0] !== FIRST_ACTUATOR_SCOPE) {
    errors.push('first product build actuator is limited to the Control Room event log');
  }
  if (value.authorityCeiling !== 'reversible_product_change') errors.push('product build directive authority ceiling is unsupported');
  if (!value.requiredProof.includes('node-test') || !value.requiredProof.includes('playwright')) {
    errors.push('product build directive must require node-test and playwright proof');
  }
  if (value.stopConditions.length === 0) errors.push('product build directive stop conditions are required');
  if (!value.rollback) errors.push('product build directive rollback is required');
  if (value.chiefCapabilityPlanRequired !== true) errors.push('Chief capability plan must remain required');
  if (value.executionAuthorized !== true || value.receiptRequired !== true) errors.push('product build directive must carry explicit execution and receipt requirements');
  if (value.mergeAuthorized !== false || value.deployAuthorized !== false || value.providerMutationAuthorized !== false) {
    errors.push('product build directive cannot widen merge, deploy, or provider mutation authority');
  }
  if (!SHA256.test(text(input?.directiveHash)) || text(input.directiveHash).toLowerCase() !== productBuildDirectiveHash(value)) {
    errors.push('product build directive hash does not match the canonical directive identity');
  }

  return [...new Set(errors)];
}

function receiptIdentity(receipt) {
  return [
    PRODUCT_BUILD_RECEIPT_CONTRACT,
    receipt.directiveHash,
    receipt.productControlRoomId,
    receipt.repository,
    receipt.status,
    normalizedList(receipt.changedResources),
    normalizedList(receipt.proofRefs),
    receipt.executionReceiptId,
    false,
    false,
    false,
  ];
}

export function productBuildReceiptHash(receipt) {
  return digest(receiptIdentity(receipt));
}

export function createProductBuildReceipt(directive, eventRecord) {
  const withoutHash = {
    contract: PRODUCT_BUILD_RECEIPT_CONTRACT,
    directiveHash: text(directive.directiveHash).toLowerCase(),
    productControlRoomId: STORYENGINE_PRODUCT_CONTROL_ROOM_ID,
    repository: STORYENGINE_REPOSITORY,
    status: 'completed',
    changedResources: [FIRST_ACTUATOR_SCOPE],
    proofRefs: [`storyengine:event-log:${eventRecord.id}`],
    executionReceiptId: `storyengine-event-${eventRecord.id}`,
    mergePerformed: false,
    deployPerformed: false,
    providerMutationPerformed: false,
  };
  return { ...withoutHash, receiptHash: productBuildReceiptHash(withoutHash) };
}

export function executeProductBuildDirective(db, directive, options = {}) {
  const errors = validateProductBuildDirective(directive, options);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const event = log(db, {
    workspace_id: 'control-room',
    mode: 'control_room',
    event_type: 'control_room.product_build_directive_executed',
    payload: {
      directive_hash: directive.directiveHash,
      proposal_id: directive.proposal.proposalId,
      capability_plan_hash: directive.proposal.capabilityPlanHash,
      expected_head_sha: directive.proposal.expectedHeadSha,
      product_control_room_id: STORYENGINE_PRODUCT_CONTROL_ROOM_ID,
      repository: STORYENGINE_REPOSITORY,
      changed_resource: FIRST_ACTUATOR_SCOPE,
    },
    rollback: true,
  });

  return createProductBuildReceipt(directive, event);
}
