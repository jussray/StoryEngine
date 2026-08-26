import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

async function mountBeat(page) {
  await establishBrowserSession(page);
  await page.goto('/movie.html?workspace_id=motion-proof');
  await page.evaluate(() => {
    const beats = document.getElementById('beats');
    const card = document.createElement('div');
    card.className = 'beat-card';
    card.dataset.testid = 'motion-proof-beat';
    card.innerHTML = '<button class="save-beat" data-save-state="saved">Saved ✓</button>';
    beats.replaceChildren(card);
  });
  return page.locator('[data-testid="motion-proof-beat"]');
}

async function loadRuntimeBeat(page, putStatus) {
  await page.route('**/api/movie/beats/motion-proof', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'beat-1', act: 1, beat: 'Opening image', logline: 'Initial line' }]),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/movie/beats/beat-1', async route => {
    await route.fulfill({ status: putStatus, contentType: 'application/json', body: JSON.stringify({ ok: putStatus < 400 }) });
  });
  await establishBrowserSession(page);
  await page.goto('/movie.html?workspace_id=motion-proof');
  return page.locator('.save-beat');
}

test('Movie Mode uses bounded narrative motion on desktop', async ({ page }) => {
  const beat = await mountBeat(page);
  const motion = await beat.evaluate(node => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(motion.name).toBe('beat-enter');
  expect(motion.duration).toBe('0.24s');

  const save = beat.locator('.save-beat');
  const saveMotion = await save.evaluate(node => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(saveMotion.name).toBe('save-confirm');
  expect(saveMotion.duration).toBe('0.14s');
});

test('Movie Mode only confirms persisted state after a successful save', async ({ page }) => {
  const save = await loadRuntimeBeat(page, 200);
  await save.click();
  await expect(save).toHaveAttribute('data-save-state', 'saved');
  await expect(save).toHaveText('Saved ✓');
});

test('Movie Mode failed save stays unsaved and exposes bounded failure feedback', async ({ page }) => {
  const save = await loadRuntimeBeat(page, 500);
  await save.click();
  await expect(save).toHaveAttribute('data-save-state', 'error');
  await expect(save).toHaveText('Save failed · Try again');
  const motion = await save.evaluate(node => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(motion.name).toBe('save-error');
  expect(motion.duration).toBe('0.14s');
});

test('Movie Mode motion remains bounded on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const beat = await mountBeat(page);
  await expect(beat).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('Movie Mode collapses animation when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const beat = await mountBeat(page);
  const duration = await beat.evaluate(node => getComputedStyle(node).animationDuration);
  const saveDuration = await beat.locator('.save-beat').evaluate(node => getComputedStyle(node).animationDuration);
  expect(duration).toBe('0.001s');
  expect(saveDuration).toBe('0.001s');
});
