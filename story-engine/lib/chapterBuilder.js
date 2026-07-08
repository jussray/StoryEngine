// lib/chapterBuilder.js

import * as Chapter from '../models/chapterModel.js';
import { getArchitecture } from './storyArchitect.js';
import { getGenomeContext, patchMemoryFromChapter } from './memoryEngine.js';
import { enqueueRuntime } from './runtimeDispatcher.js';
import { log } from '../models/eventModel.js';

function wordTarget(value) {
  const number = Number(value || 1200);
  if (!Number.isFinite(number)) return 1200;
  return Math.max(300, Math.min(Math.floor(number), 5000));
}

function findPlannedChapter(architecture, chapterNumber) {
  const chapters = architecture?.structure?.acts?.flatMap(act => act.chapters || []) || [];
  return chapters.find(chapter => Number(chapter.chapter_number) === Number(chapterNumber));
}

function findExistingChapter(db, workspaceId, planned) {
  const chapterId = planned.chapter_id;
  return db.prepare(`
    SELECT * FROM chapters
    WHERE workspace_id = ?
      AND (chapter_id = ? OR position = ?)
    ORDER BY chapter_id = ? DESC
    LIMIT 1
  `).get(workspaceId, chapterId, planned.chapter_number, chapterId);
}

function buildDraftText(planned, architecture, context, options = {}) {
  const target = wordTarget(options.word_target);
  const activeCharacters = context.active_characters?.map(item => item.name).join(', ') || 'the central character';
  const locations = context.locations?.map(item => item.name).join(', ') || 'the primary setting';
  const theme = architecture.structure.theme_map?.[0]?.theme || 'transformation under pressure';
  const keyPoints = (planned.key_points || []).map(point => `- ${point}`).join('\n');

  return `# ${planned.title}\n\n` +
    `Purpose: ${planned.purpose}\n\n` +
    `Emotional hook: ${planned.emotional_hook}\n\n` +
    `Target length: ${target} words.\n\n` +
    `Context to honor:\n` +
    `- Story: ${architecture.structure.title}\n` +
    `- Premise: ${architecture.structure.premise}\n` +
    `- Theme: ${theme}\n` +
    `- Active characters: ${activeCharacters}\n` +
    `- Known locations: ${locations}\n\n` +
    `Chapter beats:\n${keyPoints}\n\n` +
    `Draft:\n` +
    `The chapter opens with the pressure promised by the outline already present in the room. ` +
    `The scene should move with a clear emotional engine: ${planned.emotional_hook.toLowerCase()} ` +
    `Every exchange should either reveal character, increase cost, or sharpen the decision waiting at the end of the chapter. ` +
    `By the closing beat, the reader should understand why this chapter could not be skipped and why the next chapter now feels necessary.\n`;
}

export function buildChapterDraft(db, input = {}) {
  const workspaceId = String(input.workspace_id || '').trim();
  const chapterNumber = Number(input.chapter_number || 1);
  if (!workspaceId) throw new Error('workspace_id is required.');
  if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw new Error('chapter_number must be positive.');

  const architecture = getArchitecture(db, workspaceId);
  if (!architecture) throw new Error('Story architecture not found.');
  const planned = findPlannedChapter(architecture, chapterNumber);
  if (!planned) throw new Error('Planned chapter not found.');

  const startedAt = Date.now();
  const context = getGenomeContext(db, workspaceId);
  const content = input.content || buildDraftText(planned, architecture, context, input);
  const existing = findExistingChapter(db, workspaceId, planned);
  let id;
  let action;

  if (existing) {
    Chapter.update(db, existing.id, {
      title: planned.title,
      content,
      position: planned.chapter_number
    });
    id = existing.id;
    action = 'updated';
  } else {
    id = Number(Chapter.create(db, workspaceId, {
      title: planned.title,
      content,
      position: planned.chapter_number
    }));
    db.prepare('UPDATE chapters SET chapter_id = ? WHERE id = ?').run(planned.chapter_id, id);
    action = 'created';
  }

  const memoryDiffs = patchMemoryFromChapter(db, workspaceId, id, content, [
    {
      entity_type: 'chapter',
      entity_id: planned.chapter_id,
      field: 'draft_status',
      old_value: planned.status || 'planned',
      new_value: 'drafted',
      conflict: false,
      source: 'chapter_builder'
    }
  ]);
  const dispatch = enqueueRuntime(db, workspaceId, 'chapter_builder_drafted', id);

  log(db, {
    workspace_id: workspaceId,
    mode: 'studio',
    event_type: `chapter_builder.${action}`,
    payload: {
      chapter_db_id: id,
      chapter_id: planned.chapter_id,
      chapter_number: planned.chapter_number,
      memory_diff_count: memoryDiffs.length,
      dispatch_id: dispatch?.dispatch_id || null
    },
    duration_ms: Date.now() - startedAt
  });

  return {
    chapter: Chapter.get(db, id),
    planned,
    action,
    memory: {
      diff_count: memoryDiffs.length,
      context
    },
    dispatch
  };
}

export function buildAllChapterDrafts(db, input = {}) {
  const workspaceId = String(input.workspace_id || '').trim();
  if (!workspaceId) throw new Error('workspace_id is required.');
  const architecture = getArchitecture(db, workspaceId);
  if (!architecture) throw new Error('Story architecture not found.');
  const chapters = architecture.structure.acts.flatMap(act => act.chapters || []);
  return chapters.map(chapter => buildChapterDraft(db, {
    ...input,
    chapter_number: chapter.chapter_number
  }));
}
