const params = new URLSearchParams(window.location.search);
const workspaceId = params.get('workspace_id') || '';

const els = {
  canonForm: document.getElementById('canonForm'),
  kind: document.getElementById('kind'),
  key: document.getElementById('key'),
  value: document.getElementById('value'),
  locked: document.getElementById('locked'),
  save: document.getElementById('saveCanon'),
  formStatus: document.getElementById('formStatus'),
  sourceForm: document.getElementById('sourceForm'),
  sourceTitle: document.getElementById('sourceTitle'),
  sourceType: document.getElementById('sourceType'),
  sourceText: document.getElementById('sourceText'),
  analyzeSource: document.getElementById('analyzeSource'),
  sourceStatus: document.getElementById('sourceStatus'),
  proposalList: document.getElementById('proposalList'),
  pageStatus: document.getElementById('pageStatus'),
  canonList: document.getElementById('canonList'),
  anchorCount: document.getElementById('anchorCount'),
  lockedCount: document.getElementById('lockedCount'),
  pendingCount: document.getElementById('pendingCount'),
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
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function workspacePath(path) {
  return `${path}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function wireWorkspaceLinks() {
  for (const id of ['writerLink', 'bookFormat']) document.getElementById(id).href = workspacePath('/chapters.html');
  for (const id of ['movieLink', 'movieFormat']) document.getElementById(id).href = workspacePath('/movie.html');
}

function flattenCanon(snapshot) {
  const rows = [];
  for (const [kind, entries] of Object.entries(snapshot?.anchors || {})) {
    for (const [key, value] of Object.entries(entries || {})) rows.push({ kind, key, ...value });
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
    empty.textContent = 'No canon yet. Approve a suggestion or add a truth yourself.';
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
    source.textContent = `authority: ${row.source || 'unknown'}`;
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
  els.entityCount.textContent = String(Object.values(counts).reduce((sum, count) => sum + count, 0));
  els.conflictCount.textContent = String((snapshot?.diffs || []).filter(diff => Number(diff.conflict) === 1 && Number(diff.resolved) === 0).length);
  els.charactersCount.textContent = String(counts.characters);
  els.locationsCount.textContent = String(counts.locations);
  els.relationshipsCount.textContent = String(counts.relationships);
  els.loreCount.textContent = String(counts.lore);
  els.objectsCount.textContent = String(counts.objects);
  els.timelineCount.textContent = String(counts.timeline);
}

function statusNode(status) {
  const node = document.createElement('span');
  node.className = `proposal-state ${status}`;
  node.textContent = status === 'pending' ? 'Awaiting you' : status;
  return node;
}

function proposalField(labelText, control) {
  const wrapper = document.createElement('label');
  wrapper.textContent = labelText;
  wrapper.appendChild(control);
  return wrapper;
}

async function reviewProposal(proposal, decision, controls, card) {
  card.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = true; });
  try {
    const body = { decision };
    if (decision === 'approve') {
      body.kind = proposal.kind;
      body.key = controls.key.value.trim();
      body.value = controls.value.value.trim();
      body.locked = controls.locked.checked;
    }
    await api(`/api/memory/${encodeURIComponent(workspaceId)}/proposals/${encodeURIComponent(proposal.proposal_id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    await refreshUniverse();
    setStatus(
      els.sourceStatus,
      decision === 'approve' ? 'Approved. Your edited suggestion is now canonical truth.' : 'Rejected. Canon was not changed.',
      'ok'
    );
  } catch (error) {
    setStatus(els.sourceStatus, `Review failed: ${error.message}`, 'error');
    card.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = false; });
  }
}

function renderProposals(state) {
  const proposals = state?.proposals || [];
  els.pendingCount.textContent = String(state?.counts?.pending || 0);
  els.proposalList.replaceChildren();

  if (!proposals.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No suggestions yet. Give StoryEngine source material to understand.';
    els.proposalList.appendChild(empty);
    return;
  }

  for (const proposal of proposals) {
    const card = document.createElement('article');
    card.className = 'proposal';
    card.dataset.testid = 'source-proposal';
    card.dataset.status = proposal.status;
    card.dataset.proposalId = proposal.proposal_id;

    const head = document.createElement('div');
    head.className = 'proposal-head';
    const identity = document.createElement('div');
    const kind = document.createElement('div');
    kind.className = 'proposal-kind';
    kind.textContent = proposal.kind.replaceAll('_', ' ');
    const title = document.createElement('div');
    title.className = 'proposal-title';
    title.textContent = proposal.key;
    identity.append(kind, title);
    head.append(identity, statusNode(proposal.status));
    card.appendChild(head);

    if (proposal.evidence) {
      const evidence = document.createElement('div');
      evidence.className = 'proposal-evidence';
      evidence.textContent = `Source evidence: “${proposal.evidence}”`;
      card.appendChild(evidence);
    }

    if (proposal.status !== 'pending') {
      const value = document.createElement('div');
      value.className = 'canon-value';
      value.textContent = proposal.value;
      card.appendChild(value);
      els.proposalList.appendChild(card);
      continue;
    }

    const fields = document.createElement('div');
    fields.className = 'proposal-fields';
    const keyInput = document.createElement('input');
    keyInput.value = proposal.key;
    keyInput.maxLength = 120;
    keyInput.setAttribute('aria-label', 'Canon key');
    const valueInput = document.createElement('textarea');
    valueInput.value = proposal.value;
    valueInput.maxLength = 4000;
    valueInput.setAttribute('aria-label', 'Canonical truth');
    fields.append(proposalField('Canon key', keyInput), proposalField('Edit before approval', valueInput));
    card.appendChild(fields);

    const actions = document.createElement('div');
    actions.className = 'proposal-actions';
    const lockLabel = document.createElement('label');
    lockLabel.className = 'lock-row';
    const lockInput = document.createElement('input');
    lockInput.type = 'checkbox';
    lockInput.checked = proposal.locked !== false;
    const lockText = document.createElement('span');
    lockText.textContent = 'Lock if approved';
    lockLabel.append(lockInput, lockText);

    const approve = document.createElement('button');
    approve.className = 'button';
    approve.type = 'button';
    approve.dataset.testid = 'approve-proposal';
    approve.textContent = 'Approve into canon';
    const reject = document.createElement('button');
    reject.className = 'button danger';
    reject.type = 'button';
    reject.dataset.testid = 'reject-proposal';
    reject.textContent = 'Reject';
    actions.append(lockLabel, reject, approve);
    card.appendChild(actions);

    const controls = { key: keyInput, value: valueInput, locked: lockInput };
    approve.addEventListener('click', () => reviewProposal(proposal, 'approve', controls, card));
    reject.addEventListener('click', () => reviewProposal(proposal, 'reject', controls, card));
    els.proposalList.appendChild(card);
  }
}

async function refreshUniverse() {
  if (!workspaceId) return;
  const encoded = encodeURIComponent(workspaceId);
  const [canon, memory, sourceState] = await Promise.all([
    api(`/api/memory/${encoded}/canon`),
    api(`/api/memory/${encoded}`),
    api(`/api/memory/${encoded}/sources`)
  ]);
  renderCanon(canon);
  renderMemory(memory);
  renderProposals(sourceState);
}

els.sourceForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!workspaceId) return;
  const content = els.sourceText.value.trim();
  if (!content) return;

  els.analyzeSource.disabled = true;
  setStatus(els.sourceStatus, 'Understanding source… Nothing will become canon without your approval.');
  try {
    const result = await api(`/api/memory/${encodeURIComponent(workspaceId)}/sources/analyze`, {
      method: 'POST',
      body: JSON.stringify({
        title: els.sourceTitle.value.trim() || 'Untitled source',
        source_type: els.sourceType.value,
        content
      })
    });
    await refreshUniverse();
    setStatus(els.sourceStatus, `${result.proposal_count} suggestion${result.proposal_count === 1 ? '' : 's'} ready for review · ${result.extractor}. Nothing became canon.`, 'ok');
    els.sourceText.value = '';
  } catch (error) {
    setStatus(els.sourceStatus, `Source analysis failed: ${error.message}`, 'error');
  } finally {
    els.analyzeSource.disabled = false;
  }
});

els.canonForm.addEventListener('submit', async event => {
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
    document.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
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
