// lib/canonMemory.js
// Canon Memory Engine — persists story facts across runs, chapters, and sessions.
// Characters, world rules, tone constants, and unbreakable facts live here.
// Redteam imports evaluateCanonFit() to gate drafts before passing.

import { createHash, randomUUID } from 'node:crypto';
import './sqliteTransaction.js';
import { log } from '../models/eventModel.js';
import { assertCanonEvidenceWritable, fingerprintCanonEvidence } from './canonEvidence.js';
import { assertCanonAuthorityGrant } from './securityContext.js';

const LEGACY_CANON_LEDGER_MIGRATION = 'canon_change_ledger_legacy_baseline_v1';

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canon_anchors (
      anchor_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canon_workspace_key ON canon_anchors(workspace_id, kind, key);
    CREATE INDEX IF NOT EXISTS idx_canon_workspace ON canon_anchors(workspace_id);

    CREATE TABLE IF NOT EXISTS canon_violations (
      violation_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      anchor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      expected TEXT NOT NULL,
      found TEXT NOT NULL,
      severity TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canon_violations_workspace ON canon_violations(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS canon_evidence (
      evidence_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      statement TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_version TEXT,
      authority TEXT NOT NULL,
      confidence REAL,
      fingerprint TEXT NOT NULL,
      established_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canon_evidence_fingerprint ON canon_evidence(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_canon_evidence_workspace ON canon_evidence(workspace_id, kind, key, established_at DESC);

    CREATE TABLE IF NOT EXISTS canon_change_ledger (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      anchor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      operation TEXT NOT NULL,
      previous_value TEXT,
      next_value TEXT NOT NULL,
      previous_locked INTEGER,
      next_locked INTEGER,
      source TEXT NOT NULL,
      evidence_id TEXT,
      evidence_fingerprint TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(evidence_id) REFERENCES canon_evidence(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canon_change_ledger_workspace ON canon_change_ledger(workspace_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_canon_change_ledger_anchor ON canon_change_ledger(anchor_id, sequence DESC);

    CREATE TABLE IF NOT EXISTS canon_evidence_usage (
      evidence_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      anchor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      operation TEXT NOT NULL,
      previous_value TEXT,
      next_value TEXT NOT NULL,
      previous_locked INTEGER,
      next_locked INTEGER NOT NULL,
      transition_fingerprint TEXT NOT NULL,
      ledger_sequence INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(evidence_id) REFERENCES canon_evidence(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canon_evidence_usage_anchor ON canon_evidence_usage(anchor_id, ledger_sequence DESC);

    CREATE TABLE IF NOT EXISTS canon_schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  ensureColumn(db, 'canon_evidence', 'approver_actor_id', 'TEXT');
  ensureColumn(db, 'canon_change_ledger', 'previous_locked', 'INTEGER');
  ensureColumn(db, 'canon_change_ledger', 'next_locked', 'INTEGER');
  ensureColumn(db, 'canon_change_ledger', 'approver_actor_id', 'TEXT');
  ensureColumn(db, 'canon_evidence_usage', 'source', 'TEXT');
  ensureColumn(db, 'canon_evidence_usage', 'approver_actor_id', 'TEXT');

  const migrateLegacyCanonLedger = db.transaction(() => {
    const applied = db.prepare(
      'SELECT 1 FROM canon_schema_migrations WHERE migration_id=?'
    ).get(LEGACY_CANON_LEDGER_MIGRATION);
    if (applied) return;

    db.prepare(`
      INSERT OR IGNORE INTO canon_change_ledger (
        change_id, workspace_id, anchor_id, kind, key, operation, previous_value,
        next_value, previous_locked, next_locked, source, evidence_id, evidence_fingerprint,
        created_at, approver_actor_id
      )
      SELECT
        'legacy_baseline:' || a.anchor_id,
        a.workspace_id,
        a.anchor_id,
        a.kind,
        a.key,
        'legacy_baseline',
        NULL,
        a.value,
        NULL,
        a.locked,
        'legacy-baseline',
        NULL,
        NULL,
        a.created_at,
        NULL
      FROM canon_anchors a
      WHERE NOT EXISTS (
        SELECT 1 FROM canon_change_ledger c WHERE c.anchor_id = a.anchor_id
      )
    `).run();
    db.prepare(
      'INSERT INTO canon_schema_migrations (migration_id, applied_at) VALUES (?, ?)'
    ).run(LEGACY_CANON_LEDGER_MIGRATION, now());
  });
  migrateLegacyCanonLedger();

  const ledgerGap = db.prepare(`
    SELECT a.anchor_id
    FROM canon_anchors a
    WHERE NOT EXISTS (
      SELECT 1 FROM canon_change_ledger c WHERE c.anchor_id = a.anchor_id
    )
    LIMIT 1
  `).get();
  if (ledgerGap) {
    throw new Error(
      `Canon ledger integrity violation: anchor ${ledgerGap.anchor_id} has no change history after ${LEGACY_CANON_LEDGER_MIGRATION}.`
    );
  }
}

function now() { return Date.now(); }

function transitionFingerprint({ workspace_id, anchor_id, kind, key, operation, previous_value, next_value, previous_locked, next_locked, source, approver_actor_id }) {
  return createHash('sha256').update(JSON.stringify({
    workspace_id: String(workspace_id),
    anchor_id: String(anchor_id),
    kind: String(kind),
    key: String(key),
    operation: String(operation),
    previous_value: previous_value == null ? null : String(previous_value),
    next_value: String(next_value),
    previous_locked: previous_locked == null ? null : Boolean(previous_locked),
    next_locked: Boolean(next_locked),
    source: String(source || ''),
    approver_actor_id: String(approver_actor_id || '')
  })).digest('hex');
}

function sameNullableValue(left, right) {
  const a = left == null ? null : String(left);
  const b = right == null ? null : String(right);
  return a === b;
}

function sameNullableLock(left, right) {
  const a = left == null ? null : Boolean(left);
  const b = right == null ? null : Boolean(right);
  return a === b;
}

function requireApproverActorId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error('Canon mutation requires a verified approver actor.');
  return normalized;
}

function assertStoredEvidenceIntegrity(db, evidence) {
  const existing = db.prepare('SELECT * FROM canon_evidence WHERE evidence_id=?').get(evidence?.evidence_id);
  if (!existing) return null;
  let recomputed;
  try {
    recomputed = fingerprintCanonEvidence(existing);
  } catch (error) {
    throw new Error(`Stored canon evidence is invalid: ${error.message}`);
  }
  if (existing.fingerprint !== recomputed || existing.fingerprint !== evidence.fingerprint) {
    throw new Error('Canon evidence is immutable: stored evidence does not match its fingerprint.');
  }
  return existing;
}

function persistCanonEvidence(db, evidence, { workspace_id, kind, key, value, approver_actor_id }) {
  if (!evidence) {
    throw new Error('Canon promotion requires explicit human evidence.');
  }
  const approverActorId = requireApproverActorId(approver_actor_id);
  assertCanonEvidenceWritable(evidence);
  if (evidence.workspace_id !== workspace_id || evidence.kind !== kind || evidence.key !== key) {
    throw new Error('Canon evidence scope does not match the anchor being written.');
  }
  if (String(evidence.statement) !== String(value)) {
    throw new Error('Canon evidence statement does not match the canon value being written.');
  }

  const existing = assertStoredEvidenceIntegrity(db, evidence);
  if (existing) {
    if (String(existing.approver_actor_id || '') !== approverActorId) {
      throw new Error('Canon evidence is immutable: stored approver does not match verified authority.');
    }
    return { evidence_id: existing.evidence_id, fingerprint: existing.fingerprint, approver_actor_id: approverActorId };
  }

  db.prepare(`
    INSERT INTO canon_evidence (
      evidence_id, workspace_id, kind, key, statement, source_ref, source_version,
      authority, confidence, fingerprint, established_at, created_at, approver_actor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidence.evidence_id,
    evidence.workspace_id,
    evidence.kind,
    evidence.key,
    evidence.statement,
    evidence.source_ref,
    evidence.source_version,
    evidence.authority,
    evidence.confidence,
    evidence.fingerprint,
    evidence.established_at,
    now(),
    approverActorId
  );
  return { evidence_id: evidence.evidence_id, fingerprint: evidence.fingerprint, approver_actor_id: approverActorId };
}

function latestAnchorSequence(db, anchor_id) {
  const row = db.prepare('SELECT MAX(sequence) AS sequence FROM canon_change_ledger WHERE anchor_id=?').get(anchor_id);
  return row?.sequence == null ? null : Number(row.sequence);
}

function idempotentEvidenceReplay(db, evidence, { workspace_id, kind, key, value, locked, source, approver_actor_id }) {
  if (!evidence?.evidence_id) return null;
  const approverActorId = requireApproverActorId(approver_actor_id);
  const storedEvidence = assertStoredEvidenceIntegrity(db, evidence);
  const usage = db.prepare('SELECT * FROM canon_evidence_usage WHERE evidence_id=?').get(evidence.evidence_id);
  if (!usage) {
    const legacyUse = db.prepare(
      'SELECT sequence FROM canon_change_ledger WHERE evidence_id=? ORDER BY sequence DESC LIMIT 1'
    ).get(evidence.evidence_id);
    if (legacyUse) {
      throw new Error('Canon evidence replay rejected: this evidence receipt was consumed before complete transition provenance binding was introduced.');
    }
    return null;
  }

  if (!storedEvidence) {
    throw new Error('Canon evidence replay rejected: persisted evidence record is missing.');
  }
  if (String(storedEvidence.approver_actor_id || '') !== approverActorId || String(usage.approver_actor_id || '') !== approverActorId) {
    throw new Error('Canon evidence replay rejected: verified approver binding does not match.');
  }
  if (String(usage.source || '') !== String(source || '')) {
    throw new Error('Canon evidence replay rejected: source provenance does not match.');
  }

  const recomputedTransition = transitionFingerprint({
    workspace_id: usage.workspace_id,
    anchor_id: usage.anchor_id,
    kind: usage.kind,
    key: usage.key,
    operation: usage.operation,
    previous_value: usage.previous_value,
    next_value: usage.next_value,
    previous_locked: usage.previous_locked,
    next_locked: usage.next_locked,
    source: usage.source,
    approver_actor_id: usage.approver_actor_id
  });
  if (usage.transition_fingerprint !== recomputedTransition) {
    throw new Error('Canon evidence replay rejected: transition binding failed integrity verification.');
  }

  const ledger = db.prepare(`
    SELECT sequence, evidence_id, evidence_fingerprint, anchor_id, workspace_id, kind, key,
           operation, previous_value, next_value, previous_locked, next_locked, source, approver_actor_id
    FROM canon_change_ledger
    WHERE sequence=?
  `).get(usage.ledger_sequence);
  const ledgerMatches = ledger
    && Number(ledger.sequence) === Number(usage.ledger_sequence)
    && ledger.evidence_id === evidence.evidence_id
    && ledger.evidence_fingerprint === storedEvidence.fingerprint
    && ledger.anchor_id === usage.anchor_id
    && ledger.workspace_id === usage.workspace_id
    && ledger.kind === usage.kind
    && ledger.key === usage.key
    && ledger.operation === usage.operation
    && sameNullableValue(ledger.previous_value, usage.previous_value)
    && String(ledger.next_value) === String(usage.next_value)
    && sameNullableLock(ledger.previous_locked, usage.previous_locked)
    && Boolean(ledger.next_locked) === Boolean(usage.next_locked)
    && String(ledger.source || '') === String(usage.source || '')
    && String(ledger.approver_actor_id || '') === String(usage.approver_actor_id || '');
  if (!ledgerMatches) {
    throw new Error('Canon evidence replay rejected: ledger binding failed integrity verification.');
  }

  const anchor = db.prepare(
    'SELECT anchor_id, workspace_id, kind, key, value, locked, source, created_at, updated_at FROM canon_anchors WHERE anchor_id=?'
  ).get(usage.anchor_id);
  const sameTarget = anchor
    && usage.workspace_id === workspace_id
    && usage.kind === kind
    && usage.key === key
    && anchor.workspace_id === usage.workspace_id
    && anchor.kind === usage.kind
    && anchor.key === usage.key
    && String(usage.next_value) === String(value)
    && Boolean(usage.next_locked) === Boolean(locked)
    && String(anchor.value) === String(value)
    && Boolean(anchor.locked) === Boolean(locked)
    && String(anchor.source || '') === String(usage.source || '')
    && latestAnchorSequence(db, usage.anchor_id) === Number(usage.ledger_sequence);

  if (sameTarget) {
    return { ...anchor, locked: Boolean(anchor.locked), idempotent: true };
  }
  throw new Error('Canon evidence replay rejected: evidence is already bound to a different or superseded mutation.');
}

function bindEvidenceUsage(db, evidence, transition) {
  const fingerprint = transitionFingerprint(transition);
  db.prepare(`
    INSERT INTO canon_evidence_usage (
      evidence_id, workspace_id, anchor_id, kind, key, operation, previous_value,
      next_value, previous_locked, next_locked, transition_fingerprint, ledger_sequence, created_at,
      source, approver_actor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    evidence.evidence_id,
    transition.workspace_id,
    transition.anchor_id,
    transition.kind,
    transition.key,
    transition.operation,
    transition.previous_value == null ? null : String(transition.previous_value),
    String(transition.next_value),
    transition.previous_locked == null ? null : (transition.previous_locked ? 1 : 0),
    transition.next_locked ? 1 : 0,
    fingerprint,
    now(),
    String(transition.source || ''),
    requireApproverActorId(transition.approver_actor_id)
  );
  return fingerprint;
}

function bindEvidenceLedgerSequence(db, evidence_id, sequence) {
  db.prepare('UPDATE canon_evidence_usage SET ledger_sequence=? WHERE evidence_id=?').run(sequence, evidence_id);
}

function recordCanonChange(db, {
  workspace_id,
  anchor_id,
  kind,
  key,
  operation,
  previous_value = null,
  next_value,
  previous_locked = null,
  next_locked,
  source,
  evidence = null,
  approver_actor_id,
  created_at
}) {
  const approverActorId = requireApproverActorId(approver_actor_id);
  const result = db.prepare(`
    INSERT INTO canon_change_ledger (
      change_id, workspace_id, anchor_id, kind, key, operation, previous_value,
      next_value, previous_locked, next_locked, source, evidence_id, evidence_fingerprint,
      created_at, approver_actor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `cc_${randomUUID()}`,
    workspace_id,
    anchor_id,
    kind,
    key,
    operation,
    previous_value == null ? null : String(previous_value),
    String(next_value),
    previous_locked == null ? null : (previous_locked ? 1 : 0),
    next_locked ? 1 : 0,
    source,
    evidence?.evidence_id || null,
    evidence?.fingerprint || null,
    created_at,
    approverActorId
  );
  return Number(result.lastInsertRowid);
}

// ─── Write ────────────────────────────────────────────────────────────────────

function writeCanonAnchor(db, {
  workspace_id,
  kind,
  key,
  value,
  locked = undefined,
  source = 'human',
  evidence = null,
  authority_grant = null,
  allow_lock_transition = false
}) {
  ensureSchema(db);
  if (source !== 'human') {
    throw new Error('Canon promotion requires explicit human authority. Non-human sources may propose evidence but may not write canon.');
  }
  const authority = assertCanonAuthorityGrant(authority_grant, workspace_id);
  const approverActorId = requireApproverActorId(authority.actor_id);

  const commit = db.transaction(() => {
    const existing = db.prepare(
      'SELECT anchor_id, locked, value FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
    ).get(workspace_id, kind, key);
    const t = now();

    if (existing) {
      const currentLocked = Boolean(existing.locked);
      const nextLocked = locked === undefined ? currentLocked : Boolean(locked);
      const replay = idempotentEvidenceReplay(db, evidence, {
        workspace_id,
        kind,
        key,
        value,
        locked: nextLocked,
        source,
        approver_actor_id: approverActorId
      });
      if (replay) return replay;
      const lockChanged = nextLocked !== currentLocked;
      if (lockChanged && !allow_lock_transition) {
        throw new Error('Canon lock transitions require the dedicated evidence-backed lock path; ordinary updates preserve the current lock state.');
      }
      const operation = lockChanged ? (nextLocked ? 'update_lock' : 'update_unlock') : 'update';

      persistCanonEvidence(db, evidence, { workspace_id, kind, key, value, approver_actor_id: approverActorId });
      bindEvidenceUsage(db, evidence, {
        workspace_id,
        anchor_id: existing.anchor_id,
        kind,
        key,
        operation,
        previous_value: existing.value,
        next_value: value,
        previous_locked: currentLocked,
        next_locked: nextLocked,
        source,
        approver_actor_id: approverActorId
      });
      db.prepare(
        'UPDATE canon_anchors SET value=?, locked=?, source=?, updated_at=? WHERE anchor_id=?'
      ).run(String(value), nextLocked ? 1 : 0, source, t, existing.anchor_id);
      const sequence = recordCanonChange(db, {
        workspace_id,
        anchor_id: existing.anchor_id,
        kind,
        key,
        operation,
        previous_value: existing.value,
        next_value: value,
        previous_locked: currentLocked,
        next_locked: nextLocked,
        source,
        evidence,
        approver_actor_id: approverActorId,
        created_at: t
      });
      bindEvidenceLedgerSequence(db, evidence.evidence_id, sequence);
      log(db, {
        workspace_id,
        mode: 'canon_memory',
        event_type: lockChanged
          ? (nextLocked ? 'canon.anchor.updated_and_locked' : 'canon.anchor.updated_and_unlocked')
          : 'canon.anchor.updated',
        payload: { kind, key, locked: nextLocked, source, evidence_id: evidence.evidence_id, approver_actor_id: approverActorId }
      });
      return { ...existing, value, locked: nextLocked, source, updated_at: t };
    }

    const nextLocked = Boolean(locked);
    const replay = idempotentEvidenceReplay(db, evidence, {
      workspace_id,
      kind,
      key,
      value,
      locked: nextLocked,
      source,
      approver_actor_id: approverActorId
    });
    if (replay) return replay;

    const anchor_id = `canon_${randomUUID()}`;
    persistCanonEvidence(db, evidence, { workspace_id, kind, key, value, approver_actor_id: approverActorId });
    bindEvidenceUsage(db, evidence, {
      workspace_id,
      anchor_id,
      kind,
      key,
      operation: 'create',
      previous_value: null,
      next_value: value,
      previous_locked: null,
      next_locked: nextLocked,
      source,
      approver_actor_id: approverActorId
    });
    db.prepare(
      `INSERT INTO canon_anchors (anchor_id, workspace_id, kind, key, value, locked, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(anchor_id, workspace_id, kind, key, String(value), nextLocked ? 1 : 0, source, t, t);
    const sequence = recordCanonChange(db, {
      workspace_id,
      anchor_id,
      kind,
      key,
      operation: 'create',
      next_value: value,
      previous_locked: null,
      next_locked: nextLocked,
      source,
      evidence,
      approver_actor_id: approverActorId,
      created_at: t
    });
    bindEvidenceLedgerSequence(db, evidence.evidence_id, sequence);
    log(db, {
      workspace_id,
      mode: 'canon_memory',
      event_type: 'canon.anchor.created',
      payload: { kind, key, locked: nextLocked, source, evidence_id: evidence.evidence_id, approver_actor_id: approverActorId }
    });
    return { anchor_id, workspace_id, kind, key, value, locked: nextLocked, source, created_at: t, updated_at: t };
  });

  return commit();
}

export function setCanonAnchor(db, input) {
  return writeCanonAnchor(db, input);
}

export function transitionCanonAnchor(db, input = {}) {
  if (input.locked !== true) {
    throw new Error('Composite canon transition supports explicit lock only; use unlockCanonAnchor to unlock.');
  }
  return writeCanonAnchor(db, { ...input, allow_lock_transition: true });
}

export function lockCanonAnchor(db, { workspace_id, kind, key, evidence = null, authority_grant = null }) {
  ensureSchema(db);
  const authority = assertCanonAuthorityGrant(authority_grant, workspace_id);
  const approverActorId = requireApproverActorId(authority.actor_id);
  const source = 'human';

  const commit = db.transaction(() => {
    const anchor = db.prepare(
      'SELECT anchor_id, locked, value FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
    ).get(workspace_id, kind, key);
    if (!anchor) throw new Error(`Canon anchor [${kind}/${key}] not found for workspace ${workspace_id}.`);

    if (anchor.locked) {
      if (evidence) {
        const replay = idempotentEvidenceReplay(db, evidence, {
          workspace_id,
          kind,
          key,
          value: anchor.value,
          locked: true,
          source,
          approver_actor_id: approverActorId
        });
        if (replay) {
          return { locked: true, already_locked: true, anchor_id: anchor.anchor_id, idempotent: true };
        }
      }
      return { locked: true, already_locked: true, anchor_id: anchor.anchor_id };
    }

    const replay = idempotentEvidenceReplay(db, evidence, {
      workspace_id,
      kind,
      key,
      value: anchor.value,
      locked: true,
      source,
      approver_actor_id: approverActorId
    });
    if (replay) {
      return { locked: true, already_locked: true, anchor_id: anchor.anchor_id, idempotent: true };
    }

    const t = now();
    persistCanonEvidence(db, evidence, { workspace_id, kind, key, value: anchor.value, approver_actor_id: approverActorId });
    bindEvidenceUsage(db, evidence, {
      workspace_id,
      anchor_id: anchor.anchor_id,
      kind,
      key,
      operation: 'lock',
      previous_value: anchor.value,
      next_value: anchor.value,
      previous_locked: false,
      next_locked: true,
      source,
      approver_actor_id: approverActorId
    });
    db.prepare('UPDATE canon_anchors SET locked=1, updated_at=? WHERE anchor_id=?').run(t, anchor.anchor_id);
    const sequence = recordCanonChange(db, {
      workspace_id,
      anchor_id: anchor.anchor_id,
      kind,
      key,
      operation: 'lock',
      previous_value: anchor.value,
      next_value: anchor.value,
      previous_locked: false,
      next_locked: true,
      source,
      evidence,
      approver_actor_id: approverActorId,
      created_at: t
    });
    bindEvidenceLedgerSequence(db, evidence.evidence_id, sequence);
    log(db, {
      workspace_id,
      mode: 'canon_memory',
      event_type: 'canon.anchor.locked',
      payload: { kind, key, evidence_id: evidence.evidence_id, approver_actor_id: approverActorId }
    });
    return { locked: true, already_locked: false, anchor_id: anchor.anchor_id };
  });

  return commit();
}

export function unlockCanonAnchor(db, { workspace_id, kind, key, evidence = null, authority_grant = null }) {
  ensureSchema(db);
  const authority = assertCanonAuthorityGrant(authority_grant, workspace_id);
  const approverActorId = requireApproverActorId(authority.actor_id);
  const source = 'human';

  const commit = db.transaction(() => {
    const anchor = db.prepare(
      'SELECT anchor_id, locked, value FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
    ).get(workspace_id, kind, key);
    if (!anchor) throw new Error(`Canon anchor [${kind}/${key}] not found for workspace ${workspace_id}.`);

    if (!anchor.locked) {
      if (evidence) {
        const replay = idempotentEvidenceReplay(db, evidence, {
          workspace_id,
          kind,
          key,
          value: anchor.value,
          locked: false,
          source,
          approver_actor_id: approverActorId
        });
        if (replay) {
          return { locked: false, already_unlocked: true, anchor_id: anchor.anchor_id, idempotent: true };
        }
      }
      return { locked: false, already_unlocked: true, anchor_id: anchor.anchor_id };
    }

    const replay = idempotentEvidenceReplay(db, evidence, {
      workspace_id,
      kind,
      key,
      value: anchor.value,
      locked: false,
      source,
      approver_actor_id: approverActorId
    });
    if (replay) {
      return { locked: false, already_unlocked: true, anchor_id: anchor.anchor_id, idempotent: true };
    }

    const t = now();
    persistCanonEvidence(db, evidence, { workspace_id, kind, key, value: anchor.value, approver_actor_id: approverActorId });
    bindEvidenceUsage(db, evidence, {
      workspace_id,
      anchor_id: anchor.anchor_id,
      kind,
      key,
      operation: 'unlock',
      previous_value: anchor.value,
      next_value: anchor.value,
      previous_locked: true,
      next_locked: false,
      source,
      approver_actor_id: approverActorId
    });
    db.prepare('UPDATE canon_anchors SET locked=0, updated_at=? WHERE anchor_id=?').run(t, anchor.anchor_id);
    const sequence = recordCanonChange(db, {
      workspace_id,
      anchor_id: anchor.anchor_id,
      kind,
      key,
      operation: 'unlock',
      previous_value: anchor.value,
      next_value: anchor.value,
      previous_locked: true,
      next_locked: false,
      source,
      evidence,
      approver_actor_id: approverActorId,
      created_at: t
    });
    bindEvidenceLedgerSequence(db, evidence.evidence_id, sequence);
    log(db, {
      workspace_id,
      mode: 'canon_memory',
      event_type: 'canon.anchor.unlocked',
      payload: { kind, key, evidence_id: evidence.evidence_id, approver_actor_id: approverActorId }
    });
    return { locked: false, already_unlocked: false, anchor_id: anchor.anchor_id };
  });

  return commit();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function listCanonAnchors(db, workspace_id, kind = null) {
  ensureSchema(db);
  if (kind) {
    return db.prepare('SELECT * FROM canon_anchors WHERE workspace_id=? AND kind=? ORDER BY kind, key').all(workspace_id, kind);
  }
  return db.prepare('SELECT * FROM canon_anchors WHERE workspace_id=? ORDER BY kind, key').all(workspace_id);
}

export function getCanonAnchor(db, workspace_id, kind, key) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?').get(workspace_id, kind, key) || null;
}

export function getCanonEvidence(db, workspace_id, evidence_id) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM canon_evidence WHERE workspace_id=? AND evidence_id=?').get(workspace_id, evidence_id) || null;
}

export function listCanonChanges(db, workspace_id, { anchor_id = null, limit = 100 } = {}) {
  ensureSchema(db);
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const rows = anchor_id
    ? db.prepare(`
        SELECT c.*, e.statement AS evidence_statement, e.source_ref AS evidence_source_ref,
               e.source_version AS evidence_source_version, e.authority AS evidence_authority,
               e.confidence AS evidence_confidence, e.established_at AS evidence_established_at,
               e.approver_actor_id AS evidence_approver_actor_id
        FROM canon_change_ledger c
        LEFT JOIN canon_evidence e ON e.evidence_id=c.evidence_id AND e.workspace_id=c.workspace_id
        WHERE c.workspace_id=? AND c.anchor_id=?
        ORDER BY c.sequence DESC
        LIMIT ?
      `).all(workspace_id, anchor_id, boundedLimit)
    : db.prepare(`
        SELECT c.*, e.statement AS evidence_statement, e.source_ref AS evidence_source_ref,
               e.source_version AS evidence_source_version, e.authority AS evidence_authority,
               e.confidence AS evidence_confidence, e.established_at AS evidence_established_at,
               e.approver_actor_id AS evidence_approver_actor_id
        FROM canon_change_ledger c
        LEFT JOIN canon_evidence e ON e.evidence_id=c.evidence_id AND e.workspace_id=c.workspace_id
        WHERE c.workspace_id=?
        ORDER BY c.sequence DESC
        LIMIT ?
      `).all(workspace_id, boundedLimit);
  return rows;
}

export function canonSnapshot(db, workspace_id) {
  ensureSchema(db);
  const anchors = listCanonAnchors(db, workspace_id);
  const byKind = {};
  for (const a of anchors) {
    if (!byKind[a.kind]) byKind[a.kind] = {};
    byKind[a.kind][a.key] = { value: a.value, locked: Boolean(a.locked), source: a.source };
  }
  return {
    workspace_id,
    anchor_count: anchors.length,
    locked_count: anchors.filter(a => a.locked).length,
    kinds: Object.keys(byKind),
    anchors: byKind
  };
}

// ─── Redteam Gate ─────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectViolation(anchor, draft) {
  const text = String(draft || '');
  const violations = [];

  if (anchor.kind === 'world_rule') {
    const ruleWords = anchor.value.split(/\s+/).filter(w => w.length > 4);
    for (const word of ruleWords) {
      const negPattern = new RegExp(`\\b(?:not|no|never|cannot|can't)\\s+${escapeRegex(word)}\\b`, 'i');
      if (negPattern.test(text)) {
        violations.push({
          severity: 'warning',
          code: 'canon_world_rule_possible_contradiction',
          message: `Draft may contradict world rule [${anchor.key}]: "${anchor.value}". Found negation of "${word}".`
        });
      }
    }
  }

  if (anchor.kind === 'character' && anchor.key.includes('name')) {
    const name = anchor.value.trim();
    if (name && !new RegExp(`\\b${escapeRegex(name)}\\b`, 'i').test(text)) {
      if (text.split(/\s+/).length > 80) {
        violations.push({
          severity: 'info',
          code: 'canon_character_absent',
          message: `Character "${name}" does not appear in this draft unit. Verify this is intentional.`
        });
      }
    }
  }

  if (anchor.kind === 'tone_constant') {
    violations.push({
      severity: 'info',
      code: 'canon_tone_reminder',
      message: `Tone constant [${anchor.key}]: "${anchor.value}" — verify draft maintains this tone.`
    });
  }

  return violations;
}

export function evaluateCanonFit(db, workspace_id, draft) {
  ensureSchema(db);
  const anchors = listCanonAnchors(db, workspace_id);
  if (!anchors.length) return { passed: true, anchor_count: 0, findings: [], note: 'No canon anchors established yet.' };

  const findings = [];
  for (const anchor of anchors) {
    findings.push(...detectViolation(anchor, draft));
  }

  const criticals = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');
  const t = now();
  const insert = db.prepare(
    `INSERT INTO canon_violations (violation_id, workspace_id, anchor_id, kind, key, expected, found, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of findings.filter(f => f.severity !== 'info')) {
    const anchor = anchors.find(a => f.message.includes(a.key)) || anchors[0];
    insert.run(`cv_${randomUUID()}`, workspace_id, anchor.anchor_id, anchor.kind, anchor.key, anchor.value, draft.slice(0, 200), f.severity, t);
  }

  if (findings.length) {
    log(db, { workspace_id, mode: 'canon_memory', event_type: 'canon.redteam.evaluated', payload: { anchor_count: anchors.length, findings: findings.length, criticals: criticals.length, warnings: warnings.length } });
  }

  return {
    passed: criticals.length === 0,
    anchor_count: anchors.length,
    critical_count: criticals.length,
    warning_count: warnings.length,
    findings
  };
}

export function listCanonViolations(db, workspace_id, { limit = 50, resolved = false } = {}) {
  ensureSchema(db);
  return db.prepare(
    'SELECT * FROM canon_violations WHERE workspace_id=? AND resolved=? ORDER BY created_at DESC LIMIT ?'
  ).all(workspace_id, resolved ? 1 : 0, limit);
}
