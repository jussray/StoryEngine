import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ASSIST_MODES,
  getOperatorAssistDefault,
  setOperatorAssistDefault,
  getWorkspaceAssist,
  setWorkspaceAssist,
  recordAssistContribution,
  listAssistContributions
} from '../lib/assistMode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('Assist Mode exposes four creative roles', () => {
  assert.deepEqual(ASSIST_MODES, ['writer', 'co_writer', 'director', 'autonomous_studio']);
});

test('Operator default starts in Writer mode', () => {
  const db = createDb();
  assert.equal(getOperatorAssistDefault(db).default_assist_mode, 'writer');
  db.close();
});

test('new workspace inherits the Operator creative role', () => {
  const db = createDb();
  setOperatorAssistDefault(db, 'autonomous_studio');
  const profile = getWorkspaceAssist(db, 'workspace-a');
  assert.equal(profile.assist_mode, 'autonomous_studio');
  assert.equal(profile.permissions.primary_author, 'l99');
  assert.equal(profile.permissions.may_run_full_pipeline, true);
  assert.equal(profile.permissions.requires_accept_for_release, true);
  db.close();
});

test('Writer mode keeps the human as primary author', () => {
  const db = createDb();
  const profile = setWorkspaceAssist(db, 'workspace-b', { assist_mode: 'writer' });
  assert.equal(profile.permissions.primary_author, 'human');
  assert.equal(profile.permissions.may_draft_without_request, false);
  assert.equal(profile.permissions.requires_accept_for_changes, true);
  assert.throws(() => setWorkspaceAssist(db, 'workspace-b', {
    overwrite_policy: 'automatic'
  }), /may not overwrite human text/i);
  db.close();
});

test('Co-Writer mode is shared but still acceptance-gated', () => {
  const db = createDb();
  const profile = setWorkspaceAssist(db, 'workspace-c', { assist_mode: 'co_writer' });
  assert.equal(profile.permissions.primary_author, 'shared');
  assert.equal(profile.permissions.collaboration, 'shared_drafting');
  assert.equal(profile.permissions.requires_accept_for_changes, true);
  assert.equal(profile.permissions.may_overwrite_human_text, false);
  db.close();
});

test('Director mode lets L99 draft without granting release autonomy', () => {
  const db = createDb();
  const profile = setWorkspaceAssist(db, 'workspace-d', { assist_mode: 'director' });
  assert.equal(profile.permissions.primary_author, 'l99');
  assert.equal(profile.permissions.may_draft_without_request, true);
  assert.equal(profile.permissions.may_run_full_pipeline, false);
  assert.equal(profile.permissions.stops_before_release_gate, true);
  db.close();
});

test('legacy two-mode values migrate to Writer and Director', () => {
  const db = createDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_assist_settings (
      profile_id TEXT PRIMARY KEY,
      default_assist_mode TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT OR REPLACE INTO operator_assist_settings VALUES ('primary', 'system_first', 1);
  `);
  assert.equal(getOperatorAssistDefault(db).default_assist_mode, 'director');
  db.close();
});

test('Assist contributions track human, L99, and shared authorship', () => {
  const db = createDb();
  recordAssistContribution(db, {
    workspace_id: 'workspace-e',
    source: 'human',
    action: 'drafted',
    accepted_text: 'The moon slept beneath the street.'
  });
  recordAssistContribution(db, {
    workspace_id: 'workspace-e',
    source: 'l99',
    action: 'suggested',
    proposed_text: 'The pavement hummed above it.'
  });
  recordAssistContribution(db, {
    workspace_id: 'workspace-e',
    source: 'shared',
    action: 'co_written',
    accepted_text: 'Together they rewrote the night.'
  });
  const rows = listAssistContributions(db, 'workspace-e');
  assert.equal(rows.length, 3);
  assert.ok(rows.some(row => row.source === 'human'));
  assert.ok(rows.some(row => row.source === 'l99'));
  assert.ok(rows.some(row => row.source === 'shared'));
  db.close();
});
