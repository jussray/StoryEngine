// lib/canonMemory.js
// Canon Memory Engine — persists story facts across runs, chapters, and sessions.
// Characters, world rules, tone constants, and unbreakable facts live here.
// Redteam imports evaluateCanonFit() to gate drafts before passing.

import { randomUUID } from 'node:crypto';
import './sqliteTransaction.js';
import { log } from '../models/eventModel.js';
import { assertCanonEvidenceWritable } from './canonEvidence.js';

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
      source TEXT NOT NULL,
      evidence_id TEXT,
      evidence_fingerprint TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(evidence_id) REFERENCES canon_evidence(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canon_change_ledger_workspace ON canon_change_ledger(workspace_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_canon_change_ledger_anchor ON canon_change_ledger(anchor_id, sequence DESC);
  `);
}

function now() { return Date.now(); }

function persistCanonEvidence(db, evidence, { workspace_id, kind, key, value }) {
  if (!evidence) {
    throw new Error('Canon promotion requires explicit human evidence.');
  }
  assertCanonEvidenceWritable(evidence);
  if (evidence.workspace_id !== workspace_id || evidence.kind !== kind || evidence.key !== key) {
    throw new Error('Canon evidence scope does not match the anchor being written.');
  }
  if (String(evidence.statement) !== String(value)) {
    throw new Error('Canon evidence statement does not match the canon value being written.');
  }

  const existing = db.prepare(
    'SELECT evidence_id, fingerprint FROM canon_evidence WHERE evidence_id=?'
  ).get(evidence.evidence_id);
  if (existing) {
    if (existing.fingerprint !== evidence.fingerprint) {
      throw new Error('Canon evidence is immutable: evidence_id already exists with a different fingerprint.');
    }
    return existing;
  }

  db.prepare(`
    INSERT INTO canon_evidence (
      evidence_id, workspace_id, kind, key, statement, source_ref, source_version,
      authority, confidence, fingerprint, established_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    now()
  );
  return { evidence_id: evidence.evidence_id, fingerprint: evidence.fingerprint };
}

function recordCanonChange(db, { workspace_id, anchor_id, kind, key, operation, previous_value = null, next_value, source, evidence = null, created_at }) {
  db.prepare(`
    INSERT INTO canon_change_ledger (
      change_id, workspace_id, anchor_id, kind, key, operation, previous_value,
      next_value, source, evidence_id, evidence_fingerprint, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `cc_${randomUUID()}`,
    workspace_id,
    anchor_id,
    kind,
    key,
    operation,
    previous_value == null ? null : String(previous_value),
    String(next_value),
    source,
    evidence?.evidence_id || null,
    evidence?.fingerprint || null,
    created_at
  );
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function setCanonAnchor(db, { workspace_id, kind, key, value, locked = false, source = 'human', evidence = null }) {
  ensureSchema(db);
  if (source !== 'human') {
    throw new Error('Canon promotion requires explicit human authority. Non-human sources may propose evidence but may not write canon.');
  }

  const commit = db.transaction(() => {
    const existing = db.prepare(
      'SELECT anchor_id, locked, value FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
    ).get(workspace_id, kind, key);
    const t = now();
    persistCanonEvidence(db, evidence, { workspace_id, kind, key, value });

    if (existing) {
      db.prepare(
        'UPDATE canon_anchors SET value=?, locked=?, source=?, updated_at=? WHERE anchor_id=?'
      ).run(String(value), locked ? 1 : 0, source, t, existing.anchor_id);
      recordCanonChange(db, {
        workspace_id,
        anchor_id: existing.anchor_id,
        kind,
        key,
        operation: 'update',
        previous_value: existing.value,
        next_value: value,
        source,
        evidence,
        created_at: t
      });
      log(db, {
        workspace_id,
        mode: 'canon_memory',
        event_type: 'canon.anchor.updated',
        payload: { kind, key, locked, source, evidence_id: evidence.evidence_id }
      });
      return { ...existing, value, locked, source, updated_at: t };
    }

    const anchor_id = `canon_${randomUUID()}`;
    db.prepare(
      `INSERT INTO canon_anchors (anchor_id, workspace_id, kind, key, value, locked, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(anchor_id, workspace_id, kind, key, String(value), locked ? 1 : 0, source, t, t);
    recordCanonChange(db, {
      workspace_id,
      anchor_id,
      kind,
      key,
      operation: 'create',
      next_value: value,
      source,
      evidence,
      created_at: t
    });
    log(db, {
      workspace_id,
      mode: 'canon_memory',
      event_type: 'canon.anchor.created',
      payload: { kind, key, locked, source, evidence_id: evidence.evidence_id }
    });
    return { anchor_id, workspace_id, kind, key, value, locked, source, created_at: t, updated_at: t };
  });

  return commit();
}

export function lockCanonAnchor(db, { workspace_id, kind, key, evidence = null }) {
  ensureSchema(db);

  const commit = db.transaction(() => {
    const anchor = db.prepare(
      'SELECT anchor_id, locked, value FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
    ).get(workspace_id, kind, key);
    if (!anchor) throw new Error(`Canon anchor [${kind}/${key}] not found for workspace ${workspace_id}.`);

    if (anchor.locked) {
      return { locked: true, already_locked: true, anchor_id: anchor.anchor_id };
    }

    const t = now();
    persistCanonEvidence(db, evidence, { workspace_id, kind, key, value: anchor.value });
    db.prepare('UPDATE canon_anchors SET locked=1, updated_at=? WHERE anchor_id=?').run(t, anchor.anchor_id);
    recordCanonChange(db, {
      workspace_id,
      anchor_id: anchor.anchor_id,
      kind,
      key,
      operation: 'lock',
      previous_value: anchor.value,
      next_value: anchor.value,
      source: 'human',
      evidence,
      created_at: t
    });
    log(db, {
      workspace_id,
      mode: 'canon_memory',
      event_type: 'canon.anchor.locked',
      payload: { kind, key, evidence_id: evidence.evidence_id }
    });
    return { locked: true, already_locked: false, anchor_id: anchor.anchor_id };
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

export function getCanonEvidence(db, evidence_id) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM canon_evidence WHERE evidence_id=?').get(evidence_id) || null;
}

export function listCanonChanges(db, workspace_id, { anchor_id = null, limit = 100 } = {}) {
  ensureSchema(db);
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const rows = anchor_id
    ? db.prepare(`
        SELECT c.*, e.statement AS evidence_statement, e.source_ref AS evidence_source_ref,
               e.source_version AS evidence_source_version, e.authority AS evidence_authority,
               e.confidence AS evidence_confidence, e.established_at AS evidence_established_at
        FROM canon_change_ledger c
        LEFT JOIN canon_evidence e ON e.evidence_id=c.evidence_id
        WHERE c.workspace_id=? AND c.anchor_id=?
        ORDER BY c.sequence DESC
        LIMIT ?
      `).all(workspace_id, anchor_id, boundedLimit)
    : db.prepare(`
        SELECT c.*, e.statement AS evidence_statement, e.source_ref AS evidence_source_ref,
               e.source_version AS evidence_source_version, e.authority AS evidence_authority,
               e.confidence AS evidence_confidence, e.established_at AS evidence_established_at
        FROM canon_change_ledger c
        LEFT JOIN canon_evidence e ON e.evidence_id=c.evidence_id
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
