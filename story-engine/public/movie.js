const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');
document.getElementById('homeLink').href = `/story_home.html?workspace_id=${workspace_id}`;

async function loadBeats() {
  const beats = await fetch(`/api/movie/beats/${workspace_id}`).then(r => r.json());
  const container = document.getElementById('beats');
  if (!beats.length) {
    container.innerHTML = '<p>No beats yet. Generate from chapters.</p>';
    return;
  }
  container.innerHTML = beats.map(b => `
    <div class="beat-card" data-id="${b.id}">
      <span class="act-badge act-${b.act}">Act ${b.act}</span>
      <strong>${b.beat}</strong>
      <textarea class="logline" rows="2">${b.logline || ''}</textarea>
      <button class="save-beat" data-id="${b.id}">Save beat</button>
    </div>
  `).join('');

  container.querySelectorAll('.save-beat').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.beat-card');
      const logline = card.querySelector('.logline').value;
      await fetch(`/api/movie/beats/${btn.dataset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logline, workspace_id })
      });
      btn.dataset.saveState = 'saved';
      btn.textContent = 'Saved ✓';
      setTimeout(() => {
        btn.textContent = 'Save beat';
        delete btn.dataset.saveState;
      }, 1500);
    });
  });
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const button = document.getElementById('generateBtn');
  const container = document.getElementById('beats');
  button.disabled = true;
  button.textContent = 'Checking Release Gate…';

  try {
    const response = await fetch(`/api/movie/beats/generate/${workspace_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow_warning: true })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const blockers = result.gate?.blockers || [];
      container.innerHTML = `
        <div class="beat-card">
          <strong>Release Gate blocked Movie Mode</strong>
          <p>${result.error || 'Workspace is not ready.'}</p>
          ${blockers.length ? `<ul>${blockers.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
          <a href="/decision_dashboard.html?workspace_id=${encodeURIComponent(workspace_id)}">Open OODA Decision</a>
        </div>`;
      return;
    }

    await loadBeats();
  } finally {
    button.disabled = false;
    button.textContent = 'Generate from chapters';
  }
});

loadBeats();
