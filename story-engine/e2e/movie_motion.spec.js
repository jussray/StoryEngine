import { test, expect } from '@playwright/test';

async function mountBeat(page) {
  await page.goto('/movie.html?workspace_id=motion-proof');
  await page.evaluate(() => {
    const beats = document.getElementById('beats');
    const card = document.createElement('div');
    card.className = 'beat-card';
    card.dataset.testid = 'motion-proof-beat';
    card.textContent = 'Motion proof beat';
    beats.replaceChildren(card);
  });
  return page.locator('[data-testid="motion-proof-beat"]');
}

test('Movie Mode uses bounded narrative motion on desktop', async ({ page }) => {
  const beat = await mountBeat(page);
  const motion = await beat.evaluate(node => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(motion.name).toBe('beat-enter');
  expect(motion.duration).toBe('0.24s');
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
  expect(duration).toBe('0.001s');
});
