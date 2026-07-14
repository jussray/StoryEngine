// lib/ipSeedMemoryGraph.js

import { randomUUID } from 'node:crypto';
import { buildStoryBlueprint, getStoryBlueprint, listBlueprintConversions } from './storyBlueprint.js';
import { listProductionPacks } from './ipStudio.js';
import { listCampaignPacks } from './campaignStudio.js';
import { log } from '../models/eventModel.js';

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function clean(value) {
  return String(value || '').trim();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_seeds (
      seed_id TEXT PRIMARY KEY,
      blueprint_id TEXT NOT NULL UNIQUE,
      source_workspace_id TEXT NOT NULL UNIQUE,
      seed_version TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      seed_json TEXT NOT NULL DEFAULT '{}',
      health_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_seeds_workspace ON ip_seeds(source_workspace_id);

    CREATE TABLE IF NOT EXISTS ip_seed_nodes (
      node_id TEXT PRIMARY KEY,
      seed_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      node_json TEXT NOT NULL DEFAULT '{}',
      confidence_score INTEGER NOT NULL DEFAULT 70,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_seed_nodes_seed ON ip_seed_nodes(seed_id, node_type);

    CREATE TABLE IF NOT EXISTS ip_seed_edges (
      edge_id TEXT PRIMARY KEY,
      seed_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      edge_json TEXT NOT NULL DEFAULT '{}',
      confidence_score INTEGER NOT NULL DEFAULT 70,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_seed_edges_seed ON ip_seed_edges(seed_id, relation);

    CREATE TABLE IF NOT EXISTS ip_seed_versions (
      version_id TEXT PRIMARY KEY,
      seed_id TEXT NOT NULL,
      seed_version TEXT NOT NULL,
      change_type TEXT NOT NULL,
      change_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_seed_versions_seed ON ip_seed_versions(seed_id, created_at DESC);
  `);
}

function hydrateSeed(row) {
  if (!row) return null;
  return { ...row, seed: parseJson(row.seed_json, {}), health: parseJson(row.health_json, {}) };
}

function hydrateNode(row) {
  if (!row) return null;
  return { ...row, node: parseJson(row.node_json, {}) };
}

function hydrateEdge(row) {
  if (!row) return null;
  return { ...row, edge: parseJson(row.edge_json, {}) };
}

function versionFor(blueprint, priorVersion) {
  const unitCount = blueprint.beats?.length || 0;
  const characterCount = blueprint.characters?.length || 0;
  const fingerprint = `${unitCount}.${characterCount}.${blueprint.proof?.audience_fit_score ?? 0}`;
  return priorVersion && priorVersion.endsWith(fingerprint) ? priorVersion : `seed:v${Date.now()}:${fingerprint}`;
}

function seedNodes(blueprint) {
  const nodes = [];
  const add = (node_type, name, node, confidence_score = 75) => {
    const safeName = clean(name);
    if (!safeName) return;
    nodes.push({ node_type, name: safeName, node, confidence_score });
  };

  add('story', blueprint.title, {
    pitch: blueprint.pitch,
    source_medium: blueprint.source_medium,
    audience: blueprint.audience,
    story_kind: blueprint.story_kind,
    emotional_effect: blueprint.emotional_effect
  }, 90);

  for (const character of blueprint.characters || []) {
    add('character', character.name, {
      preserve: character.preserve !== false,
      source: character.source || 'blueprint',
      speaks_like: character.speaks_like || null,
      fears: character.fears || [],
      relationships: character.relationships || [],
      appearance: character.appearance || null,
      arc: character.arc || null,
      secrets: character.secrets || [],
      callbacks: character.callbacks || [],
      unresolved_threads: character.unresolved_threads || []
    }, character.source === 'heuristic' ? 68 : 82);
  }

  for (const beat of blueprint.beats || []) {
    add('emotional_beat', beat.source_title, {
      source_position: beat.source_position,
      source_excerpt: beat.source_excerpt,
      emotional_job: beat.emotional_job,
      adaptation_anchor: beat.adaptation_anchor
    }, 80);
  }

  for (const fact of blueprint.canon?.facts || blueprint.canon?.canon_facts || []) {
    add('canon_fact', fact.name || fact.fact || fact.key || 'canon fact', fact, 76);
  }

  add('visual_language', `${blueprint.title} visual language`, {
    source: 'seed_default',
    rules: ['preserve character identity', 'preserve age/audience fit', 'keep visual motifs consistent across versions'],
    developmental_profile: blueprint.developmental_profile || null
  }, 72);

  add('audio_identity', `${blueprint.title} audio identity`, {
    source: 'seed_default',
    rules: ['preserve emotional promise', 'match audience maturity', 'keep recurring cues traceable to source beats']
  }, 70);

  add('brand_identity', `${blueprint.title} brand identity`, {
    source: 'seed_default',
    promise: blueprint.emotional_effect || 'mixed',
    audience: blueprint.audience,
    never: blueprint.conversion_rules?.never || []
  }, 78);

  return nodes;
}

function seedEdges(seedId, nodes) {
  const story = nodes.find(node => node.node_type === 'story');
  if (!story) return [];
  const edges = [];
  const add = (from, to, relation, edge = {}, confidence_score = 75) => {
    if (!from || !to) return;
    edges.push({ seed_id: seedId, from, to, relation, edge, confidence_score });
  };
  for (const node of nodes) {
    if (node === story) continue;
    add(story.name, node.name, node.node_type === 'character' ? 'contains_character' : `defines_${node.node_type}`, { source: 'blueprint' }, node.confidence_score);
  }
  const characters = nodes.filter(node => node.node_type === 'character');
  const beats = nodes.filter(node => node.node_type === 'emotional_beat');
  for (const character of characters) {
    for (const beat of beats) add(character.name, beat.name, 'appears_in_or_influences', { heuristic: true }, 55);
  }
  return edges;
}

function buildSeedObject(blueprint, seedVersion, lineage) {
  return {
    seed_version: seedVersion,
    title: blueprint.title,
    source_workspace_id: blueprint.source_workspace_id,
    blueprint_id: blueprint.blueprint_id,
    proof: blueprint.proof,
    seed_gate: blueprint.seed_gate,
    creative_contract: {
      source_medium: blueprint.source_medium,
      audience: blueprint.audience,
      story_kind: blueprint.story_kind,
      emotional_effect: blueprint.emotional_effect,
      developmental_profile: blueprint.developmental_profile || null
    },
    memory_contract: {
      characters: 'all named characters become graph nodes',
      canon: 'all canon facts remain source-of-truth constraints',
      emotional_beats: 'source beats drive adaptations and marketing',
      visual_language: 'all visual outputs inherit the same identity layer',
      audio_identity: 'all audio outputs inherit the same emotional sound layer',
      brand_identity: 'all campaigns preserve the same audience promise'
    },
    conversion_rules: blueprint.conversion_rules,
    continuation_options: blueprint.continuation_options || [],
    lineage,
    update_policy: {
      rule: 'Every generated asset may propose seed updates, but only validated changes become the next seed version.',
      stale_downstream_rule: 'If seed_version changes, downstream assets with older source_version require refresh review.'
    }
  };
}

function lineageFor(db, row) {
  const conversions = listBlueprintConversions(db, row.blueprint_id);
  const productionPacks = listProductionPacks(db, row.source_workspace_id);
  const campaigns = listCampaignPacks(db, row.source_workspace_id);
  return {
    book: { workspace_id: row.source_workspace_id, blueprint_id: row.blueprint_id, status: row.validation?.passed ? 'validated' : 'blocked' },
    conversions: conversions.map(item => ({ conversion_id: item.conversion_id, target_medium: item.target_medium, target_workspace_id: item.target_workspace_id, status: item.status, created_at: item.created_at })),
    production_packs: productionPacks.map(item => ({ pack_id: item.pack_id, target_medium: item.target_medium, source_version: item.source_version, status: item.status, created_at: item.created_at })),
    campaigns: campaigns.map(item => ({ campaign_id: item.campaign_id, campaign_name: item.campaign_name, source_version: item.source_version, platforms: item.platforms, status: item.status, created_at: item.created_at }))
  };
}

function seedHealth(seed, nodes, lineage) {
  const characterCount = nodes.filter(node => node.node_type === 'character').length;
  const beatCount = nodes.filter(node => node.node_type === 'emotional_beat').length;
  const canonCount = nodes.filter(node => node.node_type === 'canon_fact').length;
  const downstream = [
    ...(lineage.conversions || []),
    ...(lineage.production_packs || []),
    ...(lineage.campaigns || [])
  ];
  const stale = downstream.filter(item => item.source_version && item.source_version !== seed.seed_version && !String(item.source_version).includes(seed.seed_version));
  const score = Math.max(0, Math.min(100, Math.round(
    (seed.seed_gate?.conversion_ready ? 35 : 0) +
    Math.min(20, characterCount * 4) +
    Math.min(20, beatCount * 5) +
    Math.min(10, canonCount * 2) +
    (stale.length ? 0 : 15)
  )));
  return {
    score,
    status: seed.seed_gate?.conversion_ready ? stale.length ? 'refresh_needed' : 'healthy' : 'blocked',
    character_count: characterCount,
    emotional_beat_count: beatCount,
    canon_fact_count: canonCount,
    downstream_asset_count: downstream.length,
    stale_downstream_count: stale.length,
    stale_downstream_assets: stale
  };
}

export function buildIpSeed(db, sourceWorkspaceId) {
  ensureSchema(db);
  const row = getStoryBlueprint(db, sourceWorkspaceId) || buildStoryBlueprint(db, sourceWorkspaceId);
  const existing = db.prepare('SELECT * FROM ip_seeds WHERE blueprint_id=?').get(row.blueprint_id);
  const lineage = lineageFor(db, row);
  const seedVersion = versionFor(row.blueprint, existing?.seed_version || null);
  const seed = buildSeedObject(row.blueprint, seedVersion, lineage);
  const nodes = seedNodes(row.blueprint);
  const health = seedHealth(seed, nodes, lineage);
  const seedId = existing?.seed_id || `seed_${randomUUID()}`;
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO ip_seeds (seed_id, blueprint_id, source_workspace_id, seed_version, title, status, seed_json, health_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(blueprint_id) DO UPDATE SET
        seed_version=excluded.seed_version,
        title=excluded.title,
        status=excluded.status,
        seed_json=excluded.seed_json,
        health_json=excluded.health_json,
        updated_at=excluded.updated_at
    `).run(seedId, row.blueprint_id, sourceWorkspaceId, seedVersion, row.title, health.status, JSON.stringify(seed), JSON.stringify(health), now, now);

    db.prepare('DELETE FROM ip_seed_nodes WHERE seed_id=?').run(seedId);
    db.prepare('DELETE FROM ip_seed_edges WHERE seed_id=?').run(seedId);
    const nodeInsert = db.prepare(`INSERT INTO ip_seed_nodes (node_id, seed_id, node_type, name, node_json, confidence_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const nameToId = new Map();
    for (const node of nodes) {
      const nodeId = `seed_node_${randomUUID()}`;
      nameToId.set(node.name, nodeId);
      nodeInsert.run(nodeId, seedId, node.node_type, node.name, JSON.stringify(node.node), node.confidence_score, now, now);
    }
    const edgeInsert = db.prepare(`INSERT INTO ip_seed_edges (edge_id, seed_id, from_node_id, to_node_id, relation, edge_json, confidence_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const edge of seedEdges(seedId, nodes)) {
      edgeInsert.run(`seed_edge_${randomUUID()}`, seedId, nameToId.get(edge.from), nameToId.get(edge.to), edge.relation, JSON.stringify(edge.edge), edge.confidence_score, now, now);
    }
    db.prepare(`INSERT INTO ip_seed_versions (version_id, seed_id, seed_version, change_type, change_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`seed_version_${randomUUID()}`, seedId, seedVersion, existing ? 'rebuilt_from_blueprint' : 'created_from_blueprint', JSON.stringify({ blueprint_id: row.blueprint_id, health }), now);
  })();

  log(db, {
    workspace_id: sourceWorkspaceId,
    mode: 'ip_seed',
    event_type: 'ip_seed.memory_graph_built',
    payload: { seed_id: seedId, blueprint_id: row.blueprint_id, seed_version: seedVersion, health_score: health.score, status: health.status }
  });

  return getIpSeed(db, sourceWorkspaceId);
}

export function getIpSeed(db, sourceWorkspaceId) {
  ensureSchema(db);
  const seed = hydrateSeed(db.prepare('SELECT * FROM ip_seeds WHERE source_workspace_id=?').get(sourceWorkspaceId));
  if (!seed) return null;
  const nodes = db.prepare('SELECT * FROM ip_seed_nodes WHERE seed_id=? ORDER BY node_type, name').all(seed.seed_id).map(hydrateNode);
  const edges = db.prepare('SELECT * FROM ip_seed_edges WHERE seed_id=? ORDER BY relation').all(seed.seed_id).map(hydrateEdge);
  const versions = db.prepare('SELECT * FROM ip_seed_versions WHERE seed_id=? ORDER BY created_at DESC LIMIT 25').all(seed.seed_id).map(row => ({ ...row, change: parseJson(row.change_json, {}) }));
  return { ...seed, nodes, edges, versions };
}

export function getOrBuildIpSeed(db, sourceWorkspaceId) {
  return getIpSeed(db, sourceWorkspaceId) || buildIpSeed(db, sourceWorkspaceId);
}

export function listIpSeeds(db, limit = 25) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM ip_seeds ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Math.min(100, Number(limit) || 25))).map(hydrateSeed);
}

export function ipSeedOverview(db) {
  ensureSchema(db);
  const seeds = listIpSeeds(db, 50);
  const avg = seeds.length ? Math.round(seeds.reduce((sum, item) => sum + Number(item.health?.score || 0), 0) / seeds.length) : 0;
  return {
    seed_count: seeds.length,
    average_seed_health: avg,
    healthy_count: seeds.filter(item => item.status === 'healthy').length,
    refresh_needed_count: seeds.filter(item => item.status === 'refresh_needed').length,
    blocked_count: seeds.filter(item => item.status === 'blocked').length,
    latest: seeds.slice(0, 10)
  };
}

export function proposeSeedUpdate(db, sourceWorkspaceId, input = {}) {
  const current = getOrBuildIpSeed(db, sourceWorkspaceId);
  const now = Date.now();
  const proposal = {
    source: input.source || 'learning_engine',
    reason: input.reason || 'Generated asset feedback proposed a seed update.',
    proposed_change: input.change || {},
    status: 'proposed',
    requires_validation: true
  };
  db.prepare(`INSERT INTO ip_seed_versions (version_id, seed_id, seed_version, change_type, change_json, created_at) VALUES (?, ?, ?, 'proposed_update', ?, ?)`)
    .run(`seed_version_${randomUUID()}`, current.seed_id, current.seed_version, JSON.stringify(proposal), now);
  log(db, { workspace_id: sourceWorkspaceId, mode: 'ip_seed', event_type: 'ip_seed.update_proposed', payload: { seed_id: current.seed_id, proposal } });
  return { ...current, proposal };
}
