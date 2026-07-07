const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');
document.getElementById('homeLink').href = `/story_home.html?workspace_id=${workspace_id}`;

let currentId = null;

async function loadChapters() {
  const chapters = await fetch(`/api/chapters/${workspace_id}`).then(r => r.json());
  const list = document.getElementById('chapterList');
  list.innerHTML = chapters.map((c, i) =>
    `<li><button class="chapter-btn" data-id="${c.id}" data-title="${c.title}" data-content="${encodeURIComponent(c.content || '')}">${i + 1}. ${c.title}</button></li>`
  ).join('');
  list.querySelectorAll('.chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentId = Number(btn.dataset.id);
      document.getElementById('editorTitle').textContent = btn.dataset.title;
      document.getElementById('chapterContent').value = decodeURIComponent(btn.dataset.content);
      document.getElementById('editor').classList.remove('hidden');
    });
  });
}

document.getElementById('addBtn').addEventListener('click', async () => {
  const title = document.getElementById('newTitle').value.trim();
  if (!title) return;
  await fetch(`/api/chapters/${workspace_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  document.getElementById('newTitle').value = '';
  loadChapters();
});

document.getElementById('saveChapter').addEventListener('click', async () => {
  if (!currentId) return;
  const content = document.getElementById('chapterContent').value;
  const status = document.getElementById('status');
  const res = await fetch(`/api/chapters/${currentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  status.textContent = res.ok ? 'Saved ✓' : 'Error';
  setTimeout(() => (status.textContent = ''), 2000);
  loadChapters();
});

loadChapters();
