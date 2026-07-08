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
  const a = data.release_attempts || {};
  overviewEl.innerHTML = `
    <div><span class="health-label">Workspaces</span><strong>${o.workspaces}</strong></div>
    <div><span class="health-label">Gate Ready</span><strong>${o.release_gate_ready ?? 0}</strong></div>
    <div><span class="health-label">Gate Warning</span><strong>${o.release_gate_warning ?? 0}</strong></div>
    <div><span class="health-label">Gate Stopped</span><strong>${o.release_gate_blocked_count ?? 0}</strong></div>
    <div><span class="health-label">Attempts</span><strong>${a.total ?? 0}</strong></div>
    <div><span class="health-label">Attempt Failures</span><strong>${(a.blocked ?? 0) + (a.failed ?? 0)}</strong></div>
    <div><span class="health-label">Queue</span><strong>${o.queue_depth}</strong></div>
    <div><span class="health-label">Live Events</span><strong>${o.live_event_count ?? 0}</strong></div>`;

  workspaceListEl.innerHTML = data.workspaces.length ? data.workspaces.map(item => {
    const attempt = item.latest_release_attempt;
    return `
      <article class="beat-card incident-card">
        <strong>${esc(item.title)}</strong>
        <p>Release Gate: ${esc(item.release_gate_status || 'UNKNOWN')} · Risk: ${esc(item.predicted_risk)}</p>
        <p class="subtitle">Confidence ${item.confidence_score}% · ${item.chapter_count} chapters · ${item.active_incidents} incidents</p>
        ${attempt ? `<p class="subtitle">Latest attempt: ${esc(attempt.operation)} · ${esc(attempt.status)} · ${fmtTime(attempt.created_at)}</p>` : '<p class="subtitle">No release attempts yet.</p>'}
        ${attempt?.error ? `<p class="subtitle">${esc(attempt.error)}</p>` : ''}
        ${item.release_gate_reasons?.length ? `<p class="subtitle">${esc(item.release_gate_reasons[0])}</p>` : ''}
        <a href="/release_gate.html?workspace_id=${encodeURIComponent(item.workspace_id)}">Open Release Gate</a>
        <span> · </span>
        <a href="/runtime_dashboard.html?workspace_id=${encodeURIComponent(item.workspace_id)}">Open runtime ledger</a>
      </article>`;
  }).join('') : '<p class="subtitle">No workspaces.</p>';

  queueListEl.innerHTML = data.queue.length ? data.queue.map(item => `
    <div class="release-check"><strong>${esc(item.status)}</strong><span>${esc(item.trigger_type)} · ${esc(item.workspace_id)}</span></div>`).join('') : '<p class="subtitle">Queue is empty.</p>';

  incidentListEl.innerHTML = data.incidents.length ? data.incidents.map(item => `
    <div class="timeline-item timeline-event"><span class="timeline-dot"></span><div><strong>${esc(item.event_type || item.source)}</strong><p>${esc(item.summary)}</p></div></div>`).join('') : '<p class="subtitle">No active incidents.</p>';

  recoveryStatsEl.innerHTML = `
    <div class="release-check"><strong>Attempts completed</strong><span>${a.completed ?? 0}</span></div>
    <div class="release-check"><strong>Attempts blocked</strong><span>${a.blocked ?? 0}</span></div>
    <div class="release-check"><strong>Attempts failed</strong><span>${a.failed ?? 0}</span></div>
    <div class="release-check"><strong>Attempts running</strong><span>${a.running ?? 0}</span></div>
    <div class="release-check"><strong>Validated recoveries</strong><span>${data.recovery.validated}</span></div>
    <div class="release-check"><strong>Oldest live event</strong><span>${fmtTime(r.oldest_live_event_at)}</span></div>
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
