const listEl = document.getElementById('incidentList');
const statusEl = document.getElementById('connectionStatus');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function severityClass(severity) {
  if (severity === 'critical') return 'act-III';
  if (severity === 'warning') return 'act-II';
  return 'act-I';
}

function renderIncidents(incidents) {
  if (!Array.isArray(incidents) || incidents.length === 0) {
    listEl.innerHTML = '<p class="subtitle">No active incidents.</p>';
    return;
  }

  listEl.innerHTML = incidents.map((inc) => {
    const metrics = inc.metrics || {};
    const p99 = Number(metrics.p99 || 0);
    const p50 = Number(metrics.p50 || 0);
    const rollbackRate = Number(metrics.rollback_rate || 0);
    const ratio = p50 > 0 ? (p99 / p50).toFixed(2) : '—';

    return `
      <article class="beat-card incident-card">
        <span class="act-badge ${severityClass(inc.severity)}">${escapeHtml(String(inc.severity || 'info').toUpperCase())}</span>
        <strong>${escapeHtml(inc.workspace_id)} — ${escapeHtml(inc.mode || 'unknown')}</strong>
        <p>${escapeHtml(inc.summary || 'OODA incident detected.')}</p>
        <p class="subtitle">
          p50: ${p50}ms · p99: ${p99}ms · p99/p50: ${ratio} · rollback: ${(rollbackRate * 100).toFixed(1)}%
        </p>
      </article>
    `;
  }).join('');
}

const es = new EventSource('/api/ooda/incidents');

es.addEventListener('heartbeat', () => {
  statusEl.textContent = 'Connected';
});

es.addEventListener('incidents', (event) => {
  try {
    const incidents = JSON.parse(event.data);
    renderIncidents(incidents);
    statusEl.textContent = `Connected · ${incidents.length} active incident${incidents.length === 1 ? '' : 's'}`;
  } catch (error) {
    console.warn('[OODA] Bad payload', event.data, error);
    statusEl.textContent = 'Connected · bad payload received';
  }
});

es.onopen = () => {
  statusEl.textContent = 'Connected';
};

es.onerror = () => {
  statusEl.textContent = 'Reconnecting…';
  console.warn('[OODA] SSE error; browser will retry automatically.');
};
