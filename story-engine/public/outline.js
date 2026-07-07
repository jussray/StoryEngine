const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');
document.getElementById('homeLink').href = `/story_home.html?workspace_id=${workspace_id}`;

fetch(`/api/outline/${workspace_id}`)
  .then(r => r.json())
  .then(data => {
    document.getElementById('outlineContent').value = data.content || '';
  });

document.getElementById('saveBtn').addEventListener('click', async () => {
  const content = document.getElementById('outlineContent').value;
  const status = document.getElementById('status');
  const res = await fetch(`/api/outline/${workspace_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  status.textContent = res.ok ? 'Saved ✓' : 'Error saving';
  setTimeout(() => (status.textContent = ''), 2000);
});
