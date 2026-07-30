import { expect, test } from '@playwright/test';

/**
 * M10 marketing landing: `/` serves the static landing — it must load with
 * **zero WASM/app code** and route to the app at `/app/` via its CTA. Runs
 * against the production `preview` build (multi-page output).
 */

test('landing loads with no WASM and a CTA that routes to /app/', async ({ page }) => {
  const heavy: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('.wasm') || url.includes('.gzc')) heavy.push(url);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const cta = page.getByTestId('cta-launch');
  await expect(cta).toHaveAttribute('href', /\/app\/$/);

  await page.waitForTimeout(800);
  expect(heavy).toEqual([]); // the landing never fetches the kernel
});

test('a legal footer link resolves', async ({ page }) => {
  await page.goto('/');
  const terms = page.getByRole('link', { name: 'Terms' });
  const href = await terms.getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(href ?? '');
  expect(res.ok()).toBe(true);
});
