// lib/canonMemory.js
// Canon Memory Engine — persists story facts across runs, chapters, and sessions.
// Characters, world rules, tone constants, and unbreakable facts live here.
// Redteam imports evaluateCanonFit() to gate drafts before passing.

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';

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
  `);
}

function now() { return Date.now(); }

// ─── Write ────────────────────────────────────────────────────────────────────

export function setCanonAnchor(db, { workspace_id, kind, key, value, locked = false, source = 'human' }) {
  ensureSchema(db);
  const existing = db.prepare(
    'SELECT anchor_id, locked FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
  ).get(workspace_id, kind, key);

  if (existing && existing.locked && source !== 'human') {
    throw new Error(`Canon anchor [${kind}/${key}] is locked and cannot be overwritten by source: ${source}.`);
  }

  const t = now();
  if (existing) {
    db.prepare(
      'UPDATE canon_anchors SET value=?, locked=?, source=?, updated_at=? WHERE anchor_id=?'
    ).run(String(value), locked ? 1 : 0, source, t, existing.anchor_id);
    log(db, { workspace_id, mode: 'canon_memory', event_type: 'canon.anchor.updated', payload: { kind, key, locked, source } });
    return { ...existing, value, locked, source, updated_at: t };
  }

  const anchor_id = `canon_${randomUUID()}`;
  db.prepare(
    `INSERT INTO canon_anchors (anchor_id, workspace_id, kind, key, value, locked, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(anchor_id, workspace_id, kind, key, String(value), locked ? 1 : 0, source, t, t);
  log(db, { workspace_id, mode: 'canon_memory', event_type: 'canon.anchor.created', payload: { kind, key, locked, source } });
  return { anchor_id, workspace_id, kind, key, value, locked, source, created_at: t, updated_at: t };
}

export function lockCanonAnchor(db, { workspace_id, kind, key }) {
  ensureSchema(db);
  const anchor = db.prepare(
    'SELECT anchor_id FROM canon_anchors WHERE workspace_id=? AND kind=? AND key=?'
  ).get(workspace_id, kind, key);
  if (!anchor) throw new Error(`Canon anchor [${kind}/${key}] not found for workspace ${workspace_id}.`);
  db.prepare('UPDATE canon_anchors SET locked=1, updated_at=? WHERE anchor_id=?').run(now(), anchor.anchor_id);
  log(db, { workspace_id, mode: 'canon_memory', event_type: 'canon.anchor.locked', payload: { kind, key } });
  return { locked: true };
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

const KIND_PATTERNS = {
  character: (key, value) => [
    { pattern: new RegExp(`\\b${escapeRegex(key)}\\b`, 'i'), field: 'name' }
  ]
};

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectViolation(anchor, draft) {
  const text = String(draft || '');
  const violations = [];

  if (anchor.kind === 'world_rule') {
    // World rules are free-text assertions. We check the draft doesn't directly contradict them
    // using a simple keyword negation heuristic: if the rule contains a noun and the draft
    // has "not [noun]" or "no [noun]" nearby, flag for human review.
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
    // Character names: if the stored name doesn't appear at all, flag possible rename.
    const name = anchor.value.trim();
    if (name && !new RegExp(`\\b${escapeRegex(name)}\\b`, 'i').test(text)) {
      // Only flag if the draft is long enough to be expected to mention the character.
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
    // Tone constants: stored as a keyword (e.g. "hopeful", "gritty"). We don't auto-check prose tone —
    // just surface the constant in the Redteam report for human verification.
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
    const violations = detectViolation(anchor, draft);
    findings.push(...violations);
  }

  const criticals = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');

  // Persist violations for audit
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
