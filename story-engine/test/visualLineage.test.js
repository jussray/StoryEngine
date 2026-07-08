import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';
import { buildProductionPack } from '../lib/ipStudio.js';
import { buildCampaignPack, CAMPAIGN_PLATFORMS } from '../lib/campaignStudio.js';
import { attachCreditsToCampaign, attachCreditsToProductionPack, buildVisualEndCredit } from '../lib/visualLineage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function dbWithBook() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const workspaceId = Story.create(db, { title: 'Little Cloud Garden', genre: 'educational', pitch: 'A cloud learns rain helps flowers grow.' });
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'A cloud learns rain helps flowers grow.',
    story_kind: 'educational', emotional_effect: 'wonder', medium: 'picture_book', audience: 'eli5', goal: 'entertain_and_teach'
  });
  Chapter.create(db, workspaceId, { title: 'Cloud Hides', content: 'Cloud hid while the flowers waited for rain.', position: 0 });
  Chapter.create(db, workspaceId, { title: 'Cloud Helps', content: 'Cloud rained and the garden grew.', position: 1 });
  return { db, workspaceId };
}

test('campaign platforms include Facebook Reels and independent platform versions', () => {
  assert.ok(CAMPAIGN_PLATFORMS.includes('facebook_reels'));
  const { db, workspaceId } = dbWithBook();
  const pack = buildProductionPack(db, workspaceId, { target_medium: 'animated_short' });
  const campaign = buildCampaignPack(db, workspaceId, { production_pack_id: pack.pack_id });
  assert.equal(campaign.clips.length, 4);
  assert.equal(new Set(campaign.clips.map(item => item.platform_version)).size, 4);
  assert.ok(campaign.clips.every(item => item.clip.render_plan.own_platform_render === true));
  db.close();
});

test('every visual product receives a source-book and version end credit', () => {
  const { db, workspaceId } = dbWithBook();
  const pack = attachCreditsToProductionPack(buildProductionPack(db, workspaceId, { target_medium: 'movie' }));
  assert.match(pack.pack.end_credit.text.based_on, /Little Cloud Garden/);
  assert.equal(pack.pack.end_credit.required, true);

  const campaign = attachCreditsToCampaign(buildCampaignPack(db, workspaceId, { production_pack_id: pack.pack_id }));
  assert.ok(campaign.clips.every(item => item.clip.end_credit.required));
  assert.ok(campaign.clips.every(item => item.clip.end_credit.text.based_on.includes('Little Cloud Garden')));
  assert.equal(new Set(campaign.clips.map(item => item.clip.end_credit.text.visual_version)).size, 4);
  db.close();
});

test('credit line records machine-readable lineage', () => {
  const credit = buildVisualEndCredit({
    title: 'Book One', blueprintId: 'blueprint_1', sourceVersion: 'book:v2', platformVersion: 'book:v2:tiktok:v1'
  });
  assert.equal(credit.text.based_on, 'Based on “Book One”');
  assert.equal(credit.lineage.source_version, 'book:v2');
  assert.equal(credit.lineage.platform_version, 'book:v2:tiktok:v1');
  assert.match(credit.machine_tag, /blueprint_1/);
});
