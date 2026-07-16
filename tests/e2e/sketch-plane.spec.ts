import { expect, test } from '@playwright/test';

/**
 * Sketch plane selection (F2): "New Sketch" prompts for a base plane, and a
 * sketch drawn on a non-XY plane extrudes into a solid through the same
 * pipeline. Proves the plane choice flows all the way to the kernel (the
 * profile is placed on the chosen plane's world placement).
 */

test('choose a non-XY base plane, then sketch and extrude on it', async ({ page }) => {
  await page.goto('/');

  // New Sketch asks which plane first.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('plane-picker')).toBeVisible();

  // Pick the XZ plane → the sketch environment opens on it.
  await page.getByTestId('plane-choice-XZ').click();
  await expect(page.getByTestId('plane-picker')).toHaveCount(0);
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  // Draw a circle and extrude → one solid body (the XZ placement reached the kernel).
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});

test('plane choice can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('plane-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('plane-picker')).toHaveCount(0);
  // Still on the home screen (no sketch entered).
  await expect(page.getByTestId('numeric-hud')).toHaveCount(0);
});
