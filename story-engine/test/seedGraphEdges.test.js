import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEdges } from '../lib/seedGraphEdges.js';

test('same-name story, character and emotional beat preserve distinct node identities', () => {
  const nodes = [
    { node_type: 'story', name: 'Echo', confidence_score: 90 },
    { node_type: 'character', name: 'Echo', confidence_score: 82 },
    { node_type: 'emotional_beat', name: 'Echo', confidence_score: 80 },
  ];
  const ids = ['story-id', 'character-id', 'beat-id'];
  const edges = seedEdges('seed-1', nodes, ids);
  assert.equal(edges.length, 3);
  assert.ok(edges.some(e => e.from_node_id === 'story-id' && e.to_node_id === 'character-id' && e.relation === 'contains_character'));
  assert.ok(edges.some(e => e.from_node_id === 'story-id' && e.to_node_id === 'beat-id' && e.relation === 'defines_emotional_beat'));
  assert.ok(edges.some(e => e.from_node_id === 'character-id' && e.to_node_id === 'beat-id' && e.relation === 'appears_in_or_influences'));
  assert.ok(edges.every(e => e.from_node_id !== e.to_node_id));
});

test('missing or duplicated persisted node IDs fail closed', () => {
  const nodes = [{ node_type: 'story', name: 'Story' }, { node_type: 'character', name: 'Hero' }];
  assert.throws(() => seedEdges('seed-1', nodes, ['story-id']), /one distinct persisted ID/);
  assert.throws(() => seedEdges('seed-1', nodes, ['same', 'same']), /one distinct persisted ID/);
});

test('no story node produces no invented edges', () => {
  assert.deepEqual(seedEdges('seed-1', [{ node_type: 'character', name: 'Echo' }], ['char-id']), []);
});
