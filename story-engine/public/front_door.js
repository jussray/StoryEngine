const form = document.getElementById('storyForm');
const createPanel = document.getElementById('createPanel');
const workspaceList = document.getElementById('workspaceList');
const errEl = document.getElementById('error');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return 'No activity yet';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  }).format(date);
}

function healthMeta(story) {
  const count = Number(story.active_incident_count || 0);
  if (count === 0) return { label: 'Healthy', className: 'health-good' };
  if (story.highest_severity === 'sev3') return { label: `${count} critical`, className: 'health-critical' };
  return { label: `${count} drift alert${count === 1 ? '' : 's'}`, className: 'health-watch' };
}

function renderStories(stories) {
  if (!stories.length) {
    workspaceList.innerHTML = `
      <article class="beat-card empty-state">
        <p class="eyebrow">Start here</p>
        <h3>No story worlds yet</h3>
        <p class="subtitle">Create your first workspace and L99 will begin tracking chapters, continuity, and production health.</p>
        <button type="button" data-create-story>Create New Story</button>
      </article>
    `;
    return;
  }

  workspaceList.innerHTML = stories.map(story => {
    const health = healthMeta(story);
    const lastActivity = story.last_activity_at || story.updated_at || story.created_at;
    return `
      <article class="workspace-card">
        <div class="workspace-card-topline">
          <span class="health-pill ${health.className}">${escapeHtml(health.label)}</span>
          <span class="workspace-date">${escapeHtml(formatDate(lastActivity))}</span>
        </div>
        <h3>${escapeHtml(story.title)}</h3>
        <p class="workspace-genre">${escapeHtml(story.genre || 'Unclassified story')}</p>
        <p class="workspace-pitch">${escapeHtml(story.pitch || 'No pitch added yet.')}</p>
        <div class="workspace-stats">
          <span>${Number(story.chapter_count || 0)} chapter${Number(story.chapter_count || 0) === 1 ? '' : 's'}</span>
          <span>${Number(story.active_incident_count || 0)} active incident${Number(story.active_incident_count || 0) === 1 ? '' : 's'}</span>
        </div>
        <div class="workspace-actions">
          <a class="button-link" href="/story_home.html?workspace_id=${encodeURIComponent(story.workspace_id)}">Open Workspace</a>
          <a class="text-link" href="/lindymode_dashboard.html?workspace_id=${encodeURIComponent(story.workspace_id)}">Lindymode</a>
        </div>
      </article>
    `;
  }).join('');
}

async function loadStories() {
  workspaceList.innerHTML = '<div class="beat-card"><p class="subtitle">Loading workspaces…</p></div>';
  try {
    const response = await fetch('/api/stories');
    const stories = await response.json();
    if (!response.ok) throw new Error(stories.error || 'Could not load workspaces.');
    renderStories(stories);
  } catch (error) {
    workspaceList.innerHTML = `<div class="beat-card"><p class="error">${escapeHtml(error.message)}</p></div>`;
  }
}

function showCreateForm() {
  createPanel.classList.remove('hidden');
  document.getElementById('title').focus();
  createPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideCreateForm() {
  createPanel.classList.add('hidden');
  errEl.classList.add('hidden');
}

document.getElementById('showCreateForm').addEventListener('click', showCreateForm);
document.getElementById('hideCreateForm').addEventListener('click', hideCreateForm);
document.getElementById('refreshStories').addEventListener('click', loadStories);
workspaceList.addEventListener('click', event => {
  if (event.target.closest('[data-create-story]')) showCreateForm();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const title = document.getElementById('title').value.trim();
  const genre = document.getElementById('genre').value.trim();
  const pitch = document.getElementById('pitch').value.trim();

  try {
    const response = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, genre, pitch })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create workspace.');
    window.location.href = `/story_home.html?workspace_id=${encodeURIComponent(data.workspace_id)}`;
  } catch (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
  }
});

loadStories();
