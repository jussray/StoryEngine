import { test, expect } from '@playwright/test';

// Layout regressions for the StoryEngine front door (public/front_door.html).
// Guards the polaroid collage from covering the entry cards and from causing
// horizontal page scroll at phone width. Anonymous: no session is established.

test('desktop: polaroid collage clears the entry cards and every image loads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/front_door.html');

  const polaroids = page.locator('.polaroid');
  await expect(polaroids).toHaveCount(5);

  await expect.poll(() => page.locator('.polaroid img').evaluateAll(
    imgs => imgs.every(img => img.complete && img.naturalWidth > 0)
  )).toBe(true);

  const collageBottom = await polaroids.evaluateAll(
    els => Math.max(...els.map(el => el.getBoundingClientRect().bottom))
  );
  const createCardTop = await page.locator('.create-card').evaluate(
    el => el.getBoundingClientRect().top
  );
  const signinCardTop = await page.locator('.signin-card').evaluate(
    el => el.getBoundingClientRect().top
  );
  expect(collageBottom).toBeLessThanOrEqual(createCardTop);
  expect(collageBottom).toBeLessThanOrEqual(signinCardTop);

  await expect(page.getByRole('heading', { name: 'What do you want to create?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back to StoryEngine' })).toBeVisible();
  await expect(page.locator('#startBtn')).toBeDisabled();
});

test('phone: no horizontal page scroll and the create action stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/front_door.html');

  await expect(page.getByRole('heading', { name: 'What do you want to create?' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('#vision').fill('A girl discovers an abandoned train station that only appears at midnight.');
  await expect(page.locator('#startBtn')).toBeEnabled();
});
