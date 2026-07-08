const params = new URLSearchParams(window.location.search);
const workspaceId = params.get('workspace_id');
const statusEl = document.getElementById('status');
const overviewEl = document.getElementById('overview');
const reasonListEl = document.getElementById('reasonList');
const actionListEl = document.getElementById('actionList');
const metricListEl = document.getElementById('metricList');

document.getElementById('homeLink').href = workspaceId
  ? `/story_home.html?workspace_id=${encodeURIComponent(workspaceId)}`
  : '/front_door.html';

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function render(gate) {
  overviewEl.innerHTML = `
    <div><span class="health-label">Status</span><strong>${esc(gate.status)}</strong></div>
    <div><span class="health-label">Confidence</span><strong>${gate.confidence}%</strong></div>
    <div><span class="health-label">Incidents</span><strong>${gate.metrics.active_incidents}</strong></div>
    <div><span class="health-label">p99</span><strong>${gate.metrics.p99}ms</strong></div>
    <div><span class="health-label">Runtime</span><strong>${esc(gate.metrics.runtime_status)}</strong></div>`;

  reasonListEl.innerHTML = gate.reasons.length ? gate.reasons.map(reason => `
    <div class="release-check"><strong>${gate.blockers.includes(reason) ? 'Stop' : 'Review'}</strong><span>${esc(reason)}</span></div>
  `).join('') : '<p class="subtitle">No blockers or warnings.</p>';

  actionListEl.innerHTML = gate.recommended_actions.length ? gate.recommended_actions.map(action => `
    <div class="timeline-item timeline-event"><span class="timeline-dot"></span><div><p>${esc(action)}</p></div></div>
  `).join('') : '<p class="subtitle">No action needed.</p>';

  metricListEl.innerHTML = Object.entries(gate.metrics).map(([key, value]) => `
    <div class="release-check"><strong>${esc(key.replaceAll('_', ' '))}</strong><span>${esc(value)}</span></div>
  `).join('');
}

async function loadGate() {
  if (!workspaceId) return;
  statusEl.textContent = 'Checking Release Gate…';
  try {
    const gate = await api(`/api/release/gate/${encodeURIComponent(workspaceId)}`);
    render(gate);
    statusEl.textContent = `Gate checked at ${new Date(gate.generated_at).toLocaleString()}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function auditGate() {
  if (!workspaceId) return;
  statusEl.textContent = 'Recording Release Gate audit…';
  try {
    const gate = await api(`/api/release/gate/${encodeURIComponent(workspaceId)}/audit`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'manual_release_gate_audit' })
    });
    render(gate);
    statusEl.textContent = `Audit recorded: ${gate.audit_id}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

document.getElementById('refreshGate').addEventListener('click', loadGate);
document.getElementById('auditGate').addEventListener('click', auditGate);
loadGate();
