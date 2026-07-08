import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
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

test('Operator default Assist Mode starts Human-First', () => {
  const db = createDb();
  assert.equal(getOperatorAssistDefault(db).default_assist_mode, 'human_first');
  db.close();
});

test('new workspace inherits Operator default Assist Mode', () => {
  const db = createDb();
  setOperatorAssistDefault(db, 'system_first');
  const profile = getWorkspaceAssist(db, 'workspace-a');
  assert.equal(profile.assist_mode, 'system_first');
  assert.equal(profile.permissions.primary_author, 'l99');
  assert.equal(profile.permissions.may_overwrite_human_text, false);
  db.close();
});

test('Human-First forbids autonomous overwrite', () => {
  const db = createDb();
  const profile = setWorkspaceAssist(db, 'workspace-b', { assist_mode: 'human_first' });
  assert.equal(profile.permissions.primary_author, 'human');
  assert.equal(profile.permissions.may_draft_without_request, false);
  assert.equal(profile.permissions.requires_accept_for_changes, true);
  assert.throws(() => setWorkspaceAssist(db, 'workspace-b', {
    overwrite_policy: 'automatic'
  }), /may not overwrite human text/i);
  db.close();
});

test('Assist contributions track human and L99 authorship', () => {
  const db = createDb();
  recordAssistContribution(db, {
    workspace_id: 'workspace-c',
    source: 'human',
    action: 'drafted',
    accepted_text: 'The moon slept beneath the street.'
  });
  recordAssistContribution(db, {
    workspace_id: 'workspace-c',
    source: 'l99',
    action: 'suggested',
    proposed_text: 'The pavement hummed above it.'
  });
  const rows = listAssistContributions(db, 'workspace-c');
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.source === 'human'));
  assert.ok(rows.some(row => row.source === 'l99'));
  db.close();
});
