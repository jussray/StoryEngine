import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCanonEvidence } from '../lib/canonEvidence.js';
import {
  setCanonAnchor, lockCanonAnchor, getCanonAnchor, getCanonEvidence,
  listCanonAnchors, listCanonChanges, canonSnapshot, evaluateCanonFit
} from '../lib/canonMemory.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    mode TEXT,
    event_type TEXT NOT NULL,
    payload TEXT,
    duration_ms INTEGER,
    rollback INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER
  )`);
  return db;
}

function humanEvidence({ workspace_id, kind, key, value, source_ref = 'test:human-review' }) {
  return createCanonEvidence({
    workspace_id,
    kind,
    key,
    statement: String(value),
    source_ref,
    authority: 'human'
  });
}

function writeHumanCanon(db, input) {
  return setCanonAnchor(db, { ...input, evidence: humanEvidence(input) });
}

test('setCanonAnchor creates and retrieves an anchor', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya' });
  const a = getCanonAnchor(db, 'ws1', 'character', 'protagonist_name');
  assert.ok(a);
  assert.strictEqual(a.value, 'Maya');
  assert.strictEqual(a.locked, 0);
});

test('setCanonAnchor updates an existing anchor', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya' });
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya Chen' });
  const a = getCanonAnchor(db, 'ws1', 'character', 'protagonist_name');
  assert.strictEqual(a.value, 'Maya Chen');
});

test('non-human sources cannot write canon even when anchor is unlocked', () => {
  const db = makeDb();
  assert.throws(() => {
    setCanonAnchor(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic exists.', source: 'ai' });
  }, /explicit human authority/);
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic'), null);
});

test('human source without evidence fails closed before canon mutation', () => {
  const db = makeDb();
  assert.throws(() => {
    setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Maya' });
  }, /explicit human evidence/);
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'character', 'name'), null);
  assert.strictEqual(listCanonChanges(db, 'ws1').length, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);
});

test('lockCanonAnchor requires evidence, records the lock, and is idempotent', () => {
  const db = makeDb();
  const input = { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic does not exist.' };
  writeHumanCanon(db, { ...input, locked: false });

  const beforeChanges = listCanonChanges(db, 'ws1').length;
  const beforeEvents = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  assert.throws(() => {
    lockCanonAnchor(db, { workspace_id: input.workspace_id, kind: input.kind, key: input.key });
  }, /explicit human evidence/);
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic').locked, 0);
  assert.strictEqual(listCanonChanges(db, 'ws1').length, beforeChanges);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, beforeEvents);

  const evidence = humanEvidence({ ...input, source_ref: 'test:lock-review' });
  const result = lockCanonAnchor(db, {
    workspace_id: input.workspace_id,
    kind: input.kind,
    key: input.key,
    evidence
  });
  assert.deepStrictEqual(result, {
    locked: true,
    already_locked: false,
    anchor_id: getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic').anchor_id
  });
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic').locked, 1);

  const [lockChange] = listCanonChanges(db, 'ws1');
  assert.strictEqual(lockChange.operation, 'lock');
  assert.strictEqual(lockChange.previous_value, input.value);
  assert.strictEqual(lockChange.next_value, input.value);
  assert.strictEqual(lockChange.evidence_id, evidence.evidence_id);
  assert.strictEqual(lockChange.evidence_authority, 'human');
  assert.strictEqual(getCanonEvidence(db, evidence.evidence_id).source_ref, 'test:lock-review');

  const afterChanges = listCanonChanges(db, 'ws1').length;
  const afterEvents = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  const repeat = lockCanonAnchor(db, { workspace_id: input.workspace_id, kind: input.kind, key: input.key });
  assert.strictEqual(repeat.locked, true);
  assert.strictEqual(repeat.already_locked, true);
  assert.strictEqual(listCanonChanges(db, 'ws1').length, afterChanges);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, afterEvents);
});

test('lock mutation, evidence, ledger, and event roll back together when ledger insert fails', () => {
  const db = makeDb();
  const input = { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic does not exist.' };
  writeHumanCanon(db, { ...input, locked: false });
  const evidence = humanEvidence({ ...input, source_ref: 'test:lock-rollback' });
  const beforeEvents = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  const beforeChanges = listCanonChanges(db, 'ws1').length;

  db.exec(`
    CREATE TRIGGER fail_lock_ledger
    BEFORE INSERT ON canon_change_ledger
    WHEN NEW.operation = 'lock'
    BEGIN
      SELECT RAISE(ABORT, 'lock_ledger_fail');
    END;
  `);

  assert.throws(() => {
    lockCanonAnchor(db, {
      workspace_id: input.workspace_id,
      kind: input.kind,
      key: input.key,
      evidence
    });
  }, /lock_ledger_fail/);

  assert.strictEqual(getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic').locked, 0);
  assert.strictEqual(getCanonEvidence(db, evidence.evidence_id), null);
  assert.strictEqual(listCanonChanges(db, 'ws1').length, beforeChanges);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, beforeEvents);
});

test('locked canon still permits explicit human correction', () => {
  const db = makeDb();
  const input = { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic does not exist.' };
  writeHumanCanon(db, { ...input, locked: false });
  lockCanonAnchor(db, {
    workspace_id: input.workspace_id,
    kind: input.kind,
    key: input.key,
    evidence: humanEvidence({ ...input, source_ref: 'test:lock-before-correction' })
  });
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic never existed.', locked: true });
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'world_rule', 'no_magic').value, 'Magic never existed.');
});

test('human evidence is persisted and resolvable from the change ledger', () => {
  const db = makeDb();
  const evidence = createCanonEvidence({
    workspace_id: 'ws1',
    kind: 'character',
    key: 'eye_color',
    statement: 'green',
    source_ref: 'source:chapter-02#line-18',
    source_version: 'sha256:abc',
    authority: 'human'
  });
  setCanonAnchor(db, {
    workspace_id: 'ws1', kind: 'character', key: 'eye_color', value: 'green', evidence
  });

  const stored = getCanonEvidence(db, evidence.evidence_id);
  assert.ok(stored);
  assert.strictEqual(stored.statement, 'green');
  assert.strictEqual(stored.source_ref, 'source:chapter-02#line-18');
  assert.strictEqual(stored.fingerprint, evidence.fingerprint);

  const [change] = listCanonChanges(db, 'ws1');
  assert.strictEqual(change.evidence_id, evidence.evidence_id);
  assert.strictEqual(change.evidence_statement, 'green');
  assert.strictEqual(change.evidence_source_ref, 'source:chapter-02#line-18');
  assert.strictEqual(change.evidence_authority, 'human');
});

test('high-confidence AI evidence remains descriptive and cannot authorize canon', () => {
  const db = makeDb();
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'lore', key: 'secret', statement: 'The door is sealed.',
    source_ref: 'extract:chapter-04', authority: 'ai', confidence: 0.99
  });
  assert.throws(() => {
    setCanonAnchor(db, { workspace_id: 'ws1', kind: 'lore', key: 'secret', value: 'The door is sealed.', evidence });
  }, /explicit human approval/);
  assert.strictEqual(getCanonAnchor(db, 'ws1', 'lore', 'secret'), null);
});

test('evidence scope and statement must match the canon mutation', () => {
  const db = makeDb();
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'character', key: 'name', statement: 'Maya',
    source_ref: 'review:1', authority: 'human'
  });
  assert.throws(() => {
    setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Amaya', evidence });
  }, /statement does not match/);
});

test('canon mutation, evidence, ledger, and event remain atomic when ledger insert fails', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Maya' });
  const beforeEvents = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  const beforeChanges = listCanonChanges(db, 'ws1').length;
  db.exec(`
    CREATE TRIGGER fail_canon_ledger
    BEFORE INSERT ON canon_change_ledger
    BEGIN
      SELECT RAISE(ABORT, 'ledger_fail');
    END;
  `);

  assert.throws(() => {
    writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Amaya' });
  }, /ledger_fail/);

  assert.strictEqual(getCanonAnchor(db, 'ws1', 'character', 'name').value, 'Maya');
  assert.strictEqual(listCanonChanges(db, 'ws1').length, beforeChanges);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, beforeEvents);
});

test('change ledger uses monotonic sequence when timestamps tie', () => {
  const db = makeDb();
  const originalNow = Date.now;
  Date.now = () => 1770000000000;
  try {
    writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Maya' });
    writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Amaya' });
  } finally {
    Date.now = originalNow;
  }

  const changes = listCanonChanges(db, 'ws1');
  assert.strictEqual(changes.length, 2);
  assert.strictEqual(changes[0].operation, 'update');
  assert.strictEqual(changes[0].next_value, 'Amaya');
  assert.ok(changes[0].sequence > changes[1].sequence);
  assert.strictEqual(changes[0].created_at, changes[1].created_at);
});

test('canonSnapshot groups anchors by kind', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Maya' });
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'rule1', value: 'No flying.' });
  writeHumanCanon(db, { workspace_id: 'ws1', kind: 'tone_constant', key: 'mood', value: 'hopeful' });
  const snap = canonSnapshot(db, 'ws1');
  assert.strictEqual(snap.anchor_count, 3);
  assert.ok(snap.anchors.character);
  assert.ok(snap.anchors.world_rule);
  assert.ok(snap.anchors.tone_constant);
});

test('evaluateCanonFit passes when no anchors set', () => {
  const db = makeDb();
  const result = evaluateCanonFit(db, 'ws_empty', 'Some draft text here.');
  assert.ok(result.passed);
  assert.strictEqual(result.anchor_count, 0);
});

test('evaluateCanonFit detects world rule possible contradiction', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws2', kind: 'world_rule', key: 'magic_rule', value: 'Magic does not exist in this story world.' });
  const draft = 'There was no magic in the valley, or so they thought. She cast a spell and the stones flew.';
  const result = evaluateCanonFit(db, 'ws2', draft);
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.some(c => c.includes('world_rule')));
});

test('evaluateCanonFit surfaces tone constant as info reminder', () => {
  const db = makeDb();
  writeHumanCanon(db, { workspace_id: 'ws3', kind: 'tone_constant', key: 'mood', value: 'hopeful' });
  const result = evaluateCanonFit(db, 'ws3', 'The city was cold and dark and everyone was suffering.');
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.includes('canon_tone_reminder'));
});
