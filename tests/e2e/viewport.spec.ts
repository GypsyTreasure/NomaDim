import { expect, test } from '@playwright/test';

test('viewport renders on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NomaDim' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom to Fit' })).toBeVisible();
});
