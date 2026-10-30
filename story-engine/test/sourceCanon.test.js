import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createCanonEvidence } from '../lib/canonEvidence.js';
import { analyzeStorySource, listSourceCanonState, reviewSourceProposal } from '../lib/sourceCanon.js';
import { canonSnapshot, listCanonChanges, setCanonAnchor } from '../lib/canonMemory.js';
import { issueCanonAuthorityGrant, issueSession, resolveRequestIdentity } from '../lib/securityContext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'source-canon-human-key',
  actor_id: 'source-canon-human',
  tenant_id: 'source-canon-tenant',
  role: 'creator',
  principal_type: 'human',
  workspace_ids: ['*']
}]);

test.after(() => {
  if (priorRegistry === undefined) delete process.env.L99_API_KEYS_JSON;
  else process.env.L99_API_KEYS_JSON = priorRegistry;
});

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-source-canon') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Source Canon Story', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

function humanGrant(workspaceId) {
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'source-canon-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  const req = {
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    request_id: `source-canon-${workspaceId}`
  };
  return issueCanonAuthorityGrant(req, workspaceId);
}

function proposalEvidence(db, { workspaceId, proposal, key, value, sourceVersion = null, sourceRef = null }) {
  const source = db.prepare(`
    SELECT content_hash FROM story_sources WHERE source_id=? AND workspace_id=?
  `).get(proposal.source_id, workspaceId);
  assert.ok(source?.content_hash);
  return createCanonEvidence({
    workspace_id: workspaceId,
    kind: proposal.kind,
    key,
    statement: value,
    source_ref: sourceRef || `source:${proposal.source_id};proposal:${proposal.proposal_id};reviewer:source-canon-human`,
    source_version: sourceVersion || `sha256:${source.content_hash}`,
    authority: 'human',
    confidence: proposal.confidence
  });
}

test('source extraction creates pending proposals without changing canon', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const result = await analyzeStorySource(db, {
    workspace_id: workspaceId,
    title: 'Moon Key memory',
    source_type: 'memory',
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind. Later, Nia Vale enters Moon City.'
  });

  assert.equal(result.status, 'review_ready');
  assert.ok(result.proposal_count >= 3);
  assert.equal(canonSnapshot(db, workspaceId).anchor_count, 0);

  const state = listSourceCanonState(db, workspaceId);
  assert.equal(state.counts.sources, 1);
  assert.equal(state.counts.pending, result.proposal_count);
  assert.equal(state.counts.approved, 0);
  db.close();
});

test('only explicit approval with human evidence and live authority grant promotes canon', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });

  const pending = listSourceCanonState(db, workspaceId).proposals;
  const character = pending.find(item => item.kind === 'character');
  assert.ok(character);
  const key = 'protagonist.name';
  const value = 'Nia Vale';

  const reviewed = reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: character.proposal_id,
    decision: 'approve',
    key,
    value,
    locked: true,
    evidence: proposalEvidence(db, { workspaceId, proposal: character, key, value }),
    authority_grant: humanGrant(workspaceId)
  });

  assert.equal(reviewed.proposal.status, 'approved');
  assert.equal(reviewed.proposal.key, 'protagonist.name');
  assert.equal(reviewed.canon_anchor.source, 'human');
  assert.equal(reviewed.canon_anchor.locked, true);

  const canon = canonSnapshot(db, workspaceId);
  assert.equal(canon.anchor_count, 1);
  assert.deepEqual(canon.anchors.character['protagonist.name'], {
    value: 'Nia Vale',
    locked: true,
    source: 'human'
  });

  assert.throws(() => setCanonAnchor(db, {
    workspace_id: workspaceId,
    kind: 'character',
    key: 'protagonist.name',
    value: 'Someone Else',
    locked: true,
    source: 'model'
  }), /explicit human authority/);
  db.close();
});

test('direct proposal approval without evidence fails closed and remains pending', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db, 'workspace-missing-evidence');

  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });

  const character = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(character);
  assert.throws(() => reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: character.proposal_id,
    decision: 'approve',
    key: 'protagonist.name',
    value: 'Nia Vale',
    locked: true,
    authority_grant: humanGrant(workspaceId)
  }), /explicit human evidence/);

  const state = listSourceCanonState(db, workspaceId);
  assert.equal(state.proposals.find(item => item.proposal_id === character.proposal_id).status, 'pending');
  assert.equal(canonSnapshot(db, workspaceId).anchor_count, 0);
  db.close();
});

test('domain proposal approval rejects mismatched immutable source hash', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db, 'workspace-source-hash-mismatch');
  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(proposal);
  const key = 'protagonist.name';
  const value = 'Nia Vale';
  const evidence = proposalEvidence(db, {
    workspaceId,
    proposal,
    key,
    value,
    sourceVersion: `sha256:${'0'.repeat(64)}`
  });

  assert.throws(() => reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: proposal.proposal_id,
    decision: 'approve',
    key,
    value,
    evidence,
    authority_grant: humanGrant(workspaceId)
  }), /immutable source hash/);
  assert.equal(listSourceCanonState(db, workspaceId).proposals.find(item => item.proposal_id === proposal.proposal_id).status, 'pending');
  assert.equal(canonSnapshot(db, workspaceId).anchor_count, 0);
  db.close();
});

test('domain proposal approval rejects fabricated source/proposal provenance', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db, 'workspace-source-ref-mismatch');
  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(proposal);
  const evidence = proposalEvidence(db, {
    workspaceId,
    proposal,
    key: 'protagonist.name',
    value: 'Nia Vale',
    sourceRef: `source:fake-source;proposal:${proposal.proposal_id};reviewer:source-canon-human`
  });

  assert.throws(() => reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: proposal.proposal_id,
    decision: 'approve',
    key: 'protagonist.name',
    value: 'Nia Vale',
    evidence,
    authority_grant: humanGrant(workspaceId)
  }), /exact workspace-scoped source and proposal/);
  assert.equal(canonSnapshot(db, workspaceId).anchor_count, 0);
  db.close();
});

test('proposal approval atomically updates and locks an existing unlocked anchor', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db, 'workspace-existing-lock');
  setCanonAnchor(db, {
    workspace_id: workspaceId,
    kind: 'character',
    key: 'protagonist.name',
    value: 'Nia',
    locked: false,
    evidence: createCanonEvidence({
      workspace_id: workspaceId,
      kind: 'character',
      key: 'protagonist.name',
      statement: 'Nia',
      source_ref: 'test:seed-existing',
      authority: 'human'
    }),
    authority_grant: humanGrant(workspaceId)
  });

  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(proposal);
  const evidence = proposalEvidence(db, { workspaceId, proposal, key: 'protagonist.name', value: 'Nia Vale' });
  const reviewed = reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: proposal.proposal_id,
    decision: 'approve',
    key: 'protagonist.name',
    value: 'Nia Vale',
    locked: true,
    evidence,
    authority_grant: humanGrant(workspaceId)
  });

  assert.equal(reviewed.proposal.status, 'approved');
  assert.equal(reviewed.canon_anchor.value, 'Nia Vale');
  assert.equal(reviewed.canon_anchor.locked, true);
  const [change] = listCanonChanges(db, workspaceId);
  assert.equal(change.operation, 'update_lock');
  assert.equal(change.previous_value, 'Nia');
  assert.equal(change.next_value, 'Nia Vale');
  assert.equal(Boolean(change.previous_locked), false);
  assert.equal(Boolean(change.next_locked), true);
  assert.equal(change.evidence_id, evidence.evidence_id);
  db.close();
});

test('proposal approval cannot unlock an existing locked anchor', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db, 'workspace-proposal-unlock');
  setCanonAnchor(db, {
    workspace_id: workspaceId,
    kind: 'character',
    key: 'protagonist.name',
    value: 'Nia Vale',
    locked: true,
    evidence: createCanonEvidence({
      workspace_id: workspaceId,
      kind: 'character',
      key: 'protagonist.name',
      statement: 'Nia Vale',
      source_ref: 'test:locked-seed',
      authority: 'human'
    }),
    authority_grant: humanGrant(workspaceId)
  });
  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  const evidence = proposalEvidence(db, { workspaceId, proposal, key: 'protagonist.name', value: 'Nia Vale' });
  assert.throws(() => reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: proposal.proposal_id,
    decision: 'approve',
    key: 'protagonist.name',
    value: 'Nia Vale',
    locked: false,
    evidence,
    authority_grant: humanGrant(workspaceId)
  }), /cannot unlock canon/);
  assert.equal(canonSnapshot(db, workspaceId).anchors.character['protagonist.name'].locked, true);
  db.close();
});

test('rejection is durable and never writes canon', async () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });

  const proposal = listSourceCanonState(db, workspaceId).proposals[0];
  const rejected = reviewSourceProposal(db, {
    workspace_id: workspaceId,
    proposal_id: proposal.proposal_id,
    decision: 'reject'
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(canonSnapshot(db, workspaceId).anchor_count, 0);
  assert.ok(listSourceCanonState(db, workspaceId).proposals.some(item => item.proposal_id === proposal.proposal_id && item.status === 'rejected'));
  db.close();
});
