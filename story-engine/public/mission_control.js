const statusEl = document.getElementById('status');
const overviewEl = document.getElementById('overview');
const workspaceListEl = document.getElementById('workspaceList');
const queueListEl = document.getElementById('queueList');
const incidentListEl = document.getElementById('incidentList');
const recoveryStatsEl = document.getElementById('recoveryStats');

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function fmtTime(value) {
  return value ? new Date(Number(value)).toLocaleString() : '—';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function render(data) {
  const o = data.overview;
  const r = data.retention || {};
  overviewEl.innerHTML = `
    <div><span class="health-label">Workspaces</span><strong>${o.workspaces}</strong></div>
    <div><span class="health-label">Incidents</span><strong>${o.active_incidents}</strong></div>
    <div><span class="health-label">Queue</span><strong>${o.queue_depth}</strong></div>
    <div><span class="health-label">Live Events</span><strong>${o.live_event_count ?? 0}</strong></div>
    <div><span class="health-label">Compacted</span><strong>${o.compacted_episode_count ?? 0}</strong></div>
    <div><span class="health-label">Recovery</span><strong>${o.recovery_success_rate == null ? '—' : Math.round(o.recovery_success_rate * 100) + '%'}</strong></div>`;

  workspaceListEl.innerHTML = data.workspaces.length ? data.workspaces.map(item => `
    <article class="beat-card incident-card">
      <strong>${esc(item.title)}</strong>
      <p>${esc(item.release_result)} · ${esc(item.predicted_risk)}</p>
      <p class="subtitle">Confidence ${item.confidence_score}% · ${item.chapter_count} chapters · ${item.active_incidents} incidents</p>
      <a href="/runtime_dashboard.html?workspace_id=${encodeURIComponent(item.workspace_id)}">Open runtime ledger</a>
    </article>`).join('') : '<p class="subtitle">No workspaces.</p>';

  queueListEl.innerHTML = data.queue.length ? data.queue.map(item => `
    <div class="release-check"><strong>${esc(item.status)}</strong><span>${esc(item.trigger_type)} · ${esc(item.workspace_id)}</span></div>`).join('') : '<p class="subtitle">Queue is empty.</p>';

  incidentListEl.innerHTML = data.incidents.length ? data.incidents.map(item => `
    <div class="timeline-item timeline-event"><span class="timeline-dot"></span><div><strong>${esc(item.event_type || item.source)}</strong><p>${esc(item.summary)}</p></div></div>`).join('') : '<p class="subtitle">No active incidents.</p>';

  recoveryStatsEl.innerHTML = `
    <div class="release-check"><strong>Validated</strong><span>${data.recovery.validated}</span></div>
    <div class="release-check"><strong>Rolled back</strong><span>${data.recovery.rolled_back}</span></div>
    <div class="release-check"><strong>Awaiting author</strong><span>${data.recovery.awaiting_author}</span></div>
    <div class="release-check"><strong>Oldest live event</strong><span>${fmtTime(r.oldest_live_event_at)}</span></div>
    <div class="release-check"><strong>Eligible events</strong><span>${r.eligible_event_count ?? 0}</span></div>
    <div class="release-check"><strong>Last compaction</strong><span>${fmtTime(r.last_compacted_at)}</span></div>
    <button id="runRetention" class="quiet-button" type="button">Run Retention</button>`;

  document.getElementById('runRetention')?.addEventListener('click', runRetention);
}

async function load() {
  statusEl.textContent = 'Loading mission state…';
  try {
    const data = await api('/api/mission-control/snapshot');
    render(data);
    statusEl.textContent = `Updated ${new Date(data.generated_at).toLocaleString()}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function scan() {
  await api('/api/runtime/scan', { method: 'POST', body: '{}' });
  await load();
}

async function drain() {
  await api('/api/runtime/drain', { method: 'POST', body: '{"limit":10}' });
  await load();
}

async function runRetention() {
  statusEl.textContent = 'Running event retention…';
  await api('/api/events/retention/run', { method: 'POST', body: '{"limit":100}' });
  await load();
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('scanNow').addEventListener('click', scan);
document.getElementById('drainNow').addEventListener('click', drain);
load();
