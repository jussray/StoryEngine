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
        body: JSON.stringify({ logline, workspace_id }),
      });
      btn.textContent = 'Saved ✓';
      setTimeout(() => (btn.textContent = 'Save beat'), 1500);
    });
  });
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  await fetch(`/api/movie/beats/generate/${workspace_id}`, { method: 'POST' });
  loadBeats();
});

loadBeats();
