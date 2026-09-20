import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { createStoryVideoJob, getStoryVideoJob } from '../lib/videoEngine.js';
import {
  VIDEO_CONTINUITY_COOKIE_CONTRACT,
  VIDEO_PROOF_COOKIE_CONTRACT,
  classifyReceiptContinuity,
  createContinuityCookie,
  createProofCookie,
  ensureStoryVideoContinuityGate,
  verifyContinuityCookie
} from '../lib/videoContinuity.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

function job(overrides = {}) {
  return {
    job_id: 'video_job_test',
    workspace_id: 'workspace-a',
    source_revision_id: 'source-revision-a',
    blueprint: {
      target_mode: 'live_action',
      visual_style: 'cinematic_realism',
      aspect_ratio: '16:9',
      character_bible: [{ character_id: 'lead', name: 'Lead', locked_visuals: ['dark raincoat'] }],
      world_bible: { palette: 'cool rain + amber practicals' },
      shots: [{
        shot_id: 'shot_01',
        duration_seconds: 10,
        shot_command: '/dolly-in Lead',
        provider_prompt: 'Lead walks through rain.',
        must_preserve: ['same face', 'same coat'],
        negative_constraints: ['identity drift'],
        shot_direction: { opening_frame: 'under awning', ending_frame: 'at doorway' }
      }],
      ...overrides.blueprint
    },
    ...overrides
  };
}

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id,title,genre,pitch) VALUES (?,?,?,?)`)
    .run('workspace-continuity', 'Violet Door', 'fantasy', 'Mina crosses a storm toward a glowing door.');
  db.prepare(`INSERT INTO chapters (workspace_id,chapter_id,title,content,position) VALUES (?,?,?,?,?)`)
    .run('workspace-continuity', 'chapter-1', 'Storm', 'Mina crosses the street. Mina reaches for the glowing door.', 0);
  db.prepare(`INSERT INTO memory_characters (workspace_id,char_id,name,role,traits,data_json) VALUES (?,?,?,?,?,?)`)
    .run('workspace-continuity', 'mina', 'Mina', 'protagonist', JSON.stringify(['brave']), JSON.stringify({ locked_visuals: ['yellow raincoat'] }));
  return db;
}

test('continuity cookie is deterministic, non-secret and non-authorizing', () => {
  const first = createContinuityCookie(job());
  const second = createContinuityCookie(job());
  assert.equal(first.contract, VIDEO_CONTINUITY_COOKIE_CONTRACT);
  assert.equal(first.value, second.value);
  assert.match(first.value, /^lvz_cc_[0-9a-f]{24}$/);
  assert.equal(first.secret, false);
  assert.equal(first.authority, 'none');
  assert.equal(verifyContinuityCookie(job(), first).matches, true);
  assert.equal(verifyContinuityCookie(job(), first).authority_granted, false);
});

test('editing canon or a shot invalidates the prior continuity cookie', () => {
  const original = job();
  const cookie = createContinuityCookie(original);
  const edited = job({ blueprint: {
    ...original.blueprint,
    shots: [{ ...original.blueprint.shots[0], shot_command: '/reaction Lead' }]
  }});
  const result = verifyContinuityCookie(edited, cookie.value);
  assert.equal(result.matches, false);
  assert.equal(result.stale, true);
  assert.equal(result.authority_granted, false);
});

test('proof cookie binds output evidence to the current continuity cookie without granting authority', () => {
  const current = job();
  const continuity = createContinuityCookie(current);
  const proof = createProofCookie(current, {
    evidence_class: 'rendered_open_weight_video',
    output_sha256: 'a'.repeat(64),
    renderer: 'comfyui_open_weight_video_v1',
    workflow_sha256: 'b'.repeat(64),
    media_probe: { verified: true, duration_seconds: 10 }
  });
  assert.equal(proof.contract, VIDEO_PROOF_COOKIE_CONTRACT);
  assert.equal(proof.continuity_cookie, continuity.value);
  assert.match(proof.value, /^lvz_pc_[0-9a-f]{24}$/);
  assert.equal(proof.authority, 'none');

  const state = classifyReceiptContinuity(current, { continuity_cookie: continuity.value });
  assert.equal(state.receipt_status, 'CURRENT');
  assert.equal(state.invalidates_old_green, false);
});

test('new evidence marks an old receipt stale instead of preserving false green state', () => {
  const original = job();
  const oldCookie = createContinuityCookie(original).value;
  const revised = job({ source_revision_id: 'source-revision-b' });
  const state = classifyReceiptContinuity(revised, { continuity_cookie: oldCookie });
  assert.equal(state.receipt_status, 'STALE');
  assert.equal(state.invalidates_old_green, true);
  assert.equal(state.authority_granted, false);
});

test('structural continuity migration rewrites authoritative prompts, invalidates old proof, and is idempotent', () => {
  const db = fixtureDb();
  try {
    const created = createStoryVideoJob(db, {
      workspace_id: 'workspace-continuity',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      action_beats: [
        'Mina crosses the rain-soaked street.',
        'Mina reaches for the glowing door.'
      ]
    });
    const before = getStoryVideoJob(db, created.job_id);
    const beforeCookie = createContinuityCookie(before).value;
    assert.notEqual(
      before.blueprint.shots[1].shot_direction.opening_frame,
      before.blueprint.shots[0].shot_direction.ending_frame
    );

    const migrated = ensureStoryVideoContinuityGate(db, created.job_id);
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.gate.ready_for_render, true);
    const after = getStoryVideoJob(db, created.job_id);
    assert.equal(
      after.blueprint.shots[1].shot_direction.opening_frame,
      after.blueprint.shots[0].shot_direction.ending_frame
    );
    assert.match(
      after.blueprint.shots[1].provider_prompt,
      new RegExp(`OPENING FRAME: ${after.blueprint.shots[0].shot_direction.ending_frame.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    assert.equal(after.blueprint.continuity_gate_migration.reason, 'authoritative_shot_runtime_normalized');
    assert.equal(after.blueprint.continuity_gate_migration.invalidates_prior_render_proof, true);
    const afterCookie = createContinuityCookie(after).value;
    assert.notEqual(afterCookie, beforeCookie);

    const second = ensureStoryVideoContinuityGate(db, created.job_id);
    assert.equal(second.migrated, false);
    assert.equal(createContinuityCookie(second.job).value, afterCookie);
  } finally {
    db.close();
  }
});
