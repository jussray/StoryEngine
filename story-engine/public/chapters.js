const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');

if (!workspace_id) window.location.href = '/';

const qs = `?workspace_id=${encodeURIComponent(workspace_id)}`;
document.getElementById('homeLink').href = `/story_home.html${qs}`;
document.getElementById('lindymodeLink').href = `/lindymode_dashboard.html${qs}`;

const chapterListEl = document.getElementById('chapterList');
const editorEl = document.getElementById('editor');
const emptyEditorEl = document.getElementById('emptyEditor');
const titleInputEl = document.getElementById('editorTitleInput');
const contentEl = document.getElementById('chapterContent');
const statusEl = document.getElementById('status');
const lindyBadgeEl = document.getElementById('lindyBadge');
const lindySummaryEl = document.getElementById('lindySummary');
const lindyFindingsEl = document.getElementById('lindyFindings');
const lindyRecoveryEl = document.getElementById('lindyRecovery');

let chapters = [];
let currentId = null;
let currentIncidentId = null;
let saveTimer = null;
let dirty = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function renderChapterList() {
  if (!chapters.length) {
    chapterListEl.innerHTML = '<li><p class="subtitle">No chapters yet.</p></li>';
    return;
  }
  chapterListEl.innerHTML = chapters.map((chapter, index) => `
    <li>
      <button class="chapter-btn ${chapter.id === currentId ? 'active' : ''}" data-id="${chapter.id}">
        <span class="chapter-number">${index + 1}</span>
        <span>
          <strong>${escapeHtml(chapter.title)}</strong>
          <small>${(chapter.content || '').trim() ? `${(chapter.content || '').trim().split(/\s+/).length} words` : 'Empty chapter'}</small>
        </span>
      </button>
    </li>
  `).join('');
}

function openChapter(id) {
  const chapter = chapters.find(item => Number(item.id) === Number(id));
  if (!chapter) return;
  currentId = Number(chapter.id);
  currentIncidentId = null;
  titleInputEl.value = chapter.title || '';
  contentEl.value = chapter.content || '';
  dirty = false;
  editorEl.classList.remove('hidden');
  emptyEditorEl.classList.add('hidden');
  renderChapterList();
  resetLindyPanel();
}

function resetLindyPanel() {
  lindyBadgeEl.textContent = 'Ready';
  lindyBadgeEl.className = 'health-pill health-good';
  lindySummaryEl.textContent = 'Save or run Lindymode to analyze this chapter.';
  lindyFindingsEl.innerHTML = '';
  lindyRecoveryEl.classList.add('hidden');
}

function renderQueuedDispatch(dispatch) {
  currentIncidentId = null;
  lindyBadgeEl.textContent = dispatch?.deduplicated ? 'Already queued' : 'Queued';
  lindyBadgeEl.className = 'health-pill health-watch';
  lindySummaryEl.textContent = dispatch?.dispatch_id
    ? `Background analysis queued. Dispatch ${dispatch.dispatch_id}.`
    : 'Background analysis queued.';
  lindyFindingsEl.innerHTML = '';
  lindyRecoveryEl.classList.add('hidden');
}

async function loadWorkspace() {
  try {
    const story = await api(`/api/story/${encodeURIComponent(workspace_id)}`);
    document.getElementById('workspaceTitle').textContent = story.title || 'Writing Room';
    document.title = `${story.title || 'Writing Room'} — L99`;
  } catch {
    document.getElementById('workspaceTitle').textContent = 'Writing Room';
  }
}

async function loadHealth() {
  try {
    const [stateResult, incidents] = await Promise.all([
      fetch(`/api/lindymode/state/${encodeURIComponent(workspace_id)}`).then(async response => response.ok ? response.json() : null),
      api(`/api/lindymode/incidents/${encodeURIComponent(workspace_id)}?status=active&limit=100`)
    ]);
    document.getElementById('activeDrift').textContent = String(incidents.length);
    document.getElementById('povStatus').textContent = stateResult?.pov ? stateResult.pov.replaceAll('_', ' ') : 'Not set';
    document.getElementById('stateVersion').textContent = stateResult?.version ? `v${stateResult.version}` : '—';
    const hasCritical = incidents.some(item => item.severity === 'sev3');
    const healthStatus = document.getElementById('healthStatus');
    healthStatus.textContent = hasCritical ? 'Critical' : incidents.length ? 'Needs review' : 'Healthy';
    healthStatus.className = hasCritical ? 'health-text-critical' : incidents.length ? 'health-text-watch' : 'health-text-good';
  } catch {
    document.getElementById('healthStatus').textContent = 'Unavailable';
  }
}

async function loadChapters(selectId = null) {
  chapters = await api(`/api/chapters/${encodeURIComponent(workspace_id)}`);
  renderChapterList();
  if (selectId) openChapter(selectId);
}

function scheduleAutosave() {
  dirty = true;
  setStatus('Unsaved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveChapter({ silent: true }), 1200);
}

function renderLindyResult(result) {
  const incidents = Array.isArray(result?.incidents) ? result.incidents : [];
  if (!incidents.length) {
    currentIncidentId = null;
    lindyBadgeEl.textContent = 'Healthy';
    lindyBadgeEl.className = 'health-pill health-good';
    lindySummaryEl.textContent = 'No continuity drift detected in this chapter.';
    lindyFindingsEl.innerHTML = '';
    lindyRecoveryEl.classList.add('hidden');
    return;
  }
  const incident = incidents[0];
  currentIncidentId = incident.incident_id;
  const severityClass = incident.severity === 'sev3' ? 'health-critical' : 'health-watch';
  lindyBadgeEl.textContent = incident.severity === 'sev3' ? 'Critical drift' : 'Review drift';
  lindyBadgeEl.className = `health-pill ${severityClass}`;
  lindySummaryEl.textContent = incident.reason || 'Lindymode detected story drift.';
  const findings = Array.isArray(incident.details?.findings) ? incident.details.findings : [];
  lindyFindingsEl.innerHTML = findings.length
    ? `<ul class="finding-list">${findings.map(item => `<li><strong>${escapeHtml(item.type.replaceAll('_', ' '))}</strong><span>${escapeHtml(item.message)}</span></li>`).join('')}</ul>`
    : '';
  lindyRecoveryEl.classList.remove('hidden');
}

async function saveChapter({ silent = false } = {}) {
  if (!currentId || !dirty && silent) return;
  clearTimeout(saveTimer);
  if (!silent) setStatus('Saving…');
  try {
    const result = await api(`/api/chapters/${currentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: titleInputEl.value.trim() || 'Untitled Chapter',
        content: contentEl.value
      })
    });
    dirty = false;
    setStatus(result.dispatch?.deduplicated ? 'Already queued' : 'Saved · queued');
    renderQueuedDispatch(result.dispatch);
    await Promise.all([loadChapters(currentId), loadHealth()]);
    setTimeout(() => { if (!dirty) setStatus(''); }, 2200);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function analyzeCurrentChapter() {
  if (!currentId) return;
  lindyBadgeEl.textContent = 'Analyzing';
  lindyBadgeEl.className = 'health-pill health-watch';
  lindySummaryEl.textContent = 'Lindymode is checking continuity, POV, and context budget.';
  try {
    const result = await api(`/api/lindymode/analyze/${currentId}`, { method: 'POST', body: '{}' });
    renderLindyResult(result);
    await loadHealth();
  } catch (error) {
    lindyBadgeEl.textContent = 'Error';
    lindyBadgeEl.className = 'health-pill health-critical';
    lindySummaryEl.textContent = error.message;
  }
}

async function markRecovered() {
  if (!currentIncidentId) return;
  try {
    await api(`/api/lindymode/recover/${encodeURIComponent(currentIncidentId)}`, {
      method: 'POST',
      body: JSON.stringify({ recovery_action: 'resolved_in_writing_room' })
    });
    currentIncidentId = null;
    lindyBadgeEl.textContent = 'Recovered';
    lindyBadgeEl.className = 'health-pill health-good';
    lindySummaryEl.textContent = 'Recovery recorded. Run Lindymode again after editing to confirm continuity.';
    lindyFindingsEl.innerHTML = '';
    lindyRecoveryEl.classList.add('hidden');
    await loadHealth();
  } catch (error) {
    lindySummaryEl.textContent = error.message;
  }
}

chapterListEl.addEventListener('click', event => {
  const button = event.target.closest('.chapter-btn');
  if (button) openChapter(Number(button.dataset.id));
});

document.getElementById('addBtn').addEventListener('click', async () => {
  const input = document.getElementById('newTitle');
  const title = input.value.trim();
  if (!title) return;
  try {
    const result = await api(`/api/chapters/${encodeURIComponent(workspace_id)}`, {
      method: 'POST',
      body: JSON.stringify({ title, position: chapters.length })
    });
    input.value = '';
    renderQueuedDispatch(result.dispatch);
    await Promise.all([loadChapters(Number(result.id)), loadHealth()]);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('saveChapter').addEventListener('click', () => saveChapter());
document.getElementById('analyzeChapter').addEventListener('click', analyzeCurrentChapter);
document.getElementById('markRecovered').addEventListener('click', markRecovered);
titleInputEl.addEventListener('input', scheduleAutosave);
contentEl.addEventListener('input', scheduleAutosave);

Promise.all([loadWorkspace(), loadHealth(), loadChapters()]);
