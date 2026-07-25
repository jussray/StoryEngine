// routes/performance.js

import { json } from '../lib/miniRouter.js';
import { buildPerformanceDashboard } from '../lib/performanceDashboard.js';
import { requireRole } from '../lib/securityContext.js';

export default function performanceRoutes(router, db) {
  router.get('/api/performance/overview', (req, res) => {
    requireRole('administrator')(req, res, () => {
      try {
        json(res, 200, buildPerformanceDashboard(db, {
          windowMs: req.query.window_ms,
          limit: req.query.limit
        }));
      } catch (error) {
        json(res, 500, { error: error.message });
      }
    });
  });

  router.get('/api/performance/stream', (req, res) => {
    requireRole('administrator')(req, res, () => {
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
  });
}
