import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { CREATOR_BOOTSTRAP_KEY, establishBrowserSession } from './session.js';

const DB_PATH = fileURLToPath(new URL('../db/l99.db', import.meta.url));

test('OODA snapshot, timeline, and live SSE stay inside the authenticated workspace', async ({ page }) => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const correlationId = `playwright-ooda-correlation-${nonce}`;
  const allowedIncidentId = `playwright-ooda-allowed-${nonce}`;
  const forbiddenIncidentId = `playwright-ooda-forbidden-${nonce}`;
  const allowedWorkspace = 'playwright-allowed-workspace';
  const forbiddenWorkspace = 'playwright-forbidden-workspace';

  const db = new DatabaseSync(DB_PATH);
  const insert = db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, workspace_id, event_type, severity, status,
      reason, drift_score, details_json, created_at
    ) VALUES (?, ?, ?, 'PLAYWRIGHT_ISOLATION', 'sev2', 'active', ?, 0.5, '{}', ?)
  `);
  const now = Date.now();
  insert.run(allowedIncidentId, correlationId, allowedWorkspace, 'allowed workspace incident', now);
  insert.run(forbiddenIncidentId, correlationId, forbiddenWorkspace, 'forbidden workspace incident', now + 1);
  db.close();

  try {
    await establishBrowserSession(page, CREATOR_BOOTSTRAP_KEY);
    const creator = await page.goto('/story_engine.html');
    expect(creator?.status()).toBe(200);

    const snapshotResponse = await page.context().request.get('/api/ooda/snapshot');
    expect(snapshotResponse.status()).toBe(200);
    const snapshot = await snapshotResponse.json();
    expect(snapshot.incidents.some(incident => incident.incident_id === allowedIncidentId)).toBe(true);
    expect(snapshot.incidents.some(incident => incident.incident_id === forbiddenIncidentId)).toBe(false);
    expect(snapshot.incidents.every(incident => incident.workspace_id === allowedWorkspace)).toBe(true);

    const timelineResponse = await page.context().request.get(`/api/ooda/timeline/${correlationId}`);
    expect(timelineResponse.status()).toBe(200);
    const timeline = await timelineResponse.json();
    expect(timeline.timeline.some(item => item.incident_id === allowedIncidentId)).toBe(true);
    expect(timeline.timeline.some(item => item.incident_id === forbiddenIncidentId)).toBe(false);
    expect(timeline.timeline.every(item => item.workspace_id === allowedWorkspace)).toBe(true);

    const liveIncidents = await page.evaluate(({ allowedIncidentId: expectedIncidentId }) => new Promise((resolve, reject) => {
      const source = new EventSource('/api/ooda/incidents');
      const timer = setTimeout(() => {
        source.close();
        reject(new Error('Timed out waiting for workspace-scoped OODA SSE incidents.'));
      }, 5000);

      source.addEventListener('incidents', event => {
        const incidents = JSON.parse(event.data || '[]');
        if (!incidents.some(incident => incident.incident_id === expectedIncidentId)) return;
        clearTimeout(timer);
        source.close();
        resolve(incidents);
      });
    }), { allowedIncidentId });

    expect(liveIncidents.some(incident => incident.incident_id === allowedIncidentId)).toBe(true);
    expect(liveIncidents.some(incident => incident.incident_id === forbiddenIncidentId)).toBe(false);
    expect(liveIncidents.every(incident => incident.workspace_id === allowedWorkspace)).toBe(true);
  } finally {
    const cleanup = new DatabaseSync(DB_PATH);
    cleanup.prepare('DELETE FROM lindymode_incidents WHERE incident_id IN (?, ?)')
      .run(allowedIncidentId, forbiddenIncidentId);
    cleanup.close();
  }
});
