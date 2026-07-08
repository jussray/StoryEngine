// lib/extractEntities.js

import { createHash } from 'node:crypto';
import { completeJson } from './llmClient.js';

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function unique(items) {
  return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeId(value, prefix = 'entity') {
  const slug = text(value, prefix)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return slug || prefix;
}

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function extractSentences(chapterText) {
  return String(chapterText || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 160);
}

function extractCapitalizedPhrases(chapterText) {
  const stop = new Set([
    'The', 'A', 'An', 'And', 'But', 'When', 'Then', 'Later', 'Before', 'After', 'Chapter',
    'Act', 'In', 'On', 'At', 'As', 'By', 'For', 'From', 'Into', 'With', 'Without', 'He',
    'She', 'They', 'It', 'This', 'That', 'His', 'Her', 'Their', 'I', 'We', 'You'
  ]);
  const matches = String(chapterText || '').match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || [];
  return unique(matches).filter(item => !stop.has(item.split(' ')[0]));
}

function localExtract(chapterText, options = {}) {
  const phrases = extractCapitalizedPhrases(chapterText);
  const sentences = extractSentences(chapterText);
  const locations = phrases.filter(name => /\b(City|Village|Kingdom|Forest|River|Mountain|School|House|Castle|Station|Planet|Valley|Bay|Room|Garden|Bridge)\b/i.test(name));
  const characterCandidates = phrases.filter(name => !locations.includes(name)).slice(0, 12);
  const characters = characterCandidates.map(name => ({
    id: normalizeId(name, 'character'),
    name,
    role: 'mentioned',
    status: /\b(dead|died|ghost|spirit)\b/i.test(chapterText) ? 'unknown' : 'alive',
    location: null,
    traits: []
  }));

  const lore = sentences
    .filter(sentence => /\b(always|never|must|cannot|can't|law|rule|curse|prophecy|promise|secret|truth)\b/i.test(sentence))
    .slice(0, 12)
    .map((sentence, index) => ({
      id: `lore-${hashText(sentence).slice(0, 10)}`,
      category: /\b(curse|prophecy)\b/i.test(sentence) ? 'world_rule' : 'fact',
      title: `Canon fact ${index + 1}`,
      content: sentence,
      canonical: 1
    }));

  const timeline = sentences
    .filter(sentence => /\b(first|then|later|before|after|finally|morning|night|day|year|ago|when)\b/i.test(sentence))
    .slice(0, 16)
    .map((sentence, index) => ({
      id: `event-${hashText(sentence).slice(0, 10)}`,
      label: sentence.slice(0, 90),
      story_time: `sequence-${index + 1}`,
      description: sentence,
      position: index + 1
    }));

  const conflicts = [];
  const byName = new Map();
  for (const sentence of sentences) {
    for (const name of characterCandidates) {
      if (!sentence.includes(name)) continue;
      const lower = sentence.toLowerCase();
      if (!byName.has(name)) byName.set(name, { alive: false, dead: false, sentences: [] });
      const state = byName.get(name);
      if (/\b(alive|breathing|returned|walked|spoke|smiled)\b/.test(lower)) state.alive = true;
      if (/\b(dead|died|buried|grave|ghost|spirit)\b/.test(lower)) state.dead = true;
      state.sentences.push(sentence);
    }
  }
  for (const [name, state] of byName.entries()) {
    if (state.alive && state.dead) {
      conflicts.push({
        entity_type: 'character',
        entity_id: normalizeId(name, 'character'),
        field: 'status',
        old_value: 'dead_or_ghost',
        new_value: 'alive_or_active',
        summary: `${name} appears with both death/ghost and alive/action language.`,
        evidence: state.sentences.slice(0, 3)
      });
    }
  }

  return normalizeExtraction({
    source: 'local_heuristic',
    chapter_label: options.chapter_label || null,
    characters,
    locations: locations.map(name => ({ id: normalizeId(name, 'location'), name, type: 'mentioned', description: '' })),
    relationships: [],
    lore,
    objects: [],
    timeline,
    conflicts
  });
}

function normalizeExtraction(raw = {}) {
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  const lore = Array.isArray(raw.lore) ? raw.lore : [];
  const objects = Array.isArray(raw.objects) ? raw.objects : [];
  const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  const conflicts = Array.isArray(raw.conflicts) ? raw.conflicts : [];

  return {
    source: raw.source || 'model',
    chapter_label: raw.chapter_label || null,
    characters: characters.map(item => ({
      id: normalizeId(item.id || item.char_id || item.name, 'character'),
      name: text(item.name, item.id || 'Unnamed character'),
      role: text(item.role, 'mentioned'),
      status: text(item.status, 'unknown'),
      location: item.location || null,
      traits: Array.isArray(item.traits) ? item.traits : []
    })),
    locations: locations.map(item => ({
      id: normalizeId(item.id || item.loc_id || item.name, 'location'),
      name: text(item.name, item.id || 'Unnamed location'),
      type: text(item.type, 'mentioned'),
      description: text(item.description)
    })),
    relationships: relationships.map(item => ({
      id: normalizeId(item.id || item.relationship_id || `${item.char_a}-${item.char_b}-${item.type || item.rel_type}`, 'relationship'),
      char_a: normalizeId(item.char_a || item.a || '', 'character'),
      char_b: normalizeId(item.char_b || item.b || '', 'character'),
      type: text(item.type || item.rel_type, 'related'),
      notes: text(item.notes || item.description)
    })).filter(item => item.char_a && item.char_b),
    lore: lore.map(item => ({
      id: normalizeId(item.id || item.lore_id || item.title || item.content, 'lore'),
      category: text(item.category, 'fact'),
      title: text(item.title, 'Canon fact'),
      content: text(item.content || item.fact || item.description),
      canonical: item.canonical === 0 ? 0 : 1
    })).filter(item => item.content),
    objects: objects.map(item => ({
      id: normalizeId(item.id || item.obj_id || item.name, 'object'),
      name: text(item.name, item.id || 'Unnamed object'),
      type: text(item.type, 'object'),
      holder: item.holder || null,
      location: item.location || null
    })),
    timeline: timeline.map((item, index) => ({
      id: normalizeId(item.id || item.timeline_id || item.label || item.event_label || `event-${index + 1}`, 'timeline'),
      label: text(item.label || item.event_label, `Event ${index + 1}`),
      story_time: text(item.story_time, `sequence-${index + 1}`),
      description: text(item.description || item.summary),
      position: Number(item.position || index + 1)
    })),
    conflicts: conflicts.map(item => ({
      entity_type: text(item.entity_type, 'lore'),
      entity_id: normalizeId(item.entity_id || item.id || item.name || item.field, 'conflict'),
      field: text(item.field, 'canon'),
      old_value: item.old_value == null ? null : String(item.old_value),
      new_value: item.new_value == null ? null : String(item.new_value),
      summary: text(item.summary || item.reason || item.description, 'Potential continuity conflict.'),
      evidence: Array.isArray(item.evidence) ? item.evidence : []
    }))
  };
}

async function modelExtract(chapterText, options = {}) {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.LLM_BASE_URL) return null;

  const prompt = `Extract story continuity entities from the chapter. Return ONLY valid JSON with keys: characters, locations, relationships, lore, objects, timeline, conflicts.\n\nEach conflict must include: entity_type, entity_id, field, old_value, new_value, summary, evidence.\n\nUse stable lowercase ids. Do not invent facts that are not present.\n\nChapter label: ${options.chapter_label || 'chapter'}\n\nChapter text:\n${String(chapterText || '').slice(0, Number(options.max_model_chars || 60000))}`;

  const raw = await completeJson(prompt, {
    task: 'entity_extraction',
    provider: options.provider,
    model: options.model,
    maxTokens: options.maxTokens || 4096,
    temperature: 0.1,
    system: 'You are L99 Canon Guardian. Extract precise continuity memory for fiction and never output prose outside JSON.'
  });
  return normalizeExtraction({ ...raw, source: options.provider || 'llm', chapter_label: options.chapter_label || null });
}

export async function extractEntities(chapterText, options = {}) {
  if (!String(chapterText || '').trim()) throw new Error('chapterText is required.');
  if (options.provider === 'local') return localExtract(chapterText, options);
  const modelResult = await modelExtract(chapterText, options);
  return modelResult || localExtract(chapterText, options);
}

export function extractionToPatches(extraction) {
  const patches = [];
  for (const character of extraction.characters || []) {
    patches.push({
      entity_type: 'character',
      entity_id: character.id,
      field: 'profile',
      old_value: null,
      new_value: JSON.stringify(character),
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const location of extraction.locations || []) {
    patches.push({
      entity_type: 'location',
      entity_id: location.id,
      field: 'profile',
      old_value: null,
      new_value: JSON.stringify(location),
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const item of extraction.lore || []) {
    patches.push({
      entity_type: 'lore',
      entity_id: item.id,
      field: item.category || 'fact',
      old_value: null,
      new_value: item.content,
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const item of extraction.timeline || []) {
    patches.push({
      entity_type: 'timeline',
      entity_id: item.id,
      field: 'event',
      old_value: null,
      new_value: JSON.stringify(item),
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const item of extraction.objects || []) {
    patches.push({
      entity_type: 'object',
      entity_id: item.id,
      field: 'profile',
      old_value: null,
      new_value: JSON.stringify(item),
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const item of extraction.relationships || []) {
    patches.push({
      entity_type: 'relationship',
      entity_id: item.id,
      field: 'relationship',
      old_value: null,
      new_value: JSON.stringify(item),
      conflict: false,
      source: extraction.source || 'entity_extraction'
    });
  }
  for (const conflict of extraction.conflicts || []) {
    patches.push({
      entity_type: conflict.entity_type,
      entity_id: conflict.entity_id,
      field: conflict.field,
      old_value: conflict.old_value,
      new_value: conflict.new_value || conflict.summary,
      conflict: true,
      source: `${extraction.source || 'entity_extraction'}_conflict`
    });
  }
  return patches;
}
