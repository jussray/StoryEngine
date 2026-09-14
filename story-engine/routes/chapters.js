// routes/chapters.js
import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { enqueueRuntime } from '../lib/runtimeDispatcher.js';
import { getGenomeContext, patchMemoryFromChapter } from '../lib/memoryEngine.js';
import { getWorkspaceAssist } from '../lib/assistMode.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { evaluateProseQuality } from '../lib/proseQuality.js';

function dispatchSummary(dispatch) {
  return dispatch ? {
    dispatch_id: dispatch.dispatch_id,
    status: dispatch.status,
    deduplicated: Boolean(dispatch.deduplicated),
    trigger_type: dispatch.trigger_type,
    chapter_id: dispatch.chapter_id ?? null
  } : null;
}

function enqueueChapterRuntimeIfAuthorized(db, workspaceId, triggerType, chapterId) {
  const assistMode = getWorkspaceAssist(db, workspaceId).assist_mode;
  if (assistMode === 'writer' || assistMode === 'co_writer') return null;
  return enqueueRuntime(db, workspaceId, triggerType, chapterId);
}

function proseQualityFor(content, body = {}) {
  return evaluateProseQuality(content || '', {
    phase: body.quality_phase,
    mode: body.quality_mode
  });
}

function logProseQuality(db, workspaceId, chapterId, quality) {
  log(db, {
    workspace_id: workspaceId,
    mode: 'prose_quality',
    event_type: quality.status === 'FAIL'
      ? 'prose_quality.failed'
      : quality.status === 'PASS'
        ? 'prose_quality.passed'
        : 'prose_quality.observed',
    payload: {
      chapter_id: chapterId,
      status: quality.status,
      phase: quality.phase,
      mode: quality.mode,
      fingerprint: quality.fingerprint,
      continuity_cookie: quality.continuity_cookie,
      aiish_score: quality.analysis.aiish_score,
      voice_grip: quality.analysis.voice_grip,
      melodrama_score: quality.analysis.melodrama_score,
      pattern_score: quality.analysis.pattern_score,
      failures: quality.failures
    },
    rollback: 0
  });
}

export default function chapterRoutes(router, db) {
  router.get('/api/chapters/:workspace_id', (req, res) => {
    json(res, 200, Chapter.list(db, req.params.workspace_id));
  });

  router.get('/api/chapters/:workspace_id/memory-context', (req, res) => {
    json(res, 200, getGenomeContext(db, req.params.workspace_id));
  });

  router.post('/api/chapters/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const { title, content, position, memory_patches } = req.body || {};
    if (!title) return json(res, 400, { error: 'title required' });

    const startedAt = Date.now();
    const id = Chapter.create(db, workspace_id, { title, content, position });
    const memoryDiffs = patchMemoryFromChapter(
      db,
      workspace_id,
      Number(id),
      content || '',
      memory_patches
    );
    const quality = proseQualityFor(content, req.body);
    logProseQuality(db, workspace_id, Number(id), quality);
    log(db, {
      workspace_id,
      event_type: 'chapter_created',
      payload: {
        id,
        title,
        memory_diff_count: memoryDiffs.length,
        prose_quality_status: quality.status,
        prose_quality_fingerprint: quality.fingerprint
      },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueChapterRuntimeIfAuthorized(db, workspace_id, 'chapter_created', Number(id));
    const queued = Boolean(dispatch);
    json(res, queued ? 202 : 201, {
      id,
      ok: true,
      queued,
      dispatch: dispatchSummary(dispatch),
      quality,
      memory: {
        patched: true,
        diff_count: memoryDiffs.length,
        context: getGenomeContext(db, workspace_id)
      },
      lindymode: { queued, incidents: [] }
    });
  });

  router.put('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;

    const startedAt = Date.now();
    Chapter.update(db, id, req.body);
    const updated = Chapter.get(db, id);
    const updatedContent = updated?.content || updated?.text || '';
    const memoryDiffs = patchMemoryFromChapter(
      db,
      chapter.workspace_id,
      id,
      updatedContent,
      req.body?.memory_patches
    );
    const quality = proseQualityFor(updatedContent, req.body);
    logProseQuality(db, chapter.workspace_id, id, quality);
    log(db, {
      workspace_id: chapter.workspace_id,
      event_type: 'chapter_updated',
      payload: {
        id,
        memory_diff_count: memoryDiffs.length,
        prose_quality_status: quality.status,
        prose_quality_fingerprint: quality.fingerprint
      },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueChapterRuntimeIfAuthorized(db, chapter.workspace_id, 'chapter_updated', id);
    const queued = Boolean(dispatch);
    json(res, queued ? 202 : 200, {
      ok: true,
      queued,
      dispatch: dispatchSummary(dispatch),
      quality,
      memory: {
        patched: true,
        diff_count: memoryDiffs.length,
        context: getGenomeContext(db, chapter.workspace_id)
      },
      lindymode: { queued, incidents: [] }
    });
  });
}
