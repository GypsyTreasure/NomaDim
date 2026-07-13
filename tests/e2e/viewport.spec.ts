import { expect, test } from '@playwright/test';

test('viewport renders on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NomaDim' })).toBeVisible();
  // Two canvases exist: the WebGL viewport and the 2D sketch overlay.
  await expect(page.locator('canvas[data-engine]')).toBeVisible();
  await expect(page.getByTestId('sketch-overlay')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Zoom to Fit' })).toBeVisible();
});
