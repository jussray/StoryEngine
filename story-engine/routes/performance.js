// routes/performance.js

import { json } from '../lib/miniRouter.js';
import { buildPerformanceDashboard } from '../lib/performanceDashboard.js';
import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import { importBusinessMetricsCsv, listBusinessMetrics, businessMetricsSummary } from '../lib/businessMetrics.js';

export default function performanceRoutes(router, db) {
  router.get('/api/performance/overview', requireRole('administrator'), (req, res) => {
    try {
      json(res, 200, buildPerformanceDashboard(db, {
        windowMs: req.query.window_ms,
        limit: req.query.limit
      }));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/performance/business/:workspace_id', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    try {
      json(res, 200, {
        ...businessMetricsSummary(db, req.params.workspace_id),
        observations: listBusinessMetrics(db, req.params.workspace_id, { limit: req.query.limit })
      });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/performance/business/:workspace_id/import', requireRole('creator'), (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    if (typeof req.body !== 'string') {
      return json(res, 415, { error: 'text/csv body required' });
    }
    try {
      const result = importBusinessMetricsCsv(db, req.body, {
        workspace_id: req.params.workspace_id,
        source: req.query.source,
        account_id: req.query.account_id,
        page_id: req.query.page_id,
        audience_segment: req.query.audience_segment,
        content_id: req.query.content_id,
        provenance: {
          imported_by_actor_id: req.auth?.actor_id || null,
          imported_by_tenant_id: req.auth?.tenant_id || null
        }
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/performance/stream', requireRole('administrator'), (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    const send = () => {
      try {
        res.write('event: performance\n');
        res.write(`data: ${JSON.stringify(buildPerformanceDashboard(db))}\n\n`);
      } catch (error) {
        res.write('event: error\n');
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      }
    };

    send();
    const interval = setInterval(send, 30_000);
    req.on('close', () => clearInterval(interval));
  });
}
