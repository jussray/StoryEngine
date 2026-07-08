const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
  return data;
}

function renderOne(result) {
  $('summary').innerHTML = `<h2>${esc(result.chapter.title)}</h2><p class="sub">${esc(result.action)} · chapter ${result.planned.chapter_number} · memory diffs ${result.memory.diff_count} · runtime ${esc(result.dispatch?.status || 'queued')}</p>`;
  $('chapters').innerHTML = `<article class="chapter"><h3>${esc(result.chapter.title)}</h3><p class="meta">DB id ${result.chapter.id} · planned ${esc(result.planned.chapter_id)}</p><pre>${esc(result.chapter.content)}</pre></article>`;
}

function renderMany(results) {
  $('summary').innerHTML = `<h2>Built ${results.length} chapters</h2><p class="sub">All planned chapters were created or updated and queued for Runtime review.</p>`;
  $('chapters').innerHTML = results.map(result => `<article class="chapter"><h3>${esc(result.chapter.title)}</h3><p class="meta">${esc(result.action)} · ${esc(result.planned.chapter_id)} · runtime ${esc(result.dispatch?.status || 'queued')}</p><pre>${esc(result.chapter.content)}</pre></article>`).join('');
}

async function loadWorkspaces() {
  const stories = await api('/api/stories');
  $('workspace').innerHTML = stories.map(story => `<option value="${esc(story.workspace_id)}">${esc(story.title)}</option>`).join('');
}

$('builderForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('status').textContent = 'Building chapter…';
  try {
    const result = await api('/api/studio/chapters/build', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: $('workspace').value,
        chapter_number: Number($('chapterNumber').value),
        word_target: Number($('wordTarget').value)
      })
    });
    renderOne(result);
    $('status').textContent = `Chapter ${result.action}.`;
  } catch (error) {
    $('status').textContent = error.message;
  }
});

$('buildAll').addEventListener('click', async () => {
  $('status').textContent = 'Building all chapters…';
  try {
    const result = await api('/api/studio/chapters/build-all', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: $('workspace').value,
        word_target: Number($('wordTarget').value)
      })
    });
    renderMany(result.chapters);
    $('status').textContent = `Built ${result.chapters.length} chapters.`;
  } catch (error) {
    $('status').textContent = error.message;
  }
});

loadWorkspaces().catch(error => { $('status').textContent = error.message; });
