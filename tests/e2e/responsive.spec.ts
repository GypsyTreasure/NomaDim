import { expect, test, type Page } from '@playwright/test';

/**
 * Responsive layout (#2): at an iPhone-12 viewport (390×844) the menus reflow so
 * every control stays reachable (long toolbars scroll) and the page itself never
 * scrolls horizontally, in both non-sketch and sketch modes.
 */

const overflowPx = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('iPhone-12 viewport: controls reachable, no horizontal page scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');

  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Top action bar + timeline ops are present and clickable.
  await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  // A tool near the end of the scrollable tool row is still reachable (Playwright
  // scrolls it into view), and typing works.
  await page.getByRole('button', { name: 'Circle (Center-Diameter)' }).click();
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();

  // Sketch mode also never overflows the page horizontally.
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  await ctx.close();
});
