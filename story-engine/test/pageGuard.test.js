import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_PAGES, OPERATOR_PAGES } from '../lib/pageGuard.js';

test('creator pages include the core story flow', () => {
  assert.ok(CREATOR_PAGES.has('/front_door.html'));
  assert.ok(CREATOR_PAGES.has('/story_engine.html'));
  assert.ok(CREATOR_PAGES.has('/chapters.html'));
  assert.ok(CREATOR_PAGES.has('/studio.html'));
  assert.ok(CREATOR_PAGES.has('/ip_studio.html'));
});

test('operator pages include all backstage dashboards', () => {
  assert.ok(OPERATOR_PAGES.has('/control_room.html'));
  assert.ok(OPERATOR_PAGES.has('/ooda_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/lindymode_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/decision_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/performance_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/runtime_dashboard.html'));
  assert.ok(OPERATOR_PAGES.has('/release_gate.html'));
});

test('no page appears in both sets', () => {
  for (const page of CREATOR_PAGES) {
    assert.ok(!OPERATOR_PAGES.has(page), `${page} is in both sets`);
  }
});
