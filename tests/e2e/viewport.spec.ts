import { expect, test } from '@playwright/test';

test('viewport renders on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NomaDim', exact: true })).toBeVisible();
  // Two canvases exist: the WebGL viewport and the 2D sketch overlay.
  await expect(page.locator('canvas[data-engine]')).toBeVisible();
  await expect(page.getByTestId('sketch-overlay')).toBeAttached();
  // The view bar is collapsed behind the View menu; opening it reveals Zoom to Fit.
  await expect(page.getByRole('button', { name: 'Zoom to Fit' })).toBeHidden();
  await page.getByTestId('view-toggle').click();
  await expect(page.getByRole('button', { name: 'Zoom to Fit' })).toBeVisible();
});
