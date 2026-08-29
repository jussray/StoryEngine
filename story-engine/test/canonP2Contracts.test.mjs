import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const canon = readFileSync(join(here, '../lib/canonMemory.js'), 'utf8');
const source = readFileSync(join(here, '../lib/sourceCanon.js'), 'utf8');
const skill = readFileSync(join(here, '../../.agents/skills/l99-operator/SKILL.md'), 'utf8');

test('fresh P2 canon contracts stay explicit', () => {
  assert.match(canon, /legacy_baseline:/);
  assert.match(canon, /export function transitionCanonAnchor/);
  assert.match(canon, /export function unlockCanonAnchor/);
  assert.match(canon, /operation: 'unlock'/);
  assert.match(source, /expectedSourceRefPrefix/);
  assert.match(source, /transitionCanonAnchor/);
  assert.match(source, /Proposal approval cannot unlock canon/);
  assert.match(skill, /l99\.work-fingerprint\.v1/);
  assert.match(skill, /No key is omitted/);
  assert.match(skill, /sort by `ref` and then `status`/);
});
