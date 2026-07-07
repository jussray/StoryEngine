const workspaceIdEl = document.getElementById('workspaceId');
const statusEl = document.getElementById('status');
const runListEl = document.getElementById('runList');
const stepListEl = document.getElementById('stepList');
const runTitleEl = document.getElementById('runTitle');
const runSummaryEl = document.getElementById('runSummary');

function currentWorkspace() {
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
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function badge(status) {
  if (['failed', 'rolled_back', 'blocked'].includes(status)) return 'health-critical';
  if (['running', 'author_required', 'awaiting_author'].includes(status)) return 'health-watch';
  return 'health-good';
}

function showRun(run) {
  runTitleEl.textContent = `${run.trigger_type} · ${run.status}`;
  runSummaryEl.textContent = `Correlation ${run.correlation_id}`;
  const steps = Array.isArray(run.steps) ? run.steps : [];
  stepListEl.innerHTML = steps.length ? steps.map(item => `
    <div class="timeline-item timeline-event">
      <span class="timeline-dot"></span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(new Date(Number(item.at)).toLocaleString())}</small>
        <span class="health-pill ${badge(item.status)}">${escapeHtml(item.status)}</span>
        <p>${escapeHtml(Object.entries(item.data || {}).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · '))}</p>
      </div>
    </div>
  `).join('') : '<p class="subtitle">No steps recorded.</p>';
}

function showRuns(runs) {
  if (!runs.length) {
    runListEl.innerHTML = '<p class="subtitle">No autonomous runtime runs yet.</p>';
    return;
  }
  runListEl.innerHTML = runs.map(run => `
    <article class="beat-card incident-card">
      <div class="workspace-card-topline">
        <span class="health-pill ${badge(run.status)}">${escapeHtml(run.status)}</span>
        <span class="workspace-date">${escapeHtml(new Date(Number(run.created_at)).toLocaleString())}</span>
      </div>
      <strong>${escapeHtml(run.trigger_type)}</strong>
      <p class="subtitle">${escapeHtml(run.correlation_id)}</p>
      <button class="quiet-button view-run" type="button" data-run-id="${escapeHtml(run.run_id)}">View Chain</button>
    </article>
  `).join('');
}

async function loadRuns() {
  const id = currentWorkspace();
  if (!id) return;
  statusEl.textContent = 'Loading runtime ledger…';
  try {
    const runs = await request(`/api/runtime/runs/${encodeURIComponent(id)}?limit=100`);
    showRuns(runs);
    statusEl.textContent = `Loaded ${runs.length} runtime run${runs.length === 1 ? '' : 's'}.`;
    if (runs[0]) showRun(runs[0]);
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function runNow() {
  const id = currentWorkspace();
  if (!id) return;
  statusEl.textContent = 'Running autonomous workspace evaluation…';
  try {
    const run = await request(`/api/runtime/run/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ trigger_type: 'manual_runtime_run', allow_recovery: true })
    });
    showRun(run);
    await loadRuns();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

runListEl.addEventListener('click', async event => {
  const button = event.target.closest('.view-run');
  if (!button) return;
  try {
    showRun(await request(`/api/runtime/run/${encodeURIComponent(button.dataset.runId)}`));
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

document.getElementById('loadRuns').addEventListener('click', loadRuns);
document.getElementById('runNow').addEventListener('click', runNow);

const initialWorkspace = new URLSearchParams(window.location.search).get('workspace_id');
if (initialWorkspace) {
  workspaceIdEl.value = initialWorkspace;
  loadRuns();
}
