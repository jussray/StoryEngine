const workspaceIdEl = document.getElementById('workspaceId');
const workspaceStatusEl = document.getElementById('workspaceStatus');
const summaryEl = document.getElementById('summary');
const povEl = document.getElementById('pov');
const arcStageEl = document.getElementById('arcStage');
const tokenBudgetEl = document.getElementById('tokenBudget');
const rulesEl = document.getElementById('rules');
const saveStatusEl = document.getElementById('saveStatus');
const chapterIdEl = document.getElementById('chapterId');
const analysisResultEl = document.getElementById('analysisResult');
const incidentListEl = document.getElementById('incidentList');

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function fillState(state) {
  summaryEl.value = state?.summary || '';
  povEl.value = state?.pov || '';
  arcStageEl.value = state?.arc_stage || '';
  tokenBudgetEl.value = Number(state?.token_budget || 0);
  rulesEl.value = JSON.stringify(state?.state?.continuity_rules || [], null, 2);
}

async function loadWorkspace() {
  const id = workspaceId();
  if (!id) return;
  workspaceStatusEl.textContent = 'Loading…';
  try {
    const state = await api(`/api/lindymode/state/${encodeURIComponent(id)}`);
    fillState(state);
    workspaceStatusEl.textContent = `Loaded state version ${state.version}.`;
  } catch (error) {
    fillState(null);
    workspaceStatusEl.textContent = `${error.message}. You can create the state below.`;
  }
  await loadIncidents();
}

async function saveState() {
  const id = workspaceId();
  if (!id) {
    saveStatusEl.textContent = 'Workspace ID required.';
    return;
  }

  let continuityRules;
  try {
    continuityRules = JSON.parse(rulesEl.value || '[]');
    if (!Array.isArray(continuityRules)) throw new Error('Rules must be an array.');
  } catch (error) {
    saveStatusEl.textContent = `Invalid rules JSON: ${error.message}`;
    return;
  }

  saveStatusEl.textContent = 'Saving…';
  try {
    const state = await api(`/api/lindymode/state/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        summary: summaryEl.value,
        pov: povEl.value,
        arc_stage: arcStageEl.value,
        token_budget: Number(tokenBudgetEl.value || 0),
        state: { continuity_rules: continuityRules }
      })
    });
    saveStatusEl.textContent = `Saved version ${state.version}.`;
    workspaceStatusEl.textContent = `Loaded state version ${state.version}.`;
  } catch (error) {
    saveStatusEl.textContent = error.message;
  }
}

async function analyzeChapter() {
  const chapterId = Number(chapterIdEl.value);
  if (!chapterId) {
    analysisResultEl.textContent = 'A valid chapter ID is required.';
    return;
  }
  analysisResultEl.textContent = 'Analyzing…';
  try {
    const result = await api(`/api/lindymode/analyze/${chapterId}`, {
      method: 'POST',
      body: '{}'
    });
    analysisResultEl.textContent = JSON.stringify(result, null, 2);
    await loadIncidents();
  } catch (error) {
    analysisResultEl.textContent = error.message;
  }
}

function incidentCard(incident) {
  const details = incident.details || {};
  const findings = Array.isArray(details.findings) ? details.findings : [];
  return `
    <article class="beat-card incident-card">
      <span class="act-badge ${incident.severity === 'sev3' ? 'act-III' : incident.severity === 'sev2' ? 'act-II' : 'act-I'}">
        ${escapeHtml(incident.severity)}
      </span>
      <strong>${escapeHtml(incident.event_type)}</strong>
      <p>${escapeHtml(incident.reason)}</p>
      <p class="subtitle">Chapter ${escapeHtml(incident.chapter_id || '—')} · Drift ${(Number(incident.drift_score || 0) * 100).toFixed(0)}% · ${escapeHtml(incident.status)}</p>
      ${findings.length ? `<ul>${findings.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>` : ''}
      ${incident.status === 'active' ? `<button class="resolve-incident" data-id="${escapeHtml(incident.incident_id)}">Mark Recovered</button>` : ''}
    </article>
  `;
}

async function loadIncidents() {
  const id = workspaceId();
  if (!id) return;
  incidentListEl.innerHTML = '<p class="subtitle">Loading incidents…</p>';
  try {
    const incidents = await api(`/api/lindymode/incidents/${encodeURIComponent(id)}?limit=100`);
    incidentListEl.innerHTML = incidents.length
      ? incidents.map(incidentCard).join('')
      : '<p class="subtitle">No Lindymode incidents for this workspace.</p>';
  } catch (error) {
    incidentListEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function recoverIncident(incidentId) {
  try {
    await api(`/api/lindymode/recover/${encodeURIComponent(incidentId)}`, {
      method: 'POST',
      body: JSON.stringify({ recovery_action: 'reviewed_in_lindymode_dashboard' })
    });
    await loadIncidents();
  } catch (error) {
    window.alert(error.message);
  }
}

document.getElementById('loadWorkspace').addEventListener('click', loadWorkspace);
document.getElementById('saveState').addEventListener('click', saveState);
document.getElementById('analyzeChapter').addEventListener('click', analyzeChapter);
document.getElementById('refreshIncidents').addEventListener('click', loadIncidents);
incidentListEl.addEventListener('click', (event) => {
  const button = event.target.closest('.resolve-incident');
  if (button) recoverIncident(button.dataset.id);
});

const initialWorkspace = new URLSearchParams(window.location.search).get('workspace_id');
if (initialWorkspace) {
  workspaceIdEl.value = initialWorkspace;
  loadWorkspace();
}
