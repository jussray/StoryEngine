import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobSpec } from '../lib/makevideoProtocol.js';
import {
  ATTACK_FLOW_IDS,
  assertAuthoritySourceResolvable,
  createAssetAuthorityUpdateV1,
  createDomainMediaContextV1,
  createMakevideoAuthorityGrant,
  createMediaAttackFlowBundle,
  createMediaRouterHandoff
} from '../lib/mediaRouterDomainBridge.js';

const at = '2026-09-23T00:00:00.000Z';

function passingAttackFlow() {
  return createMediaAttackFlowBundle({
    records: ATTACK_FLOW_IDS.map((flow, index) => ({
      flow,
      verdict: 'pass',
      sourceRecordIds: [`evidence_${index}`],
      assertedAt: at,
      rationale: `${flow} passed against bounded test evidence`
    }))
  });
}

test('evidence stays non-authorizing while MAKEVIDEO can issue a true bounded grant', () => {
  const evidence = createJobSpec({
    objective_id: 'objective_1',
    adapter_id: 'test',
    adapter_version: '1',
    immutable_job_spec: { prompt: 'bounded' }
  });
  assert.equal(evidence.authority_granted, false);

  const grant = createMakevideoAuthorityGrant({
    sourceRecordId: 'release_record_1',
    assertedAt: at,
    approvalLevel: 'release_approved',
    scope: { releaseReceiptId: 'release_1' }
  });
  assert.equal(grant.authorityGranted, true);
  assert.equal(grant.authority_granted, true);
  assert.equal(grant.sourceProtocol, 'MAKEVIDEO');
});

test('authority source must resolve in the domain record store', () => {
  const grant = createMakevideoAuthorityGrant({
    sourceRecordId: 'record_exists',
    assertedAt: at,
    approvalLevel: 'internal_review'
  });
  assert.equal(assertAuthoritySourceResolvable(grant, (id) => id === 'record_exists'), true);
  assert.throws(
    () => assertAuthoritySourceResolvable(grant, () => false),
    /source record not found/i
  );
});

test('published_release requires an exact release receipt', () => {
  assert.throws(
    () => createDomainMediaContextV1({
      projectId: 'story',
      workspaceId: 'workspace',
      intendedUse: 'published_release',
      releaseContext: { approvalRequiredBeforePublication: true }
    }),
    /releaseReceiptId/
  );
});

test('release permission accepts a release-approved MAKEVIDEO grant', () => {
  const grant = createMakevideoAuthorityGrant({
    sourceRecordId: 'release_record_2',
    assertedAt: at,
    approvalLevel: 'release_approved'
  });
  const update = createAssetAuthorityUpdateV1({
    assetId: 'asset_1',
    action: 'mark_release_permitted',
    grant,
    scope: { allowedUse: 'specific_release', releaseReceiptId: 'release_2' }
  });
  assert.equal(update.authorityGranted, true);
  assert.equal(update.authority_granted, true);
  assert.equal(update.authority.sourceRecordId, 'release_record_2');
});

test('release permission rejects weaker domain approval', () => {
  const grant = createMakevideoAuthorityGrant({
    sourceRecordId: 'review_record_1',
    assertedAt: at,
    approvalLevel: 'internal_review'
  });
  assert.throws(
    () => createAssetAuthorityUpdateV1({
      assetId: 'asset_1',
      action: 'mark_release_permitted',
      grant,
      scope: { allowedUse: 'specific_release', releaseReceiptId: 'release_2' }
    }),
    /release_approved/
  );
});

test('all attack flows including Attack Ten and Attack 20 are required exactly once', () => {
  const bundle = passingAttackFlow();
  assert.equal(bundle.passed, true);
  assert.ok(ATTACK_FLOW_IDS.includes('attack10'));
  assert.ok(ATTACK_FLOW_IDS.includes('attack20'));

  assert.throws(
    () => createMediaAttackFlowBundle({ records: bundle.records.filter((r) => r.flow !== 'attack10') }),
    /attack10 must appear exactly once/
  );
});

test('a blocking attack verdict prevents the router handoff', () => {
  const records = ATTACK_FLOW_IDS.map((flow, index) => ({
    flow,
    verdict: flow === 'redteam_post' ? 'block' : 'pass',
    sourceRecordIds: [`evidence_${index}`],
    assertedAt: at,
    rationale: `${flow} bounded verdict`
  }));
  const attackFlow = createMediaAttackFlowBundle({ records });
  assert.equal(attackFlow.passed, false);

  assert.throws(
    () => createMediaRouterHandoff({
      request: { projectId: 'story', workspaceId: 'workspace' },
      context: createDomainMediaContextV1({
        projectId: 'story', workspaceId: 'workspace', intendedUse: 'internal_draft',
        releaseContext: { approvalRequiredBeforePublication: true }
      }),
      attackFlow
    }),
    /blocked by attack-flow verdict/
  );
});

test('handoff mirrors true domain authority but does not create it', () => {
  const grant = createMakevideoAuthorityGrant({
    sourceRecordId: 'review_record_2', assertedAt: at, approvalLevel: 'internal_review'
  });
  const context = createDomainMediaContextV1({
    projectId: 'story', workspaceId: 'workspace', intendedUse: 'production_asset',
    releaseContext: { approvalRequiredBeforePublication: true }
  });
  const handoff = createMediaRouterHandoff({
    request: { projectId: 'story', workspaceId: 'workspace' },
    context,
    attackFlow: passingAttackFlow(),
    domainAuthorityGrant: grant
  });
  assert.equal(handoff.domainAuthorityGranted, true);
  assert.equal(handoff.domainAuthority.sourceRecordId, 'review_record_2');
});
