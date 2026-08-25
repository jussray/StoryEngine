const listEl = document.getElementById('incidentList');
const statusEl = document.getElementById('connectionStatus');
const timelineEl = document.getElementById('timelineList');
const timelineIntroEl = document.getElementById('timelineIntro');
const totalActiveEl = document.getElementById('totalActive');
const criticalCountEl = document.getElementById('criticalCount');
const lindyCountEl = document.getElementById('lindyCount');
const runtimeCountEl = document.getElementById('runtimeCount');

let currentIncidents = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function severityClass(severity) {
  if (severity === 'critical') return 'health-critical';
  if (severity === 'warning') return 'health-watch';
  return 'health-good';
}

function updateSummary(incidents) {
  totalActiveEl.textContent = String(incidents.length);
  criticalCountEl.textContent = String(incidents.filter(item => item.severity === 'critical').length);
  lindyCountEl.textContent = String(incidents.filter(item => item.source === 'lindymode').length);
  runtimeCountEl.textContent = String(incidents.filter(item => item.source === 'runtime').length);
}

function renderIncidents(incidents) {
  currentIncidents = Array.isArray(incidents) ? incidents : [];
  updateSummary(currentIncidents);

  if (!currentIncidents.length) {
    listEl.innerHTML = `
      <article class="beat-card empty-state compact-empty">
        <span class="health-pill health-good">Healthy</span>
        <h3>No active incidents</h3>
        <p class="subtitle">Runtime metrics and Lindymode continuity checks are currently clear.</p>
      </article>
    `;
    return;
  }

  listEl.innerHTML = currentIncidents.map(incident => {
    const metrics = incident.metrics || {};
    const sourceLabel = incident.source === 'lindymode' ? 'Lindymode' : 'Runtime';
    const metricLine = incident.source === 'runtime'
      ? `p50 ${Number(metrics.p50 || 0)}ms · p99 ${Number(metrics.p99 || 0)}ms · rollback ${(Number(metrics.rollback_rate || 0) * 100).toFixed(1)}%`
      : `Drift ${(Number(incident.drift_score || 0) * 100).toFixed(0)}% · Chapter ${escapeHtml(incident.chapter_id || '—')}`;

    return `
      <article class="beat-card incident-card ooda-incident-card" data-incident-id="${escapeHtml(incident.incident_id)}">
        <div class="workspace-card-topline">
          <span class="health-pill ${severityClass(incident.severity)}">${escapeHtml(String(incident.severity || 'watch').toUpperCase())}</span>
          <span class="workspace-date">${escapeHtml(sourceLabel)}</span>
        </div>
        <strong>${escapeHtml(incident.event_type || `${sourceLabel} incident`)}</strong>
        <p>${escapeHtml(incident.summary || 'OODA incident detected.')}</p>
        <p class="subtitle">${metricLine}</p>
        <div class="workspace-actions">
          ${incident.correlation_id ? `<button type="button" class="quiet-button view-timeline" data-correlation-id="${escapeHtml(incident.correlation_id)}">View Timeline</button>` : '<span class="workspace-date">No correlation chain</span>'}
          ${incident.source === 'lindymode' ? `<a class="text-link" href="/lindymode_dashboard.html?workspace_id=${encodeURIComponent(incident.workspace_id)}">Open Lindymode</a>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function formatTime(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

async function loadTimeline(correlationId) {
  timelineIntroEl.textContent = `Correlation ${correlationId}`;
  timelineEl.innerHTML = '<p class="subtitle">Loading timeline…</p>';

  try {
    const data = await api(`/api/ooda/timeline/${encodeURIComponent(correlationId)}`);
    if (!data.timeline.length) {
      timelineEl.innerHTML = '<p class="subtitle">No correlated events found.</p>';
      return;
    }

    timelineEl.innerHTML = data.timeline.map(item => `
      <div class="timeline-item ${item.kind === 'incident' ? 'timeline-incident' : 'timeline-event'}">
        <span class="timeline-dot"></span>
        <div>
          <strong>${escapeHtml(item.event_type)}</strong>
          <small>${escapeHtml(formatTime(item.created_at))}</small>
          ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
          ${item.recovery_action ? `<p class="timeline-recovery">Recovery: ${escapeHtml(item.recovery_action)}</p>` : ''}
          ${item.rollback ? '<span class="health-pill health-critical">Rollback</span>' : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    timelineEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function refreshSnapshot() {
  try {
    const snapshot = await api('/api/ooda/snapshot');
      renderIncidents(snapshot.incidents || []);
  } catch (error) {
    listEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

listEl.addEventListener('click', event => {
  const button = event.target.closest('.view-timeline');
  if (button) loadTimeline(button.dataset.correlationId);
});

document.getElementById('refreshSnapshot').addEventListener('click', refreshSnapshot);

const es = window.L99.authenticatedEventStream('/api/ooda/incidents', {
  heartbeat: () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'health-pill health-good';
  },
  incidents: event => {
    try {
      const incidents = JSON.parse(event.data);
      renderIncidents(incidents);
      statusEl.textContent = `Live · ${incidents.length}`;
      statusEl.className = `health-pill ${incidents.some(item => item.severity === 'critical') ? 'health-critical' : incidents.length ? 'health-watch' : 'health-good'}`;
    } catch (error) {
      console.warn('[OODA] Bad payload', event.data, error);
      statusEl.textContent = 'Bad payload';
      statusEl.className = 'health-pill health-critical';
    }
  },
  open: () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'health-pill health-good';
  },
  error: () => {
    statusEl.textContent = 'Reconnecting';
    statusEl.className = 'health-pill health-watch';
  }
});

refreshSnapshot();
