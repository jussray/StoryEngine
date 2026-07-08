// lib/visualLineage.js

function clean(value) {
  return String(value || '').trim();
}

export function buildVisualEndCredit({
  title,
  blueprintId,
  sourceVersion,
  targetVersion,
  platformVersion,
  productionPackId,
  campaignId,
  creatorCredit,
  rightsLine
} = {}) {
  const sourceTitle = clean(title) || 'Untitled Story';
  const basedOn = `Based on “${sourceTitle}”`;
  const version = clean(platformVersion || targetVersion || sourceVersion) || 'seed:v1';

  return {
    required: true,
    placement: 'final live visual frame',
    minimum_display_seconds: 2.5,
    safe_area: 'center-safe; do not place behind platform controls',
    text: {
      based_on: basedOn,
      source_version: clean(sourceVersion) || 'source seed',
      visual_version: version,
      creator: clean(creatorCredit) || null,
      generated_by: 'Created with L99 IP Studio',
      rights: clean(rightsLine) || null
    },
    lineage: {
      blueprint_id: blueprintId || null,
      production_pack_id: productionPackId || null,
      campaign_id: campaignId || null,
      source_version: sourceVersion || null,
      target_version: targetVersion || null,
      platform_version: platformVersion || null
    },
    render_rules: [
      'The book title must be readable.',
      'The credit must identify the exact source and visual version.',
      'The final frame may be styled for the platform but the lineage text may not be removed.',
      'A shortened watermark may appear during playback, but it does not replace the final credit frame.'
    ],
    machine_tag: `l99:${blueprintId || 'unknown'}:${version}`
  };
}

export function attachCreditsToProductionPack(packRow, input = {}) {
  if (!packRow?.pack) return packRow;
  const lineage = packRow.pack.lineage || {};
  const credit = buildVisualEndCredit({
    title: lineage.source_title,
    blueprintId: lineage.blueprint_id,
    sourceVersion: packRow.source_version || lineage.source_version,
    targetVersion: `${lineage.target_medium || packRow.target_medium}:v1`,
    productionPackId: packRow.pack_id,
    creatorCredit: input.creator_credit,
    rightsLine: input.rights_line
  });
  return { ...packRow, pack: { ...packRow.pack, end_credit: credit } };
}

export function attachCreditsToCampaign(campaignRow, input = {}) {
  if (!campaignRow?.campaign) return campaignRow;
  const lineage = campaignRow.campaign.lineage || {};
  const clips = (campaignRow.clips || []).map(row => {
    const clip = row.clip || {};
    const clipLineage = clip.lineage || {};
    const endCredit = buildVisualEndCredit({
      title: lineage.source_title,
      blueprintId: lineage.blueprint_id,
      sourceVersion: clipLineage.source_version || campaignRow.source_version,
      targetVersion: campaignRow.production_pack_id ? `production:${campaignRow.production_pack_id}` : campaignRow.source_version,
      platformVersion: row.platform_version || clip.platform_version,
      productionPackId: campaignRow.production_pack_id,
      campaignId: campaignRow.campaign_id,
      creatorCredit: input.creator_credit,
      rightsLine: input.rights_line
    });
    return { ...row, clip: { ...clip, end_credit: endCredit } };
  });
  return {
    ...campaignRow,
    campaign: {
      ...campaignRow.campaign,
      credit_policy: 'Every live visual product must end with a source-book and version lineage credit.',
      end_credit_required: true
    },
    clips
  };
}
