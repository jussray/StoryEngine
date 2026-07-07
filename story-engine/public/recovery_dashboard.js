const workspaceIdEl = document.getElementById('workspaceId');
const statusEl = document.getElementById('status');
const controlPanelEl = document.getElementById('controlPanel');
const incidentListEl = document.getElementById('incidentList');
const runListEl = document.getElementById('runList');
const genomePanelEl = document.getElementById('genomePanel');

function workspaceId() {
  return workspaceIdEl.value.trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function severityClass(severity) {
  return severity === 'sev3' ? 'health-critical' : severity === 'sev2' ? 'health-watch' : 'health-good';
}

function runClass(status) {
  if (status === 'validated') return 'health-good';
  if (status === 'rolled_back') return 'health-critical';
  return 'health-watch';
}

function renderIncidents(incidents) {
  if (!incidents.length) {
    incidentListEl.innerHTML = '<p class="subtitle">No active incidents.</p>';
    return;
  }

  incidentListEl.innerHTML = incidents.map(incident => `
    <article class="beat-card incident-card">
      <div class="workspace-card-topline">
        <span class="health-pill ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span>
        <span class="workspace-date">Drift ${(Number(incident.drift_score || 0) * 100).toFixed(0)}%</span>
      </div>
      <strong>${escapeHtml(incident.event_type)}</strong>
      <p>${escapeHtml(incident.reason)}</p>
      <div class="workspace-actions">
        <button type="button" class="quiet-button plan-recovery" data-incident-id="${escapeHtml(incident.incident_id)}">Show Plan</button>
        <button type="button" class="run-recovery" data-incident-id="${escapeHtml(incident.incident_id)}">Run Safe Recovery</button>
      </div>
      <div class="recovery-plan-slot" data-plan-for="${escapeHtml(incident.incident_id)}"></div>
    </article>
  `).join('');
}

function renderRuns(runs) {
  if (!runs.length) {
    runListEl.innerHTML = '<p class="subtitle">No recovery runs yet.</p>';
    return;
  }

  runListEl.innerHTML = runs.map(run => `
    <article class="beat-card incident-card">
      <div class="workspace-card-topline">
        <span class="health-pill ${runClass(run.status)}">${escapeHtml(run.status)}</span>
        <span class="workspace-date">${new Date(Number(run.created_at)).toLocaleString()}</span>
      </div>
      <strong>${escapeHtml(run.strategy)}</strong>
      <p>${run.validation?.reason ? escapeHtml(run.validation.reason) : run.validation?.passed ? 'Validation passed.' : 'Validation did not pass.'}</p>
      <p class="subtitle">Reversible: ${run.reversible ? 'yes' : 'no'} · Incident ${escapeHtml(run.incident_id || '—')}</p>
    </article>
  `).join('');
}

function renderGenome(genome) {
  const narrative = genome.narrative || {};
  const operations = genome.operations || {};
  genomePanelEl.innerHTML = `
    <div class="story-health-strip genome-strip">
      <div><span class="health-label">Version</span><strong>v${escapeHtml(genome.version || 1)}</strong></div>
      <div><span class="health-label">Chapters</span><strong>${escapeHtml(narrative.chapter_count || 0)}</strong></div>
      <div><span class="health-label">Words</span><strong>${escapeHtml(narrative.total_words || 0)}</strong></div>
      <div><span class="health-label">Active Drift</span><strong>${escapeHtml(operations.active_incidents || 0)}</strong></div>
    </div>
    <div class="finding-list">
      <div class="release-check"><strong>POV</strong><span>${escapeHtml(narrative.canonical_pov || narrative.dominant_pov_signal || 'unknown')}</span></div>
      <div class="release-check"><strong>Arc</strong><span>${escapeHtml(narrative.arc_stage || 'unset')}</span></div>
      <div class="release-check"><strong>Avg chapter</strong><span>${escapeHtml(narrative.average_chapter_words || 0)} words</span></div>
      <div class="release-check"><strong>Dialogue ratio</strong><span>${Math.round(Number(narrative.average_dialogue_ratio || 0) * 100)}%</span></div>
      <div class="release-check"><strong>Avg drift</strong><span>${Math.round(Number(operations.average_drift || 0) * 100)}%</span></div>
    </div>
  `;
}

async function loadWorkspace() {
  const id = workspaceId();
  if (!id) return;
  statusEl.textContent = 'Loading recovery state…';
  try {
    const [incidents, runs] = await Promise.all([
      request(`/api/lindymode/incidents/${encodeURIComponent(id)}?status=active&limit=100`),
      request(`/api/ooda/recovery-runs/${encodeURIComponent(id)}?limit=50`)
    ]);
    renderIncidents(incidents);
    renderRuns(runs);
    controlPanelEl.classList.remove('hidden');
    statusEl.textContent = `Loaded ${incidents.length} active incident${incidents.length === 1 ? '' : 's'}.`;

    try {
      const genome = await request(`/api/story-genome/${encodeURIComponent(id)}`);
      renderGenome(genome);
    } catch {
      genomePanelEl.innerHTML = '<p class="subtitle">No genome yet. Tap Refresh to build it.</p>';
    }
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function showPlan(incidentId) {
  const slot = document.querySelector(`[data-plan-for="${CSS.escape(incidentId)}"]`);
  if (!slot) return;
  slot.innerHTML = '<p class="subtitle">Planning…</p>';
  try {
    const plan = await request(`/api/ooda/recovery-plan/${encodeURIComponent(incidentId)}`);
    slot.innerHTML = `
      <div class="beat-card">
        <strong>${escapeHtml(plan.strategy)}</strong>
        <p>${escapeHtml(plan.reason)}</p>
        <p class="subtitle">Reversible: ${plan.reversible ? 'yes' : 'no'} · Author required: ${plan.requires_author ? 'yes' : 'no'}</p>
      </div>
    `;
  } catch (error) {
    slot.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function runRecovery(incidentId) {
  statusEl.textContent = 'Running guarded recovery and validation…';
  try {
    const run = await request(`/api/ooda/recover/${encodeURIComponent(incidentId)}`, { method: 'POST', body: '{}' });
    statusEl.textContent = `Recovery ${run.status}.`;
    await loadWorkspace();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function refreshGenome() {
  const id = workspaceId();
  if (!id) return;
  genomePanelEl.innerHTML = '<p class="subtitle">Building Story Genome…</p>';
  try {
    const genome = await request(`/api/story-genome/${encodeURIComponent(id)}/refresh`, { method: 'POST', body: '{}' });
    renderGenome(genome);
  } catch (error) {
    genomePanelEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

incidentListEl.addEventListener('click', event => {
  const planButton = event.target.closest('.plan-recovery');
  const runButton = event.target.closest('.run-recovery');
  if (planButton) showPlan(planButton.dataset.incidentId);
  if (runButton) runRecovery(runButton.dataset.incidentId);
});

document.getElementById('loadWorkspace').addEventListener('click', loadWorkspace);
document.getElementById('refreshIncidents').addEventListener('click', loadWorkspace);
document.getElementById('refreshGenome').addEventListener('click', refreshGenome);

const initialWorkspace = new URLSearchParams(window.location.search).get('workspace_id');
if (initialWorkspace) {
  workspaceIdEl.value = initialWorkspace;
  loadWorkspace();
}
