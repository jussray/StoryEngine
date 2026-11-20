// Creator-facing controls for optional visuals on an authenticated book artifact.
(() => {
  const panel = document.querySelector('[data-testid="visual-studio"]');
  const match = location.pathname.match(/^\/api\/artifacts\/(artifact_[^/]+)\/html$/);
  if (!panel || !match) return;
  const artifactId = encodeURIComponent(match[1]);
  const status = panel.querySelector('#imageGenerationStatus');
  const coverButton = panel.querySelector('#generateBookCover');
  const visualToggle = panel.querySelector('#enableChapterArt');
  const assetList = panel.querySelector('#imageAssetList');
  const chapterButtons = [];

  function show(message) { status.textContent = message; }
  async function request(path, method = 'GET', data = null) {
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }
  function describe(item) {
    return (item.kind === 'chapter_visual' ? 'Chapter ' + item.chapter_index : 'Book cover') +
      ' · ' + item.status;
  }
  async function reloadAssets() {
    try {
      const assets = await request('/api/images/artifacts/' + artifactId);
      assetList.replaceChildren();
      for (const asset of assets) {
        const row = document.createElement('p');
        row.textContent = describe(asset);
        assetList.append(row);
      }
      if (assets.some(asset => asset.kind === 'cover' && asset.status === 'complete')) {
        coverButton.textContent = 'Regenerate cover using saved asset controls';
      }
    } catch {
      show('Could not load saved images. Your book is unchanged.');
    }
  }
  async function poll(imageId) {
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1800));
      const item = await request('/api/images/' + encodeURIComponent(imageId) + '/refresh', 'POST');
      show(describe(item));
      if (item.status === 'complete') { location.reload(); return; }
      if (item.status !== 'pending') { await reloadAssets(); return; }
    }
    show('The image is still processing. Refresh the page to check the saved status.');
  }
  async function submit(path, payload, button) {
    button.disabled = true;
    show('Submitting image request. Your book remains available.');
    try {
      const item = await request(path, 'POST', payload);
      show(describe(item));
      await reloadAssets();
      if (item.status === 'complete') location.reload();
      else if (item.status === 'pending') await poll(item.image_id);
      else if (item.status === 'not_configured') show('Image generation is not configured. Your book is still ready.');
      else if (item.status === 'failed') show('The image failed. Your book is unaffected.');
    } catch (error) {
      show('Image request failed: ' + error.message + '. Your book is unaffected.');
    } finally { button.disabled = false; }
  }
  coverButton.addEventListener('click', () => submit(
    '/api/images/artifacts/' + artifactId + '/cover', null, coverButton
  ));
  const chapters = [...document.querySelectorAll('[data-testid="story-unit"]')];
  chapters.forEach((unit, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'visual-button visual-chapter-action';
    button.textContent = 'Generate optional visual for chapter ' + (index + 1);
    button.disabled = true;
    button.addEventListener('click', () => submit(
      '/api/images/artifacts/' + artifactId + '/chapter',
      { include_visual: true, chapter_index: index + 1 }, button
    ));
    unit.append(button);
    chapterButtons.push(button);
  });
  visualToggle.addEventListener('change', () => {
    chapterButtons.forEach(button => { button.disabled = !visualToggle.checked; });
    show(visualToggle.checked
      ? 'Chapter visuals are optional. Choose individual chapters below.'
      : 'Chapter visuals are off. No images will be generated for chapters.');
  });
  reloadAssets();
})();
