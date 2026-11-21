/**
 * Materialize source-graph edges using the persisted IDs assigned to each node.
 * Display names are not identities: a story, character and beat may share one.
 */
export function seedEdges(seedId, nodes, nodeIds) {
  if (!seedId || !Array.isArray(nodes) || !Array.isArray(nodeIds)
    || nodes.length !== nodeIds.length
    || nodeIds.some(id => typeof id !== 'string' || !id.trim())
    || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error('Seed graph nodes require one distinct persisted ID per node.');
  }

  const storyIndex = nodes.findIndex(node => node.node_type === 'story');
  if (storyIndex === -1) return [];

  const edges = [];
  const add = (fromIndex, toIndex, relation, edge = {}, confidence_score = 75) => {
    edges.push({
      seed_id: seedId,
      from_node_id: nodeIds[fromIndex],
      to_node_id: nodeIds[toIndex],
      relation,
      edge,
      confidence_score,
    });
  };

  nodes.forEach((node, index) => {
    if (index === storyIndex) return;
    add(storyIndex, index,
      node.node_type === 'character' ? 'contains_character' : `defines_${node.node_type}`,
      { source: 'blueprint' }, node.confidence_score);
  });

  const characters = nodes.flatMap((node, index) => node.node_type === 'character' ? [index] : []);
  const beats = nodes.flatMap((node, index) => node.node_type === 'emotional_beat' ? [index] : []);
  for (const characterIndex of characters) {
    for (const beatIndex of beats) {
      add(characterIndex, beatIndex, 'appears_in_or_influences', { heuristic: true }, 55);
    }
  }
  return edges;
}
