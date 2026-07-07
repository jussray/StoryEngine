document.getElementById('storyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const genre = document.getElementById('genre').value.trim();
  const pitch = document.getElementById('pitch').value.trim();
  const errEl = document.getElementById('error');

  try {
    const res = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, genre, pitch }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    window.location.href = `/story_home.html?workspace_id=${data.workspace_id}`;
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});
