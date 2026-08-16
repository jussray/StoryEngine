const params = new URLSearchParams(window.location.search);
const workspaceId = params.get('workspace_id') || '';

const els = {
  form: document.getElementById('canonForm'),
  kind: document.getElementById('kind'),
  key: document.getElementById('key'),
  value: document.getElementById('value'),
  locked: document.getElementById('locked'),
  save: document.getElementById('saveCanon'),
  formStatus: document.getElementById('formStatus'),
  pageStatus: document.getElementById('pageStatus'),
  canonList: document.getElementById('canonList'),
  anchorCount: document.getElementById('anchorCount'),
  lockedCount: document.getElementById('lockedCount'),
  entityCount: document.getElementById('entityCount'),
  conflictCount: document.getElementById('conflictCount'),
  charactersCount: document.getElementById('charactersCount'),
  locationsCount: document.getElementById('locationsCount'),
  relationshipsCount: document.getElementById('relationshipsCount'),
  loreCount: document.getElementById('loreCount'),
  objectsCount: document.getElementById('objectsCount'),
  timelineCount: document.getElementById('timelineCount')
};

function setStatus(element, message, state = '') {
  element.textContent = message;
  element.className = `status${state ? ` ${state}` : ''}`;
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

function workspacePath(path) {
  return `${path}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function wireWorkspaceLinks() {
  for (const id of ['writerLink', 'bookFormat']) {
    document.getElementById(id).href = workspacePath('/story_engine.html');
  }
  for (const id of ['movieLink', 'movieFormat']) {
    document.getElementById(id).href = workspacePath('/movie.html');
  }
}

function flattenCanon(snapshot) {
  const rows = [];
  for (const [kind, entries] of Object.entries(snapshot?.anchors || {})) {
    for (const [key, value] of Object.entries(entries || {})) {
      rows.push({ kind, key, ...value });
    }
  }
  return rows.sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`));
}

function renderCanon(snapshot) {
  const rows = flattenCanon(snapshot);
  els.canonList.replaceChildren();
  els.anchorCount.textContent = String(snapshot?.anchor_count || 0);
  els.lockedCount.textContent = String(snapshot?.locked_count || 0);

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No canon facts yet. Add the first truth that every format must respect.';
    els.canonList.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const item = document.createElement('article');
    item.className = 'canon-row';
    item.dataset.testid = 'canon-row';

    const head = document.createElement('div');
    head.className = 'canon-head';

    const identity = document.createElement('div');
    const kind = document.createElement('div');
    kind.className = 'canon-kind';
    kind.textContent = row.kind.replaceAll('_', ' ');
    const key = document.createElement('div');
    key.className = 'canon-key';
    key.textContent = row.key;
    identity.append(kind, key);

    const lock = document.createElement('span');
    lock.className = `pill${row.locked ? ' locked' : ''}`;
    lock.textContent = row.locked ? '🔒 Creator locked' : 'Editable canon';
    head.append(identity, lock);

    const value = document.createElement('div');
    value.className = 'canon-value';
    value.textContent = row.value;

    const meta = document.createElement('div');
    meta.className = 'canon-meta';
    const source = document.createElement('span');
    source.className = 'pill';
    source.textContent = `source: ${row.source || 'unknown'}`;
    meta.appendChild(source);

    item.append(head, value, meta);
    els.canonList.appendChild(item);
  }
}

function renderMemory(snapshot) {
  const counts = {
    characters: snapshot?.characters?.length || 0,
    locations: snapshot?.locations?.length || 0,
    relationships: snapshot?.relationships?.length || 0,
    lore: snapshot?.lore?.length || 0,
    objects: snapshot?.objects?.length || 0,
    timeline: snapshot?.timeline?.length || 0
  };
  const entityCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const conflicts = (snapshot?.diffs || []).filter(diff => Number(diff.conflict) === 1 && Number(diff.resolved) === 0).length;

  els.entityCount.textContent = String(entityCount);
  els.conflictCount.textContent = String(conflicts);
  els.charactersCount.textContent = String(counts.characters);
  els.locationsCount.textContent = String(counts.locations);
  els.relationshipsCount.textContent = String(counts.relationships);
  els.loreCount.textContent = String(counts.lore);
  els.objectsCount.textContent = String(counts.objects);
  els.timelineCount.textContent = String(counts.timeline);
}

async function refreshUniverse() {
  if (!workspaceId) return;
  const encoded = encodeURIComponent(workspaceId);
  const [canon, memory] = await Promise.all([
    api(`/api/memory/${encoded}/canon`),
    api(`/api/memory/${encoded}`)
  ]);
  renderCanon(canon);
  renderMemory(memory);
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!workspaceId) return;

  els.save.disabled = true;
  setStatus(els.formStatus, 'Saving to runtime…');
  try {
    await api(`/api/memory/${encodeURIComponent(workspaceId)}/canon`, {
      method: 'POST',
      body: JSON.stringify({
        kind: els.kind.value,
        key: els.key.value.trim(),
        value: els.value.value.trim(),
        locked: els.locked.checked
      })
    });
    await refreshUniverse();
    setStatus(els.formStatus, 'Persisted. This fact is now part of the Story Universe.', 'ok');
    els.key.value = '';
    els.value.value = '';
    els.key.focus();
  } catch (error) {
    setStatus(els.formStatus, `Not saved: ${error.message}`, 'error');
  } finally {
    els.save.disabled = false;
  }
});

async function boot() {
  if (!workspaceId) {
    els.form.querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = true; });
    setStatus(els.pageStatus, 'No workspace selected. Open a story first.', 'error');
    return;
  }

  wireWorkspaceLinks();
  try {
    await refreshUniverse();
    setStatus(els.pageStatus, `Runtime connected · workspace ${workspaceId}`, 'ok');
  } catch (error) {
    setStatus(els.pageStatus, `Could not load Story Universe: ${error.message}`, 'error');
  }
}

boot();
